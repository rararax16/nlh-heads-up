// クライアント / サーバー共有の型定義

/** カード表記: ランク(2-9,T,J,Q,K,A) + スート(s,h,d,c)。例 "As", "Td", "9h" */
export type Card = string

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete'
export type RoomStatus = 'waiting' | 'playing' | 'finished'
export type AnteMode = 'none' | 'bb'

export type ActionType =
  | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'

export interface BlindLevel {
  level: number
  sb: number
  bb: number
  ante: number
}

export interface RoomConfig {
  initialStack: number
  blindIntervalSeconds: number
  actionTimeoutSeconds: number
  anteMode: AnteMode
  blindStructure: BlindLevel[]
}

/** 各席の公開状態（ホールカードは含めない） */
export interface PublicSeatState {
  committed: number        // 当ハンドで拠出した合計
  streetCommitted: number  // 現ストリートで拠出した額
  folded: boolean
  allin: boolean
  stack: number
  hasCards: boolean        // カードを持っているか（配布済みか）
}

export interface ShowdownEntry {
  seat: number
  cards: Card[]
  descr: string            // 役の説明（例 "Pair of Aces"）
}

export interface HandResult {
  winners: number[]        // 勝者席（スプリット時は複数）
  potWon: number
  reason: 'fold' | 'showdown'
  showdown?: ShowdownEntry[]
  payouts: Record<number, number> // seat -> 受取額
}

export interface LegalActions {
  canFold: boolean
  canCheck: boolean
  canCall: boolean
  callAmount: number       // コールに必要な追加額
  canBetOrRaise: boolean
  minRaiseTo: number       // レイズ後の合計ベット額の最小
  maxRaiseTo: number       // オールイン時の合計ベット額
}

export interface PublicHandState {
  id: string
  handNumber: number
  street: Street
  board: Card[]
  pot: number
  toActSeat: number | null
  actionDeadline: string | null
  currentBet: number
  minRaise: number
  buttonSeat: number
  sb: number
  bb: number
  ante: number
  level: number
  seats: Record<number, PublicSeatState>
  result: HandResult | null
}

export interface PlayerView {
  seat: number
  displayName: string
  stack: number
  connected: boolean
  isYou: boolean
}

export interface RoomView {
  room: {
    id: string
    code: string
    name: string | null
    status: RoomStatus
    isPublic: boolean
    config: RoomConfig
    handNumber: number
    buttonSeat: number | null
    startedAt: string | null
    winnerSeat: number | null
    currentLevel: BlindLevel
    nextLevelAt: string | null
  }
  players: PlayerView[]
  yourSeat: number | null
  hand: PublicHandState | null
  myCards: Card[] | null
  legalActions: LegalActions | null
}

export interface LobbyRoom {
  id: string
  code: string
  name: string | null
  status: RoomStatus
  playerCount: number
  config: Pick<RoomConfig, 'initialStack' | 'blindIntervalSeconds'> & {
    startingBlinds: { sb: number; bb: number }
  }
  createdAt: string
}
