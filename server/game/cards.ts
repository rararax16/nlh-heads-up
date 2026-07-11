import { randomInt } from 'node:crypto'
import type { Card } from '~~/shared/types'

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS = ['s', 'h', 'd', 'c']

/** 標準52枚デッキ */
export function freshDeck(): Card[] {
  const deck: Card[] = []
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s)
    }
  }
  return deck
}

/**
 * 暗号論的乱数（node:crypto）で Fisher-Yates シャッフル。
 * サーバーでのみ実行され、結果デッキは hand_secrets に保存される。
 */
export function shuffle(deck: Card[]): Card[] {
  const a = deck.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

export function shuffledDeck(): Card[] {
  return shuffle(freshDeck())
}
