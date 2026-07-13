// =============================================================
// 高速7カード評価器（モンテカルロ・シミュレーション用）
//
// pokersolver（ショーダウンの正式判定に使用）は 1 評価あたり ms オーダーと
// 遅く、勝率計算の数十万〜数億回の評価には使えないため、
// 割り当てフリーの整数演算のみで評価する専用実装を持つ。
// 正しさは tests/ai.test.ts で pokersolver と突き合わせて検証する。
//
// カード整数: rank*4 + suit（handIndex.ts と同一規約）
// 戻り値: 大きいほど強い比較可能な整数
//   category(4bit) << 20 | キッカー等を 4bit ずつパック
// =============================================================

const rankCount = new Uint8Array(13)
const suitCount = new Uint8Array(4)
const suitBits = new Uint16Array(4)

/** ビット集合から上位 n 個のランクを 4bit ずつパック */
function topN(bits: number, n: number): number {
  let out = 0
  let found = 0
  for (let r = 12; r >= 0 && found < n; r--) {
    if (bits & (1 << r)) {
      out = (out << 4) | r
      found++
    }
  }
  return out
}

/** ストレートの最上位ランク（無ければ -1）。A-low(ホイール)対応 */
function straightTop(bits: number): number {
  for (let t = 12; t >= 4; t--) {
    const m = 0b11111 << (t - 4)
    if ((bits & m) === m) return t
  }
  // A2345
  if ((bits & 0b1000000001111) === 0b1000000001111) return 3
  return -1
}

/**
 * 7枚のカード（整数表現）を評価して比較可能な整数を返す。
 * cards は長さ7の配列/TypedArray。
 */
export function eval7(cards: ArrayLike<number>): number {
  rankCount.fill(0)
  suitCount.fill(0)
  suitBits.fill(0)
  let rankBits = 0

  for (let i = 0; i < 7; i++) {
    const c = cards[i]!
    const r = c >> 2
    const s = c & 3
    rankCount[r]!++
    suitCount[s]!++
    suitBits[s]! |= 1 << r
    rankBits |= 1 << r
  }

  // フラッシュ / ストレートフラッシュ
  for (let s = 0; s < 4; s++) {
    if (suitCount[s]! >= 5) {
      const fb = suitBits[s]!
      const st = straightTop(fb)
      if (st >= 0) return (8 << 20) | (st << 16)
      return (5 << 20) | topN(fb, 5)
    }
  }

  // ランク枚数の集計（降順で quads/trips/pairs を拾う）
  let quad = -1
  let trip1 = -1
  let trip2 = -1
  let pair1 = -1
  let pair2 = -1
  let pair3 = -1
  for (let r = 12; r >= 0; r--) {
    const n = rankCount[r]!
    if (n === 4) quad = r
    else if (n === 3) {
      if (trip1 < 0) trip1 = r
      else if (trip2 < 0) trip2 = r
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r
      else if (pair2 < 0) pair2 = r
      else if (pair3 < 0) pair3 = r
    }
  }

  if (quad >= 0) {
    const kicker = topN(rankBits & ~(1 << quad), 1)
    return (7 << 20) | (quad << 16) | (kicker << 12)
  }

  if (trip1 >= 0 && (pair1 >= 0 || trip2 >= 0)) {
    const p = Math.max(pair1, trip2)
    return (6 << 20) | (trip1 << 16) | (p << 12)
  }

  const st = straightTop(rankBits)
  if (st >= 0) return (4 << 20) | (st << 16)

  if (trip1 >= 0) {
    const kickers = topN(rankBits & ~(1 << trip1), 2)
    return (3 << 20) | (trip1 << 16) | (kickers << 8)
  }

  if (pair2 >= 0) {
    // ツーペア: 上位2ペア + 残り最強カード（3つ目のペアのランクも候補）
    const kicker = topN(rankBits & ~(1 << pair1) & ~(1 << pair2), 1)
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8)
  }

  if (pair1 >= 0) {
    const kickers = topN(rankBits & ~(1 << pair1), 3)
    return (1 << 20) | (pair1 << 16) | (kickers << 4)
  }

  return topN(rankBits, 5)
}

/** 再現性のある疑似乱数（mulberry32）。データ生成とテストで使用 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
