import type { Card } from '~~/shared/types'

// =============================================================
// カード整数表現と 169 種プリフロップハンドの正準インデックス
//
// カード整数: rank * 4 + suit
//   rank: 0(2) .. 12(A) / suit: 0(s) 1(h) 2(d) 3(c)
// 正準インデックス (0..168):
//   ペア      : r*13 + r
//   スーテッド : hi*13 + lo   (hi > lo)
//   オフスート : lo*13 + hi
// =============================================================

const RANK_CHARS = '23456789TJQKA'
const SUIT_CHARS = 'shdc'

export function cardToInt(card: Card): number {
  const r = RANK_CHARS.indexOf(card[0]!)
  const s = SUIT_CHARS.indexOf(card[1]!)
  if (r < 0 || s < 0) throw new Error(`不正なカード表記: ${card}`)
  return r * 4 + s
}

export function intToCard(n: number): Card {
  return RANK_CHARS[n >> 2]! + SUIT_CHARS[n & 3]!
}

/** ホールカード2枚 → 正準インデックス (0..168) */
export function handIndexOf(c1: number, c2: number): number {
  const r1 = c1 >> 2
  const r2 = c2 >> 2
  const hi = Math.max(r1, r2)
  const lo = Math.min(r1, r2)
  if (hi === lo) return hi * 13 + hi
  const suited = (c1 & 3) === (c2 & 3)
  return suited ? hi * 13 + lo : lo * 13 + hi
}

export function handIndexOfCards(cards: Card[]): number {
  return handIndexOf(cardToInt(cards[0]!), cardToInt(cards[1]!))
}

/** デバッグ/テスト用ラベル（例 "AKs", "T9o", "77"） */
export function handLabel(idx: number): string {
  const a = Math.floor(idx / 13)
  const b = idx % 13
  if (a === b) return RANK_CHARS[a]! + RANK_CHARS[b]!
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  const suited = a > b // hi*13+lo 側がスーテッド
  return RANK_CHARS[hi]! + RANK_CHARS[lo]! + (suited ? 's' : 'o')
}

export function labelToIndex(label: string): number {
  const hi = RANK_CHARS.indexOf(label[0]!)
  const lo = RANK_CHARS.indexOf(label[1]!)
  if (hi === lo) return hi * 13 + hi
  const a = Math.max(hi, lo)
  const b = Math.min(hi, lo)
  return label[2] === 's' ? a * 13 + b : b * 13 + a
}

/** そのハンド種の具体的コンボ数（ペア6 / スーテッド4 / オフスート12） */
export function comboCount(idx: number): number {
  const a = Math.floor(idx / 13)
  const b = idx % 13
  if (a === b) return 6
  return a > b ? 4 : 12
}

/** 具体的な2枚の組み合わせ一覧（カード整数のペア） */
export function combosOf(idx: number): [number, number][] {
  const a = Math.floor(idx / 13)
  const b = idx % 13
  const out: [number, number][] = []
  if (a === b) {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) out.push([a * 4 + s1, a * 4 + s2])
    }
  } else if (a > b) {
    // スーテッド
    for (let s = 0; s < 4; s++) out.push([a * 4 + s, b * 4 + s])
  } else {
    // オフスート（a < b、hi = b）
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        if (s1 !== s2) out.push([b * 4 + s1, a * 4 + s2])
      }
    }
  }
  return out
}
