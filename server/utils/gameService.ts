import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BlindLevel,
  LegalActions,
  RoomConfig,
  RoomView,
} from '~~/shared/types'
import {
  applyAction,
  legalActions as engineLegalActions,
  startHand,
  type EngineHand,
} from '../game/engine'
import { decideAiAction } from '../game/ai/decide'
import { GameError } from '../game/engine'
import { currentLevel, defaultBlindStructure, nextLevelAt, snapStructureToChipUnit } from '../game/blinds'
import {
  fromDbHand,
  toDbHand,
  toPublicHand,
  type HandRow,
} from '../game/persistence'

type DB = SupabaseClient
const other = (seat: number) => (seat === 0 ? 1 : 0)

export { GameError }

// ------------------------------------------------------------------
// ルーム作成
// ------------------------------------------------------------------
export interface CreateRoomInput {
  userId: string
  displayName: string
  name?: string | null
  isPublic?: boolean
  initialStack?: number
  blindIntervalSeconds?: number
  actionTimeoutSeconds?: number
  anteMode?: 'none' | 'bb'
  startingBb?: number
  blindStructure?: BlindLevel[]
  chipUnit?: number
  /** true なら AI を対戦相手として着席させ、即座に対局を開始する */
  vsAi?: boolean
}

/** AI 席の表示名 */
export const AI_DISPLAY_NAME = 'GTO AI'

function randomCode(len = 6): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 紛らわしい文字を除外
  let out = ''
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

export async function createRoom(db: DB, input: CreateRoomInput): Promise<{ code: string; id: string }> {
  const initialStack = input.initialStack ?? 10000
  const rawStructure =
    input.blindStructure ?? defaultBlindStructure(input.startingBb ?? 200)
  // 最小チップ単位は開始 BB を超えない範囲に制限し、ブラインド構造も単位へスナップ
  const chipUnit = Math.max(
    1,
    Math.min(Math.floor(input.chipUnit ?? 100), rawStructure[0]?.bb ?? 1),
  )
  let structure = snapStructureToChipUnit(rawStructure, chipUnit)
  // アンティなしの部屋は構造上も ante を 0 にする（表示・保存の整合）
  if ((input.anteMode ?? 'bb') === 'none') {
    structure = structure.map((l) => ({ ...l, ante: 0 }))
  }

  // 一意なコードを確保（衝突時リトライ）
  let code = randomCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: exists } = await db.from('rooms').select('id').eq('code', code).maybeSingle()
    if (!exists) break
    code = randomCode()
  }

  const { data: room, error } = await db
    .from('rooms')
    .insert({
      code,
      name: input.name ?? null,
      status: 'waiting',
      is_public: input.vsAi ? false : (input.isPublic ?? true), // AI 部屋はロビーに出さない
      created_by: input.userId,
      initial_stack: initialStack,
      blind_interval_seconds: input.blindIntervalSeconds ?? 300,
      action_timeout_seconds: input.actionTimeoutSeconds ?? 30,
      ante_mode: input.anteMode ?? 'bb',
      blind_structure: structure,
      chip_unit: chipUnit,
    })
    .select('id, code')
    .single()
  if (error) throw new GameError(`部屋の作成に失敗しました: ${error.message}`)

  const { error: pErr } = await db.from('room_players').insert({
    room_id: room.id,
    user_id: input.userId,
    seat: 0,
    display_name: input.displayName,
    stack: initialStack,
    connected: true,
  })
  if (pErr) throw new GameError(`座席の作成に失敗しました: ${pErr.message}`)

  // AI 対戦: AI を席1に着席させ、待機なしで対局を開始する
  if (input.vsAi) {
    const { error: aiErr } = await db.from('room_players').insert({
      room_id: room.id,
      user_id: null,
      is_ai: true,
      seat: 1,
      display_name: AI_DISPLAY_NAME,
      stack: initialStack,
      connected: true,
    })
    if (aiErr) throw new GameError(`AI席の作成に失敗しました: ${aiErr.message}`)
    await beginMatch(db, room.id)
  }

  return { code: room.code, id: room.id }
}

// ------------------------------------------------------------------
// 入室
// ------------------------------------------------------------------
export async function joinRoom(
  db: DB,
  input: { code: string; userId: string; displayName: string },
): Promise<{ seat: number }> {
  const room = await getRoomByCode(db, input.code)
  const { data: seats } = await db
    .from('room_players')
    .select('seat, user_id')
    .eq('room_id', room.id)

  const existing = seats?.find((s) => s.user_id === input.userId)
  if (existing) return { seat: existing.seat }

  if ((seats?.length ?? 0) >= 2) throw new GameError('この部屋は満席です')

  const taken = new Set(seats?.map((s) => s.seat))
  const seat = taken.has(0) ? 1 : 0

  const { error } = await db.from('room_players').insert({
    room_id: room.id,
    user_id: input.userId,
    seat,
    display_name: input.displayName,
    stack: room.initial_stack,
    connected: true,
  })
  if (error) throw new GameError(`入室に失敗しました: ${error.message}`)
  return { seat }
}

// ------------------------------------------------------------------
// 対局開始
// ------------------------------------------------------------------
export async function startGame(db: DB, input: { code: string; userId: string }): Promise<void> {
  const room = await getRoomByCode(db, input.code)
  if (room.status !== 'waiting') throw new GameError('すでに開始しています')

  const { data: players } = await db
    .from('room_players')
    .select('seat, user_id')
    .eq('room_id', room.id)
  if ((players?.length ?? 0) < 2) throw new GameError('対戦相手の入室を待っています')
  // 両者着席していれば、どちらの席からでも開始できる。
  // （作成者限定にすると、匿名IDの喪失で作成者席が幽霊化した部屋を誰も開始できなくなる）
  if (!players!.some((p) => p.user_id === input.userId)) {
    throw new GameError('開始できるのはこの部屋の参加者のみです')
  }

  await beginMatch(db, room.id)
}

/** 対局を開始する（ボタン抽選 → 1ハンド目の配札）。作成時 AI 対戦でも使用 */
async function beginMatch(db: DB, roomId: string): Promise<void> {
  const button = Math.random() < 0.5 ? 0 : 1
  await db
    .from('rooms')
    .update({
      status: 'playing',
      started_at: new Date().toISOString(),
      hand_number: 0,
      button_seat: button,
      updated_at: new Date().toISOString(),
    })
    .eq('id', roomId)

  await dealNextHand(db, roomId)
}

// ------------------------------------------------------------------
// 次ハンドの配札（開始時 / ハンド終了後）
// ------------------------------------------------------------------
export async function dealNextHand(db: DB, roomId: string): Promise<void> {
  const { data: room } = await db.from('rooms').select('*').eq('id', roomId).single()
  if (!room || room.status !== 'playing') return

  const { data: playersRaw } = await db
    .from('room_players')
    .select('seat, user_id, stack')
    .eq('room_id', roomId)
    .order('seat')
  const players = playersRaw ?? []
  if (players.length < 2) return

  // どちらかが 0 になっていれば対局終了
  const bust = players.find((p) => p.stack <= 0)
  if (bust) {
    const winner = players.find((p) => p.stack > 0)
    await db
      .from('rooms')
      .update({ status: 'finished', winner_seat: winner?.seat ?? null, updated_at: new Date().toISOString() })
      .eq('id', roomId)
    return
  }

  const currentNum: number = room.hand_number
  const nextNum = currentNum + 1
  const button: number = room.button_seat ?? 0

  // レース回避: hand_number を条件付き更新で「請求」できた場合のみ配札
  const { data: claimed } = await db
    .from('rooms')
    .update({
      hand_number: nextNum,
      button_seat: other(button),
      updated_at: new Date().toISOString(),
    })
    .eq('id', roomId)
    .eq('hand_number', currentNum)
    .select('id')
    .maybeSingle()
  if (!claimed) return // 別リクエストが既に配札済み

  const structure = room.blind_structure as BlindLevel[]
  const level = currentLevel(room.started_at, room.blind_interval_seconds, structure)

  const engine = startHand({
    handNumber: nextNum,
    buttonSeat: button,
    level: level.level,
    sb: level.sb,
    bb: level.bb,
    ante: level.ante,
    anteMode: room.ante_mode,
    players: players.map((p) => ({ seat: p.seat, userId: p.user_id, stack: p.stack })),
  })

  await persistHand(db, {
    roomId,
    engine,
    isNew: true,
    timeoutSeconds: room.action_timeout_seconds,
  })
}

// ------------------------------------------------------------------
// プレイヤーのアクション
// ------------------------------------------------------------------
export async function applyPlayerAction(
  db: DB,
  input: { code: string; userId: string; type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number },
): Promise<void> {
  const room = await getRoomByCode(db, input.code)
  const { row, engine } = await loadCurrentHand(db, room.id)
  const seat = seatOfUser(engine, input.userId)
  if (seat === null) throw new GameError('この部屋の参加者ではありません')
  if (engine.result) throw new GameError('このハンドは既に終了しています')

  const emitted = applyAction(
    engine,
    seat,
    { type: input.type, amount: input.amount },
    room.chip_unit ?? 1,
  )

  await persistHand(db, {
    roomId: room.id,
    engine,
    isNew: false,
    handId: row.id,
    version: row.version,
    timeoutSeconds: room.action_timeout_seconds,
  })

  await db.from('actions').insert({
    hand_id: row.id,
    seat,
    user_id: input.userId,
    street: emitted.street,
    type: emitted.type,
    amount: emitted.amount,
  })
}

// ------------------------------------------------------------------
// タイムアウト請求（どちらのプレイヤーからでも可・サーバーが期限を検証）
// ------------------------------------------------------------------
export async function claimTimeout(db: DB, input: { code: string; userId: string }): Promise<void> {
  const room = await getRoomByCode(db, input.code)
  const { row, engine } = await loadCurrentHand(db, room.id)
  if (engine.result || engine.toActSeat === null) return
  if (!row.action_deadline) return
  if (Date.now() < new Date(row.action_deadline).getTime()) return // まだ期限内

  const seat = engine.toActSeat
  // 期限切れ: チェック可能ならチェック、不可ならフォールド
  const legal = engineLegalActions(engine, seat)
  const emitted = applyAction(engine, seat, { type: legal.canCheck ? 'check' : 'fold' })

  await persistHand(db, {
    roomId: room.id,
    engine,
    isNew: false,
    handId: row.id,
    version: row.version,
    timeoutSeconds: room.action_timeout_seconds,
  })
  await db.from('actions').insert({
    hand_id: row.id,
    seat,
    user_id: null,
    street: emitted.street,
    type: emitted.type === 'check' ? 'check' : 'fold',
    amount: 0,
  })
}

// ------------------------------------------------------------------
// AI の手番を進める（クライアントが AI の手番を検知して請求・冪等）
//
// タイムアウト請求と同じ「クライアントがポーク → サーバーが検証して実行」
// パターン。サーバーレスでは常駐プロセスを持てないため、AI のアクションも
// リクエスト駆動で行う。AI の手番でなければ何もしない。
// 万一このエンドポイントが呼ばれなくても、既存のタイムアウト処理が
// AI を自動チェック/フォールドさせるため対局は止まらない。
// ------------------------------------------------------------------
export async function applyAiAction(db: DB, input: { code: string }): Promise<void> {
  const room = await getRoomByCode(db, input.code)
  if (room.status !== 'playing') return

  const { data: aiPlayer } = await db
    .from('room_players')
    .select('seat')
    .eq('room_id', room.id)
    .eq('is_ai', true)
    .maybeSingle()
  if (!aiPlayer) throw new GameError('この部屋に AI はいません')

  const { row, engine } = await loadCurrentHand(db, room.id)
  if (engine.result || engine.toActSeat !== aiPlayer.seat) return // AI の手番でなければ何もしない

  const decision = decideAiAction(engine, aiPlayer.seat, room.chip_unit ?? 1)
  const emitted = applyAction(engine, aiPlayer.seat, decision, room.chip_unit ?? 1)

  await persistHand(db, {
    roomId: room.id,
    engine,
    isNew: false,
    handId: row.id,
    version: row.version,
    timeoutSeconds: room.action_timeout_seconds,
  })

  await db.from('actions').insert({
    hand_id: row.id,
    seat: aiPlayer.seat,
    user_id: null,
    street: emitted.street,
    type: emitted.type,
    amount: emitted.amount,
  })
}

// ------------------------------------------------------------------
// 次ハンドへ進む（ハンド終了後、クライアントが結果表示後に呼ぶ・冪等）
// ------------------------------------------------------------------
export async function advanceToNextHand(db: DB, input: { code: string; userId: string }): Promise<void> {
  const room = await getRoomByCode(db, input.code)
  if (room.status !== 'playing') return
  const { engine } = await loadCurrentHand(db, room.id)
  if (!engine.result) return // まだ進行中
  await dealNextHand(db, room.id)
}

// ------------------------------------------------------------------
// クライアント向けビューの構築
// ------------------------------------------------------------------
export async function buildRoomView(
  db: DB,
  input: { code: string; userId: string | null },
): Promise<RoomView> {
  const room = await getRoomByCode(db, input.code)
  const { data: players } = await db
    .from('room_players')
    .select('seat, display_name, stack, connected, user_id, is_ai')
    .eq('room_id', room.id)
    .order('seat')

  const yourSeat =
    players?.find((p) => p.user_id === input.userId)?.seat ?? null

  const structure = room.blind_structure as BlindLevel[]
  const config: RoomConfig = {
    initialStack: room.initial_stack,
    blindIntervalSeconds: room.blind_interval_seconds,
    actionTimeoutSeconds: room.action_timeout_seconds,
    anteMode: room.ante_mode,
    blindStructure: structure,
    chipUnit: room.chip_unit ?? 1, // マイグレーション前の部屋は制限なし
  }
  const levelRaw = currentLevel(room.started_at, room.blind_interval_seconds, structure)
  // アンティなしの部屋（過去に ante 入り構造で作られたものを含む）は ante を 0 として返す
  const level = room.ante_mode === 'none' ? { ...levelRaw, ante: 0 } : levelRaw

  let handPublic = null
  let myCards = null
  let legal: LegalActions | null = null

  if (room.hand_number > 0) {
    const { data: handRow } = await db
      .from('hands')
      .select('*')
      .eq('room_id', room.id)
      .order('hand_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (handRow) {
      const row = handRow as HandRow
      handPublic = toPublicHand(row)

      if (input.userId) {
        const { data: hole } = await db
          .from('hole_cards')
          .select('cards')
          .eq('hand_id', row.id)
          .eq('user_id', input.userId)
          .maybeSingle()
        myCards = hole?.cards ?? null
      }

      if (!row.result && row.to_act_seat !== null && row.to_act_seat === yourSeat) {
        // legalActions はホールカード不要 → 空デッキで復元して算出
        const engine = fromDbHand(row, [], {})
        legal = engineLegalActions(engine, yourSeat, room.chip_unit ?? 1)
      }
    }
  }

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      isPublic: room.is_public,
      config,
      handNumber: room.hand_number,
      buttonSeat: room.button_seat,
      startedAt: room.started_at,
      winnerSeat: room.winner_seat,
      currentLevel: level,
      nextLevelAt: nextLevelAt(room.started_at, room.blind_interval_seconds, structure),
    },
    players: (players ?? []).map((p) => ({
      seat: p.seat,
      displayName: p.display_name,
      stack: p.stack,
      connected: p.connected,
      isYou: p.user_id !== null && p.user_id === input.userId,
      isAi: !!p.is_ai,
    })),
    yourSeat,
    hand: handPublic,
    myCards,
    legalActions: legal,
  }
}

// ------------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------------
async function getRoomByCode(db: DB, code: string) {
  const { data, error } = await db
    .from('rooms')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle()
  if (error) throw new GameError(`部屋の取得に失敗しました: ${error.message}`)
  if (!data) throw new GameError('部屋が見つかりません')
  return data
}

async function loadCurrentHand(db: DB, roomId: string): Promise<{ row: HandRow; engine: EngineHand }> {
  const { data: handRow } = await db
    .from('hands')
    .select('*')
    .eq('room_id', roomId)
    .order('hand_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!handRow) throw new GameError('進行中のハンドがありません')

  const row = handRow as HandRow
  const { data: secret } = await db
    .from('hand_secrets')
    .select('deck')
    .eq('hand_id', row.id)
    .single()
  const { data: holes } = await db
    .from('hole_cards')
    .select('seat, cards')
    .eq('hand_id', row.id)

  const holesBySeat: Record<number, string[]> = {}
  for (const h of holes ?? []) holesBySeat[h.seat] = h.cards

  return { row, engine: fromDbHand(row, secret?.deck ?? [], holesBySeat) }
}

function seatOfUser(engine: EngineHand, userId: string): number | null {
  if (engine.seats[0]?.userId === userId) return 0
  if (engine.seats[1]?.userId === userId) return 1
  return null
}

async function persistHand(
  db: DB,
  args: {
    roomId: string
    engine: EngineHand
    isNew: boolean
    handId?: string
    version?: number
    timeoutSeconds: number
  },
): Promise<void> {
  const { row, deck, holes } = toDbHand(args.engine)
  const deadline =
    args.engine.toActSeat !== null && !args.engine.result
      ? new Date(Date.now() + args.timeoutSeconds * 1000).toISOString()
      : null

  if (args.isNew) {
    const { data: inserted, error } = await db
      .from('hands')
      .insert({ ...row, room_id: args.roomId, action_deadline: deadline, version: 0 })
      .select('id')
      .single()
    if (error) throw new GameError(`ハンド保存に失敗しました: ${error.message}`)

    await db.from('hand_secrets').insert({ hand_id: inserted.id, deck })
    await db.from('hole_cards').insert(
      holes.map((h) => ({
        hand_id: inserted.id,
        seat: h.seat,
        user_id: h.user_id,
        cards: h.cards,
        revealed: h.revealed,
      })),
    )
  } else {
    const { error } = await db
      .from('hands')
      .update({
        ...row,
        action_deadline: deadline,
        version: (args.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.handId!)
      .eq('version', args.version ?? 0) // 楽観ロック
    if (error) throw new GameError(`ハンド更新に失敗しました: ${error.message}`)

    await db.from('hand_secrets').update({ deck }).eq('hand_id', args.handId!)
    // ショーダウン公開時はホールカードの revealed を更新
    for (const h of holes) {
      if (h.revealed) {
        await db
          .from('hole_cards')
          .update({ revealed: true })
          .eq('hand_id', args.handId!)
          .eq('seat', h.seat)
      }
    }
  }

  // room_players のスタックを最新に同期（次ハンドの基点）
  for (const seat of [0, 1]) {
    const s = args.engine.seats[seat]!
    await db
      .from('room_players')
      .update({ stack: s.stack })
      .eq('room_id', args.roomId)
      .eq('seat', seat)
  }
}
