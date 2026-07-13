import type { Card, PublicHandState, PublicSeatState } from '~~/shared/types'
import type { EngineHand, EngineSeat } from './engine'

// EngineHand <-> DB 行 のマッピング（純粋・DB非依存）

/** hands テーブル 1 行の形（snake_case） */
export interface HandRow {
  id: string
  room_id: string
  hand_number: number
  button_seat: number
  level: number
  sb: number
  bb: number
  ante: number
  board: Card[]
  pot: number
  street: EngineHand['street']
  to_act_seat: number | null
  action_deadline: string | null
  current_bet: number
  min_raise: number
  last_aggressor_seat: number | null
  dead_money: number
  block_reraise_seat: number | null
  seats: Record<string, StoredSeat>
  result: EngineHand['result']
  version: number
}

/** seats jsonb に保存する席状態（ホールカードは含めない） */
interface StoredSeat {
  seat: number
  userId: string | null // null = AI 席
  stack: number
  committed: number
  streetCommitted: number
  folded: boolean
  allin: boolean
  hasActed: boolean
}

export interface HoleRow {
  seat: number
  user_id: string | null // null = AI 席
  cards: Card[]
  revealed: boolean
}

function toStoredSeat(s: EngineSeat): StoredSeat {
  return {
    seat: s.seat,
    userId: s.userId,
    stack: s.stack,
    committed: s.committed,
    streetCommitted: s.streetCommitted,
    folded: s.folded,
    allin: s.allin,
    hasActed: s.hasActed,
  }
}

/** エンジン状態を DB 保存用（公開行 / デッキ / ホールカード）に分解 */
export function toDbHand(hand: EngineHand): {
  row: Omit<HandRow, 'id' | 'room_id' | 'version'>
  deck: Card[]
  holes: HoleRow[]
} {
  const revealHoles = hand.result?.reason === 'showdown'
  return {
    row: {
      hand_number: hand.handNumber,
      button_seat: hand.buttonSeat,
      level: hand.level,
      sb: hand.sb,
      bb: hand.bb,
      ante: hand.ante,
      board: hand.board,
      pot: hand.deadMoney + hand.seats[0]!.committed + hand.seats[1]!.committed,
      street: hand.street,
      to_act_seat: hand.toActSeat,
      action_deadline: null, // 呼び出し側で設定
      current_bet: hand.currentBet,
      min_raise: hand.minRaise,
      last_aggressor_seat: hand.lastAggressorSeat,
      dead_money: hand.deadMoney,
      block_reraise_seat: hand.blockReraiseSeat,
      seats: {
        '0': toStoredSeat(hand.seats[0]!),
        '1': toStoredSeat(hand.seats[1]!),
      },
      result: hand.result,
    },
    deck: hand.deck,
    // ショーダウンで決着した非フォールド席のみ revealed=true
    holes: [0, 1].map((i) => {
      const s = hand.seats[i]!
      return {
        seat: i,
        user_id: s.userId,
        cards: s.hole,
        revealed: revealHoles && !s.folded,
      }
    }),
  }
}

/** DB から読み出した情報でエンジン状態を復元 */
export function fromDbHand(
  row: HandRow,
  deck: Card[],
  holesBySeat: Record<number, Card[]>,
): EngineHand {
  const seat = (i: number): EngineSeat => {
    const st = row.seats[String(i)]!
    return {
      seat: st.seat,
      userId: st.userId,
      stack: st.stack,
      committed: st.committed,
      streetCommitted: st.streetCommitted,
      folded: st.folded,
      allin: st.allin,
      hasActed: st.hasActed,
      hole: holesBySeat[i] ?? [],
    }
  }
  return {
    handNumber: row.hand_number,
    buttonSeat: row.button_seat,
    level: row.level,
    sb: row.sb,
    bb: row.bb,
    ante: row.ante,
    deck,
    board: row.board,
    deadMoney: row.dead_money,
    street: row.street,
    toActSeat: row.to_act_seat,
    currentBet: row.current_bet,
    minRaise: row.min_raise,
    lastAggressorSeat: row.last_aggressor_seat,
    blockReraiseSeat: row.block_reraise_seat,
    seats: { 0: seat(0), 1: seat(1) },
    result: row.result,
  }
}

/**
 * クライアント向けの公開ハンド状態を構築。
 * ホールカードは含めない（別途 myCards として本人分のみ返す）。
 */
export function toPublicHand(row: HandRow): PublicHandState {
  const seatView = (i: number): PublicSeatState => {
    const st = row.seats[String(i)]!
    return {
      committed: st.committed,
      streetCommitted: st.streetCommitted,
      folded: st.folded,
      allin: st.allin,
      stack: st.stack,
      hasCards: !st.folded,
    }
  }
  return {
    id: row.id,
    handNumber: row.hand_number,
    street: row.street,
    board: row.board,
    pot: row.pot,
    toActSeat: row.to_act_seat,
    actionDeadline: row.action_deadline,
    currentBet: row.current_bet,
    minRaise: row.min_raise,
    buttonSeat: row.button_seat,
    sb: row.sb,
    bb: row.bb,
    ante: row.ante,
    level: row.level,
    seats: { 0: seatView(0), 1: seatView(1) },
    result: row.result,
  }
}
