import type { RealtimeChannel } from '@supabase/supabase-js'
import type { RoomView } from '~~/shared/types'

/** actions テーブルへの INSERT（実況表示用に Realtime で受け取る） */
export interface ActionEvent {
  hand_id: string
  seat: number
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'
  amount: number
  street: string
}

export function useRoom(code: string) {
  const supabase = useSupabaseClient()
  const api = useApi()
  const state = ref<RoomView | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)
  const now = ref(Date.now())

  let channel: RealtimeChannel | null = null
  let emojiHandler: ((emoji: string, name: string) => void) | null = null
  let actionHandler: ((a: ActionEvent) => void) | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let handledTimeoutFor: string | null = null
  let aiPokeKey: string | null = null
  let aiPokeDueAt = 0
  let advancedHand = -1
  // オールインのランアウト演出中は次ハンド送りを遅らせる（結果到着時に算出）
  let runoutExtraMs = 0

  async function load() {
    try {
      const view = await api<RoomView>(`/api/rooms/${code}/state`)
      const prevHand = state.value?.hand
      if (view.hand?.result && prevHand) {
        if (prevHand.id === view.hand.id && !prevHand.result) {
          runoutExtraMs = runoutDurationMs(prevHand.board.length, view.hand.board.length)
        } else if (prevHand.id !== view.hand.id) {
          // 配られた時点で決着済み（アンティ/ブラインドで強制オールイン等）→ 0枚から演出
          runoutExtraMs = runoutDurationMs(0, view.hand.board.length)
        }
      }
      state.value = view
      error.value = null
      ensureSubscribed(view.room.id)
    } catch (e: unknown) {
      error.value = errMsg(e)
    } finally {
      loading.value = false
    }
  }

  // realtime は「変化した」通知として使い、権威的な状態は state API で取得
  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(load, 120)
  }

  function ensureSubscribed(roomId: string) {
    if (channel) return
    channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hands', filter: `room_id=eq.${roomId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, scheduleReload)
      // アクションの実況（RLS により自分がメンバーの部屋の分のみ届く。
      // actions に room_id 列は無いため、hand_id の照合は受信側で行う）
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'actions' }, (payload) => {
        actionHandler?.(payload.new as ActionEvent)
        scheduleReload()
      })
      // 相手からの絵文字リアクション（DB を介さない一時的な broadcast）
      .on('broadcast', { event: 'emoji' }, ({ payload }) => {
        const p = payload as { emoji?: string; name?: string } | null
        if (p?.emoji) emojiHandler?.(p.emoji, p.name ?? '相手')
      })
      .subscribe()
  }

  // 絵文字リアクションを相手へ送信（送信者名を同梱・自分側は呼び出し元で即時再生）
  function sendEmoji(emoji: string) {
    const name = state.value?.players.find((p) => p.isYou)?.displayName ?? ''
    channel?.send({ type: 'broadcast', event: 'emoji', payload: { emoji, name } })
  }

  // 相手から届いた絵文字を受け取るハンドラを登録
  function onEmoji(cb: (emoji: string, name: string) => void) {
    emojiHandler = cb
  }

  // アクション発生（自分・相手とも）を受け取るハンドラを登録
  function onAction(cb: (a: ActionEvent) => void) {
    actionHandler = cb
  }

  // 1秒ごとに now を更新し、タイムアウト/次ハンドの自動処理を行う
  function tick() {
    now.value = Date.now()
    const s = state.value
    if (!s || !s.hand) return

    // AI の手番が残っている場合の復旧ポーク。
    // AI は通常サーバー側で同期的に進む（人間のアクション/配札/タイムアウトの
    // リクエスト内で処理される）ため、ここに来るのはその処理が失敗した時か
    // 一時的な中間状態のみ。少し待ってから ai-act を叩き、直るまで数秒おきに再試行する。
    const aiSeat = s.players.find((p) => p.isAi)?.seat
    if (
      aiSeat !== undefined &&
      s.room.status === 'playing' &&
      s.hand &&
      !s.hand.result &&
      s.hand.toActSeat === aiSeat
    ) {
      const key = `${s.hand.id}:${s.hand.actionDeadline}`
      if (aiPokeKey !== key) {
        aiPokeKey = key
        aiPokeDueAt = now.value + 1200
      } else if (now.value >= aiPokeDueAt) {
        aiPokeDueAt = now.value + 4000
        api(`/api/rooms/${code}/ai-act`, { method: 'POST' }).catch(() => {})
      }
    }

    // アクション期限切れ → タイムアウト請求（サーバーが期限を検証）
    const hand = s.hand
    if (!hand.result && hand.actionDeadline) {
      const deadline = new Date(hand.actionDeadline).getTime()
      if (now.value > deadline + 500 && handledTimeoutFor !== hand.actionDeadline) {
        handledTimeoutFor = hand.actionDeadline
        api(`/api/rooms/${code}/timeout`, { method: 'POST' }).catch(() => {})
      }
    }

    // ハンド終了 → ランアウト演出＋結果を見せてから次ハンドへ（冪等・サーバーが重複を排除）
    if (hand.result && s.room.status === 'playing' && advancedHand !== hand.handNumber) {
      advancedHand = hand.handNumber
      const delay = 4000 + runoutExtraMs
      runoutExtraMs = 0
      setTimeout(() => {
        api(`/api/rooms/${code}/next`, { method: 'POST' }).catch(() => {})
      }, delay)
    }
  }

  async function join(displayName: string) {
    await api(`/api/rooms/${code}/join`, { method: 'POST', body: { displayName } })
    await load()
  }

  async function start() {
    await api(`/api/rooms/${code}/start`, { method: 'POST' })
    await load()
  }

  async function act(type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) {
    error.value = null
    try {
      await api(`/api/rooms/${code}/action`, { method: 'POST', body: { type, amount } })
      await load()
    } catch (e: unknown) {
      error.value = errMsg(e)
    }
  }

  onMounted(() => {
    load()
    ticker = setInterval(tick, 1000)
  })
  onUnmounted(() => {
    if (ticker) clearInterval(ticker)
    if (reloadTimer) clearTimeout(reloadTimer)
    if (channel) supabase.removeChannel(channel)
  })

  return { state, error, loading, now, load, join, start, act, sendEmoji, onEmoji, onAction }
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'statusMessage' in e) {
    return String((e as { statusMessage?: string }).statusMessage ?? 'エラーが発生しました')
  }
  if (e && typeof e === 'object' && 'data' in e) {
    const d = (e as { data?: { statusMessage?: string; message?: string } }).data
    return d?.statusMessage ?? d?.message ?? 'エラーが発生しました'
  }
  return e instanceof Error ? e.message : 'エラーが発生しました'
}
