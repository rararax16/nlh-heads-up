import { PREFLOP_EQUITY_PERMILLE } from './data/preflopEquity'
import { HAND_KINDS, triIndex } from './equityGen'
import { comboCount, combosOf } from './handIndex'

// =============================================================
// プリフロップ勝率表へのアクセスと、それから導出するハンド序列
//
// * handEquity(i, j): 正準ハンド i の j に対する勝率（タイ=0.5）
// * percentile[i]: HU での強さ序列（0=最強側）。「トップ X%」レンジの表現に使う
//   序列は「vs ランダム」→「vs 上位50%レンジ」の1段精緻化で決める
//   （HU の実戦レンジに対する強さに近づけるため）
// =============================================================

const TABLE: Uint16Array = (() => {
  const parts = PREFLOP_EQUITY_PERMILLE.split(',')
  const t = new Uint16Array(parts.length)
  for (let i = 0; i < parts.length; i++) t[i] = Number(parts[i])
  return t
})()

/** 正準ハンド i が j に勝つ確率（0..1、タイ=0.5、カードリムーバル無視） */
export function handEquity(i: number, j: number): number {
  if (i <= j) return TABLE[triIndex(i, j)]! / 1000
  return 1 - TABLE[triIndex(j, i)]! / 1000
}

const TOTAL_COMBOS = 1326

/** 重み付き平均勝率（weights[j] = 対象レンジ内のコンボ数） */
function avgEquityVs(i: number, weights: ArrayLike<number>): number {
  let sum = 0
  let w = 0
  for (let j = 0; j < HAND_KINDS; j++) {
    const wj = weights[j]!
    if (wj > 0) {
      sum += wj * handEquity(i, j)
      w += wj
    }
  }
  return w > 0 ? sum / w : 0.5
}

// ---- ハンド序列（percentile）の構築 ----------------------------------

const COMBO_W = new Float64Array(HAND_KINDS)
for (let i = 0; i < HAND_KINDS; i++) COMBO_W[i] = comboCount(i)

function buildPercentiles(): Float64Array {
  // 第1段: vs ランダム
  const eq0 = new Float64Array(HAND_KINDS)
  for (let i = 0; i < HAND_KINDS; i++) eq0[i] = avgEquityVs(i, COMBO_W)

  // 上位50%（コンボ加重）のレンジを作る
  const order0 = [...Array(HAND_KINDS).keys()].sort((a, b) => eq0[b]! - eq0[a]!)
  const topHalf = new Float64Array(HAND_KINDS)
  let acc = 0
  for (const idx of order0) {
    if (acc >= TOTAL_COMBOS / 2) break
    topHalf[idx] = COMBO_W[idx]!
    acc += COMBO_W[idx]!
  }

  // 第2段: 上位50%レンジに対する勝率で最終序列
  const eq1 = new Float64Array(HAND_KINDS)
  for (let i = 0; i < HAND_KINDS; i++) eq1[i] = avgEquityVs(i, topHalf)

  const order1 = [...Array(HAND_KINDS).keys()].sort((a, b) => eq1[b]! - eq1[a]!)
  const pct = new Float64Array(HAND_KINDS)
  let cum = 0
  for (const idx of order1) {
    pct[idx] = (cum + COMBO_W[idx]! / 2) / TOTAL_COMBOS
    cum += COMBO_W[idx]!
  }
  return pct
}

/** ハンドの強さ百分位（0 に近いほど強い） */
export const HAND_PERCENTILE: Float64Array = buildPercentiles()

/** 「トップ pct レンジ」に対する i の平均勝率（プリフロップ） */
export function equityVsTopRange(i: number, pct: number): number {
  const weights = new Float64Array(HAND_KINDS)
  for (let j = 0; j < HAND_KINDS; j++) {
    if (HAND_PERCENTILE[j]! <= pct) weights[j] = COMBO_W[j]!
  }
  return avgEquityVs(i, weights)
}

// ---- レンジのコンボ列挙（ポストフロップの MC サンプリング用） --------

const rangeComboCache = new Map<number, [number, number][]>()

/** トップ pct レンジに含まれる具体的コンボの一覧（5% 刻みでキャッシュ） */
export function topRangeCombos(pct: number): [number, number][] {
  const key = Math.max(1, Math.min(20, Math.round(pct * 20))) // 0.05 刻み
  const cached = rangeComboCache.get(key)
  if (cached) return cached
  const bound = key / 20
  const out: [number, number][] = []
  for (let i = 0; i < HAND_KINDS; i++) {
    if (HAND_PERCENTILE[i]! <= bound) out.push(...combosOf(i))
  }
  rangeComboCache.set(key, out)
  return out
}
