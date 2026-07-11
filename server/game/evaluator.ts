import pokersolver from 'pokersolver'
import type { Card } from '~~/shared/types'

// pokersolver は CommonJS。ESM 相互運用でデフォルトインポートから取り出す。
const { Hand } = pokersolver as unknown as {
  Hand: {
    solve: (cards: string[]) => SolvedHand
    winners: (hands: SolvedHand[]) => SolvedHand[]
  }
}

interface SolvedHand {
  descr: string
  [k: string]: unknown
}

export interface EvaluatedSeat {
  seat: number
  cards: Card[]
  descr: string
}

export interface ShowdownEvaluation {
  winners: number[]
  seats: EvaluatedSeat[]
}

/**
 * ショーダウン評価。各席のホールカード + 5枚のボードから 7枚の最高役を求め、
 * 勝者席（スプリット時は複数）を返す。
 */
export function evaluateShowdown(
  entries: { seat: number; cards: Card[] }[],
  board: Card[],
): ShowdownEvaluation {
  const solved = entries.map((e) => ({
    seat: e.seat,
    cards: e.cards,
    hand: Hand.solve([...e.cards, ...board]),
  }))

  const winnerHands = Hand.winners(solved.map((s) => s.hand))
  const winners = solved
    .filter((s) => winnerHands.includes(s.hand))
    .map((s) => s.seat)

  return {
    winners,
    seats: solved.map((s) => ({
      seat: s.seat,
      cards: s.cards,
      descr: s.hand.descr,
    })),
  }
}
