import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  createRoom,
  joinRoom,
  startGame,
  applyPlayerAction,
  advanceToNextHand,
  buildRoomView,
} from '../server/utils/gameService'

// ローカル Supabase に対する統合テスト（`supabase start` が必要）
const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

let db: SupabaseClient
let userA: string
let userB: string

beforeAll(async () => {
  db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })
  const mk = async () => {
    const email = `test_${Math.random().toString(36).slice(2)}@example.com`
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: 'password123',
      email_confirm: true,
    })
    if (error) throw error
    return data.user!.id
  }
  userA = await mk()
  userB = await mk()
})

describe('フルゲーム統合フロー', () => {
  it('作成→入室→開始→全ハンド消化でバスト決着し、チップ総量が保存される', async () => {
    const initialStack = 200
    const { code } = await createRoom(db, {
      userId: userA,
      displayName: 'Alice',
      initialStack,
      startingBb: 50,
      blindIntervalSeconds: 100000, // レベル固定
      actionTimeoutSeconds: 30,
      anteMode: 'bb',
    })

    const { seat: seatB } = await joinRoom(db, { code, userId: userB, displayName: 'Bob' })
    expect(seatB).toBe(1)

    await startGame(db, { code, userId: userA })

    // 各手番で「レイズ可能なら全プッシュ、無理ならコール/チェック」を繰り返す
    let guard = 0
    while (guard++ < 100) {
      const view = await buildRoomView(db, { code, userId: userA })
      if (view.room.status === 'finished') break

      const hand = view.hand
      if (!hand || hand.result) {
        await advanceToNextHand(db, { code, userId: userA })
        continue
      }

      const toSeat = hand.toActSeat!
      const actingUser = toSeat === 0 ? userA : userB
      const v = await buildRoomView(db, { code, userId: actingUser })
      const legal = v.legalActions!
      expect(v.myCards).toHaveLength(2) // 本人は自分のカードが見える

      if (legal.canBetOrRaise) {
        await applyPlayerAction(db, { code, userId: actingUser, type: 'raise', amount: legal.maxRaiseTo })
      } else if (legal.canCall) {
        await applyPlayerAction(db, { code, userId: actingUser, type: 'call' })
      } else if (legal.canCheck) {
        await applyPlayerAction(db, { code, userId: actingUser, type: 'check' })
      } else {
        await applyPlayerAction(db, { code, userId: actingUser, type: 'fold' })
      }
    }

    const final = await buildRoomView(db, { code, userId: userA })
    expect(final.room.status).toBe('finished')
    expect(final.room.winnerSeat === 0 || final.room.winnerSeat === 1).toBe(true)

    // チップ総量保存（両者合計 = 初期スタック×2）
    const total = final.players.reduce((sum, p) => sum + p.stack, 0)
    expect(total).toBe(initialStack * 2)
  }, 30000)
})
