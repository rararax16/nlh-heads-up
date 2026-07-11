import type { Card } from '~~/shared/types'

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }

export function cardRank(card: Card): string {
  const r = card[0]!
  return r === 'T' ? '10' : r
}

export function cardSuit(card: Card): string {
  return SUIT_SYMBOL[card[1]!] ?? '?'
}

export function isRed(card: Card): boolean {
  return card[1] === 'h' || card[1] === 'd'
}

export function formatChips(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatBlinds(sb: number, bb: number, ante: number): string {
  return ante > 0 ? `${sb}/${bb} (アンティ${ante})` : `${sb}/${bb}`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** pokersolver の役説明（英語）を日本語表記へ変換する */
const HAND_NAME_JA: [string, string][] = [
  ['Royal Flush', 'ロイヤルフラッシュ'],
  ['Straight Flush', 'ストレートフラッシュ'],
  ['Four of a Kind', 'フォーカード'],
  ['Full House', 'フルハウス'],
  ['Flush', 'フラッシュ'],
  ['Straight', 'ストレート'],
  ['Three of a Kind', 'スリーカード'],
  ['Two Pair', 'ツーペア'],
  ['Pair', 'ワンペア'],
  ['High Card', 'ハイカード'],
]

export function formatHandDescr(descr: string): string {
  const hit = HAND_NAME_JA.find(([en]) => descr.startsWith(en))
  if (!hit) return descr
  const detail = descr
    .slice(hit[0].length)
    .replace(/^,\s*/, '')
    .replace(/'s/g, '')
    .replace(/\b([2-9TJQKA])[shdc]\b/g, '$1') // カード表記のスート文字を除去 (Jc → J)
    .replace(/\bT\b/g, '10')
    .replace(/\s*over\s*/g, '・')
    .replace(/\s*&\s*/g, '・')
    .replace(/\s+High/g, 'ハイ')
    .trim()
  return detail ? `${hit[1]}（${detail}）` : hit[1]
}
