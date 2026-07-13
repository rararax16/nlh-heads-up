import { combosOf } from './handIndex'
import { eval7, mulberry32 } from './fastEval'

// =============================================================
// 169x169 プリフロップ勝率表のモンテカルロ生成器
//
// scripts/gen-preflop-equity.md の手順で一度だけ実行し、結果を
// data/preflopEquity.ts にコミットする（ランタイムでは実行しない）。
// 対称性 e(i,j) + e(j,i) = 1（タイは 0.5 ずつ）を使い、
// 上三角 (i <= j) のみを per-mille (0..1000) で保存する。
// =============================================================

export const HAND_KINDS = 169
export const TRI_SIZE = (HAND_KINDS * (HAND_KINDS + 1)) / 2

/** 上三角の格納位置 (i <= j) */
export function triIndex(i: number, j: number): number {
  return i * HAND_KINDS - ((i * (i - 1)) / 2) + (j - i)
}

/**
 * 正準ハンド i vs j の勝率（i 視点、タイ=0.5）をモンテカルロ推定。
 * コンボの組は一様（スート対称性により rejection サンプリングで一様になる）。
 */
export function estimatePairEquity(
  i: number,
  j: number,
  samples: number,
  rand: () => number,
): number {
  const combosI = combosOf(i)
  const combosJ = combosOf(j)
  const used = new Uint8Array(52)
  const handA = new Int32Array(7)
  const handB = new Int32Array(7)

  let halfPoints = 0 // 勝ち=2 / タイ=1

  for (let n = 0; n < samples; n++) {
    const a = combosI[(rand() * combosI.length) | 0]!
    let b = combosJ[(rand() * combosJ.length) | 0]!
    while (b[0] === a[0] || b[0] === a[1] || b[1] === a[0] || b[1] === a[1]) {
      b = combosJ[(rand() * combosJ.length) | 0]!
    }

    used[a[0]] = 1
    used[a[1]] = 1
    used[b[0]] = 1
    used[b[1]] = 1
    handA[0] = a[0]
    handA[1] = a[1]
    handB[0] = b[0]
    handB[1] = b[1]

    for (let k = 2; k < 7; k++) {
      let c = (rand() * 52) | 0
      while (used[c]) c = (rand() * 52) | 0
      used[c] = 1
      handA[k] = c
      handB[k] = c
    }

    const va = eval7(handA)
    const vb = eval7(handB)
    if (va > vb) halfPoints += 2
    else if (va === vb) halfPoints += 1

    used[a[0]] = 0
    used[a[1]] = 0
    used[b[0]] = 0
    used[b[1]] = 0
    for (let k = 2; k < 7; k++) used[handA[k]!] = 0
  }

  return halfPoints / (2 * samples)
}

/**
 * 全ペアの勝率表（上三角・per-mille）を生成する。
 * seed 固定で再現可能。samples=40000 で標準誤差 ≈ 0.25%。
 */
export function generateEquityTable(
  samplesPerPair: number,
  seed = 20260713,
  onProgress?: (done: number, total: number) => void,
): Uint16Array {
  const rand = mulberry32(seed)
  const table = new Uint16Array(TRI_SIZE)
  let done = 0
  for (let i = 0; i < HAND_KINDS; i++) {
    for (let j = i; j < HAND_KINDS; j++) {
      if (i === j) {
        table[triIndex(i, j)] = 500 // 同種同士はスート対称性から厳密に 0.5
      } else {
        const eq = estimatePairEquity(i, j, samplesPerPair, rand)
        table[triIndex(i, j)] = Math.round(eq * 1000)
      }
      done++
    }
    onProgress?.(done, TRI_SIZE)
  }
  return table
}
