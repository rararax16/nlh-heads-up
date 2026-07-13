import { HAND_KINDS } from './equityGen'
import { handEquity } from './equity'
import { comboCount } from './handIndex'

// =============================================================
// ヘッズアップ プッシュ/フォールド Nash 均衡ソルバー
//
// ショートスタック（目安 ≦10〜12BB）では「SB はオールイン or フォールド、
// BB はコール or フォールド」に行動を制限したゲームの均衡が
// フルゲームのほぼ最適戦略になることが知られている。
// このゲームは 169 ハンドのジャム確率/コール確率を戦略とする
// 2人ゼロサム相当のゲームで、fictitious play で均衡へ収束させられる。
//
// 単位はすべて BB。カードリムーバル（ブロッカー）は無視する
// （一般的なプッシュ/フォールド計算機と同等の近似）。
// =============================================================

export interface JamFoldSolution {
  /** 正準ハンドごとの SB ジャム確率 (0..1) */
  jam: Float64Array
  /** 正準ハンドごとの BB コール確率 (0..1) */
  call: Float64Array
  /** コンボ加重のジャムレンジ比率 */
  jamFrac: number
  /** コンボ加重のコールレンジ比率 */
  callFrac: number
}

const TOTAL_COMBOS = 1326
const W = new Float64Array(HAND_KINDS)
for (let i = 0; i < HAND_KINDS; i++) W[i] = comboCount(i)

const cache = new Map<string, JamFoldSolution>()

/**
 * 実効スタック effBB（BB建て・ハンド開始時点）と BB アンティ anteBB の
 * ジャム/フォールド均衡を解く。結果は量子化してキャッシュ。
 */
export function solveJamFold(effBB: number, anteBB: number): JamFoldSolution {
  // 量子化: スタック 0.5BB 刻み / アンティ 0.25BB 刻み
  const e = Math.min(25, Math.max(1, Math.round(effBB * 2) / 2))
  const a = Math.min(2, Math.max(0, Math.round(anteBB * 4) / 4), e * 0.5)
  const key = `${e}:${a}`
  const hit = cache.get(key)
  if (hit) return hit

  const pot = 2 * e - a // コール成立時のポット
  const riskSB = e - a // SB がコールされた際に賭かる額（BB はアンティ分薄い）
  const evSbFold = -0.5
  const evBbFold = -(1 + a)

  const jamAvg = new Float64Array(HAND_KINDS).fill(1)
  const callAvg = new Float64Array(HAND_KINDS).fill(0)
  const jamBR = new Float64Array(HAND_KINDS)
  const callBR = new Float64Array(HAND_KINDS)

  const ITERS = 400
  for (let t = 1; t <= ITERS; t++) {
    // --- BB の最適応答（現在の平均ジャムレンジに対して） ---
    let wJam = 0
    for (let s = 0; s < HAND_KINDS; s++) wJam += W[s]! * jamAvg[s]!
    for (let h = 0; h < HAND_KINDS; h++) {
      if (wJam <= 1e-9) {
        callBR[h] = 0
        continue
      }
      let eqSum = 0
      for (let s = 0; s < HAND_KINDS; s++) {
        const w = W[s]! * jamAvg[s]!
        if (w > 0) eqSum += w * handEquity(h, s)
      }
      const evCall = (eqSum / wJam) * pot - e
      callBR[h] = evCall > evBbFold ? 1 : 0
    }

    // --- SB の最適応答（現在の平均コールレンジに対して） ---
    for (let h = 0; h < HAND_KINDS; h++) {
      let ev = 0
      for (let c = 0; c < HAND_KINDS; c++) {
        const pCall = callAvg[c]!
        ev +=
          W[c]! *
          ((1 - pCall) * (1 + a) + pCall * (handEquity(h, c) * pot - riskSB))
      }
      jamBR[h] = ev / TOTAL_COMBOS > evSbFold ? 1 : 0
    }

    // fictitious play: 平均戦略へ混ぜ込む
    for (let h = 0; h < HAND_KINDS; h++) {
      jamAvg[h]! += (jamBR[h]! - jamAvg[h]!) / t
      callAvg[h]! += (callBR[h]! - callAvg[h]!) / t
    }
  }

  let jamFrac = 0
  let callFrac = 0
  for (let h = 0; h < HAND_KINDS; h++) {
    jamFrac += W[h]! * jamAvg[h]!
    callFrac += W[h]! * callAvg[h]!
  }
  const solution: JamFoldSolution = {
    jam: jamAvg,
    call: callAvg,
    jamFrac: jamFrac / TOTAL_COMBOS,
    callFrac: callFrac / TOTAL_COMBOS,
  }
  cache.set(key, solution)
  return solution
}
