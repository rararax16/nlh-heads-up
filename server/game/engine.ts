import type { Card, HandResult, LegalActions, Street } from '~~/shared/types'
import { shuffledDeck } from './cards'
import { evaluateShowdown } from './evaluator'

// =============================================================
// サーバー権威なヘッズアップ NLH エンジン（純粋関数群・副作用なし）
//
// ヘッズアップ特有ルール:
//   * ボタン席 = SB。相手 = BB。
//   * プリフロップは SB(ボタン) が先に、フロップ以降は BB が先にアクション。
//   * BBアンティ: BB のみアンティを死に金として拠出。
// =============================================================

export interface EngineSeat {
  seat: number
  userId: string
  stack: number
  committed: number        // 当ハンド累計拠出
  streetCommitted: number  // 現ストリート拠出
  folded: boolean
  allin: boolean
  hasActed: boolean        // 現ストリートでアクション済みか
  hole: Card[]
}

export interface EngineHand {
  handNumber: number
  buttonSeat: number
  level: number
  sb: number
  bb: number
  ante: number
  deck: Card[]
  board: Card[]
  deadMoney: number
  street: Street
  toActSeat: number | null
  currentBet: number
  minRaise: number
  lastAggressorSeat: number | null
  blockReraiseSeat: number | null
  seats: Record<number, EngineSeat>
  result: HandResult | null
}

export interface StartHandInput {
  handNumber: number
  buttonSeat: number
  level: number
  sb: number
  bb: number
  ante: number
  anteMode: 'none' | 'bb'
  players: { seat: number; userId: string; stack: number }[]
  deck?: Card[] // テスト用の決定的デッキ注入（省略時は暗号論的シャッフル）
}

const NEXT_STREET: Record<string, Street> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
}

const other = (seat: number): number => (seat === 0 ? 1 : 0)

export function pot(hand: EngineHand): number {
  return hand.deadMoney + hand.seats[0]!.committed + hand.seats[1]!.committed
}

/** 席へチップを拠出させる（スタック不足なら全額＝オールイン） */
function commit(seat: EngineSeat, amount: number): number {
  const paid = Math.min(amount, seat.stack)
  seat.stack -= paid
  seat.committed += paid
  seat.streetCommitted += paid
  if (seat.stack === 0) seat.allin = true
  return paid
}

/** 新しいハンドを開始（デッキ生成・配札・ブラインド/アンティ徴収） */
export function startHand(input: StartHandInput): EngineHand {
  const deck = input.deck ? input.deck.slice() : shuffledDeck()
  const sbSeat = input.buttonSeat
  const bbSeat = other(input.buttonSeat)

  const seats: Record<number, EngineSeat> = {}
  for (const p of input.players) {
    seats[p.seat] = {
      seat: p.seat,
      userId: p.userId,
      stack: p.stack,
      committed: 0,
      streetCommitted: 0,
      folded: false,
      allin: false,
      hasActed: false,
      hole: [],
    }
  }

  // 配札（2枚ずつ）。シャッフル済みなので配布順は結果に影響しない。
  seats[sbSeat]!.hole = [deck.shift()!, deck.shift()!]
  seats[bbSeat]!.hole = [deck.shift()!, deck.shift()!]

  const hand: EngineHand = {
    handNumber: input.handNumber,
    buttonSeat: input.buttonSeat,
    level: input.level,
    sb: input.sb,
    bb: input.bb,
    ante: input.ante,
    deck,
    board: [],
    deadMoney: 0,
    street: 'preflop',
    toActSeat: null,
    currentBet: 0,
    minRaise: input.bb,
    lastAggressorSeat: null,
    blockReraiseSeat: null,
    seats,
    result: null,
  }

  // アンティ（BBアンティ）: BB が死に金として拠出
  if (input.anteMode === 'bb' && input.ante > 0) {
    const bb = seats[bbSeat]!
    const paid = Math.min(input.ante, bb.stack)
    bb.stack -= paid
    hand.deadMoney += paid
    if (bb.stack === 0) bb.allin = true
  }

  // ブラインド徴収
  commit(seats[sbSeat]!, input.sb)
  commit(seats[bbSeat]!, input.bb)

  hand.currentBet = Math.max(
    seats[sbSeat]!.streetCommitted,
    seats[bbSeat]!.streetCommitted,
  )
  hand.lastAggressorSeat = bbSeat

  // 両者オールイン（極端なショートスタック）なら即ランアウト
  if (bothAllInOrDone(hand)) {
    runoutAndShowdown(hand)
    return hand
  }

  // プリフロップは SB(ボタン) から
  hand.toActSeat = sbSeat
  // ブラインドで既にオールインの席があれば手番を調整
  if (seats[hand.toActSeat]!.allin || seats[hand.toActSeat]!.folded) {
    hand.toActSeat = other(hand.toActSeat)
  }
  return hand
}

/**
 * 現手番の席が取れる合法アクション。
 * chipUnit > 1 のとき、最小レイズ額は単位へ切り上げられる（オールイン上限は超えない）。
 */
export function legalActions(hand: EngineHand, seat: number, chipUnit = 1): LegalActions {
  const s = hand.seats[seat]!
  const opp = hand.seats[other(seat)]!
  const toCall = Math.max(0, hand.currentBet - s.streetCommitted)
  const callAmount = Math.min(toCall, s.stack)

  const maxRaiseTo = s.streetCommitted + s.stack // オールイン時の合計ベット
  // レイズ/ベット可能か: コール以上のチップがあり、相手がまだ応じられる状態
  const canBetOrRaise =
    s.stack > toCall &&
    !opp.folded &&
    !opp.allin &&
    hand.blockReraiseSeat !== seat

  let minRaiseTo = hand.currentBet + hand.minRaise
  if (chipUnit > 1) minRaiseTo = Math.ceil(minRaiseTo / chipUnit) * chipUnit
  if (minRaiseTo > maxRaiseTo) minRaiseTo = maxRaiseTo // ショートオールインのみ可

  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && s.stack > 0,
    callAmount,
    canBetOrRaise,
    minRaiseTo,
    maxRaiseTo,
  }
}

export interface AppliedAction {
  seat: number
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'
  amount: number
  street: Street
}

/**
 * アクションを適用。バリデーション → 状態遷移（必要ならストリート進行・決着）。
 * amount はベット/レイズ時の「合計ベット額(raiseTo)」。
 * chipUnit > 1 のとき、ベット/レイズ額は単位の倍数のみ許可（オールインは端数可）。
 */
export function applyAction(
  hand: EngineHand,
  seat: number,
  action: { type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number },
  chipUnit = 1,
): AppliedAction {
  if (hand.toActSeat !== seat) throw new GameError('あなたの手番ではありません')
  const s = hand.seats[seat]!
  if (s.folded || s.allin) throw new GameError('アクションできない状態です')

  const legal = legalActions(hand, seat, chipUnit)
  const street = hand.street
  let emitted: AppliedAction

  switch (action.type) {
    case 'fold': {
      s.folded = true
      s.hasActed = true
      emitted = { seat, type: 'fold', amount: 0, street }
      break
    }
    case 'check': {
      if (!legal.canCheck) throw new GameError('チェックできません')
      s.hasActed = true
      emitted = { seat, type: 'check', amount: 0, street }
      break
    }
    case 'call': {
      if (!legal.canCall) throw new GameError('コールできません')
      const paid = commit(s, legal.callAmount)
      s.hasActed = true
      emitted = { seat, type: s.allin ? 'allin' : 'call', amount: paid, street }
      break
    }
    case 'bet':
    case 'raise': {
      if (!legal.canBetOrRaise) throw new GameError('ベット/レイズできません')
      const raiseTo = Math.floor(action.amount ?? 0)
      if (raiseTo < legal.minRaiseTo || raiseTo > legal.maxRaiseTo) {
        throw new GameError(
          `ベット額が不正です（${legal.minRaiseTo}〜${legal.maxRaiseTo}）`,
        )
      }
      // 最小チップ単位チェック（オールイン = maxRaiseTo は端数可）
      if (chipUnit > 1 && raiseTo % chipUnit !== 0 && raiseTo !== legal.maxRaiseTo) {
        throw new GameError(`ベット額は ${chipUnit} 単位で入力してください`)
      }
      const prevBet = hand.currentBet
      const raiseIncrement = raiseTo - prevBet
      const delta = raiseTo - s.streetCommitted
      commit(s, delta)
      // フルレイズ(>= minRaise)なら相手の再レイズ権を回復、ショートなら剥奪
      const isFullRaise = raiseIncrement >= hand.minRaise
      if (isFullRaise) {
        hand.minRaise = raiseIncrement
        hand.blockReraiseSeat = null
      } else {
        hand.blockReraiseSeat = other(seat)
      }
      hand.currentBet = raiseTo
      hand.lastAggressorSeat = seat
      s.hasActed = true
      hand.seats[other(seat)]!.hasActed = false // 相手は応答が必要
      emitted = {
        seat,
        type: s.allin ? 'allin' : prevBet === 0 ? 'bet' : 'raise',
        amount: delta,
        street,
      }
      break
    }
    default:
      throw new GameError('不明なアクションです')
  }

  progress(hand)
  return emitted
}

/** アクション後の進行制御 */
function progress(hand: EngineHand): void {
  // フォールド決着
  const alive = [0, 1].filter((i) => !hand.seats[i]!.folded)
  if (alive.length === 1) {
    resolveFold(hand, alive[0]!)
    return
  }

  if (!isRoundClosed(hand)) {
    hand.toActSeat = other(hand.toActSeat!)
    return
  }

  // ベッティングラウンド終了 → ストリート進行
  advance(hand)
}

/** ベッティングラウンドが閉じたか */
function isRoundClosed(hand: EngineHand): boolean {
  const active = [0, 1].map((i) => hand.seats[i]!).filter((s) => !s.folded)
  const contributors = active.filter((s) => !s.allin)
  if (contributors.length === 0) return true
  // 全 contributor がアクション済み かつ ベット額が一致
  return contributors.every(
    (s) => s.hasActed && s.streetCommitted === hand.currentBet,
  )
}

/** ストリートを進める（必要なら全ランアウトしてショーダウン） */
function advance(hand: EngineHand): void {
  while (true) {
    if (hand.street === 'river') {
      goShowdown(hand)
      return
    }
    hand.street = NEXT_STREET[hand.street]!
    dealBoard(hand)
    resetStreet(hand)

    if (bettingRequired(hand)) {
      // フロップ以降は BB(非ボタン) から
      let first = other(hand.buttonSeat)
      if (hand.seats[first]!.allin || hand.seats[first]!.folded) {
        first = other(first)
      }
      hand.toActSeat = first
      return
    }
    // ベット不要（誰かオールイン）→ 次のストリートも配って進める
  }
}

function bettingRequired(hand: EngineHand): boolean {
  const canAct = [0, 1]
    .map((i) => hand.seats[i]!)
    .filter((s) => !s.folded && !s.allin)
  return canAct.length >= 2
}

function dealBoard(hand: EngineHand): void {
  const need = hand.street === 'flop' ? 3 : 1
  for (let i = 0; i < need; i++) hand.board.push(hand.deck.shift()!)
}

function resetStreet(hand: EngineHand): void {
  for (const i of [0, 1]) {
    hand.seats[i]!.streetCommitted = 0
    hand.seats[i]!.hasActed = false
  }
  hand.currentBet = 0
  hand.minRaise = hand.bb
  hand.lastAggressorSeat = null
  hand.blockReraiseSeat = null
}

/** 全オールイン等でこれ以上のアクションが無いか */
function bothAllInOrDone(hand: EngineHand): boolean {
  const active = [0, 1].map((i) => hand.seats[i]!).filter((s) => !s.folded)
  const canAct = active.filter((s) => !s.allin)
  return active.length >= 2 && canAct.length < 2
}

/** 残りのボードを配り切ってショーダウンへ */
function runoutAndShowdown(hand: EngineHand): void {
  while (hand.board.length < 5) {
    hand.street = hand.street === 'preflop' ? 'flop' : NEXT_STREET[hand.street] ?? 'river'
    dealBoard(hand)
  }
  goShowdown(hand)
}

/** 未コールのベット（オールインで超過した分）を返却 */
function returnUncalled(hand: EngineHand): void {
  const a = hand.seats[0]!
  const b = hand.seats[1]!
  if (a.folded || b.folded) return
  if (a.committed > b.committed) {
    const d = a.committed - b.committed
    a.stack += d
    a.committed -= d
  } else if (b.committed > a.committed) {
    const d = b.committed - a.committed
    b.stack += d
    b.committed -= d
  }
}

/** フォールド決着（相手のカードは公開しない） */
function resolveFold(hand: EngineHand, winnerSeat: number): void {
  const total = pot(hand)
  hand.seats[winnerSeat]!.stack += total
  hand.street = 'complete'
  hand.toActSeat = null
  hand.result = {
    winners: [winnerSeat],
    potWon: total,
    reason: 'fold',
    payouts: { [winnerSeat]: total },
  }
}

/** ショーダウン決着 */
function goShowdown(hand: EngineHand): void {
  returnUncalled(hand)
  const total = pot(hand)

  const entries = [0, 1]
    .map((i) => hand.seats[i]!)
    .filter((s) => !s.folded)
    .map((s) => ({ seat: s.seat, cards: s.hole }))

  const evalResult = evaluateShowdown(entries, hand.board)
  const winners = evalResult.winners

  const payouts: Record<number, number> = {}
  const share = Math.floor(total / winners.length)
  let remainder = total - share * winners.length
  for (const w of [...winners].sort((x, y) => x - y)) {
    let amt = share
    if (remainder > 0) {
      amt += 1
      remainder -= 1
    }
    payouts[w] = amt
    hand.seats[w]!.stack += amt
  }

  hand.street = 'showdown'
  hand.toActSeat = null
  hand.result = {
    winners,
    potWon: total,
    reason: 'showdown',
    showdown: evalResult.seats,
    payouts,
  }
}

export class GameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameError'
  }
}
