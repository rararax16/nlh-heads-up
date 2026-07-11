import type { RealtimeChannel } from '@supabase/supabase-js'
import type { RoomView } from '~~/shared/types'

export function useRoom(code: string) {
  const supabase = useSupabaseClient()
  const api = useApi()
  const state = ref<RoomView | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)
  const now = ref(Date.now())

  let channel: RealtimeChannel | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let handledTimeoutFor: string | null = null
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
      .subscribe()
  }

  // 1秒ごとに now を更新し、タイムアウト/次ハンドの自動処理を行う
  function tick() {
    now.value = Date.now()
    const s = state.value
    if (!s || !s.hand) return

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

  return { state, error, loading, now, load, join, start, act }
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
