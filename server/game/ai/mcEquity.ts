import { eval7 } from './fastEval'
import { topRangeCombos } from './equity'

// =============================================================
// ポストフロップのモンテカルロ勝率計算
//
// 相手のハンドを「トップ X% レンジ」から一様サンプルし、
// 残りボードをランアウトして自ハンドの勝率を推定する。
// 高速評価器（fastEval）により 1 決定あたり数百サンプルを
// 数 ms で処理できる（サーバーレスの 1 リクエスト内で完結）。
// =============================================================

const used = new Uint8Array(52)
const mine = new Int32Array(7)
const theirs = new Int32Array(7)

/**
 * 自ハンド hole（2枚）と board（3〜5枚）から、トップ rangePct レンジに
 * 対する勝率（タイ=0.5）を推定する。
 */
export function mcEquityVsRange(
  hole: [number, number],
  board: number[],
  rangePct: number,
  samples = 700,
  rand: () => number = Math.random,
): number {
  used.fill(0)
  used[hole[0]] = 1
  used[hole[1]] = 1
  for (const b of board) used[b] = 1

  // レンジ内でホール/ボードと衝突しないコンボを先に絞り込む
  let combos = topRangeCombos(rangePct).filter(([a, b]) => !used[a] && !used[b])
  if (combos.length === 0) combos = topRangeCombos(1).filter(([a, b]) => !used[a] && !used[b])

  mine[0] = hole[0]
  mine[1] = hole[1]
  for (let k = 0; k < board.length; k++) {
    mine[2 + k] = board[k]!
    theirs[2 + k] = board[k]!
  }
  const need = 5 - board.length

  let halfPoints = 0
  for (let n = 0; n < samples; n++) {
    const opp = combos[(rand() * combos.length) | 0]!
    used[opp[0]] = 1
    used[opp[1]] = 1
    theirs[0] = opp[0]
    theirs[1] = opp[1]

    for (let k = 0; k < need; k++) {
      let c = (rand() * 52) | 0
      while (used[c]) c = (rand() * 52) | 0
      used[c] = 1
      mine[2 + board.length + k] = c
      theirs[2 + board.length + k] = c
    }

    const vm = eval7(mine)
    const vt = eval7(theirs)
    if (vm > vt) halfPoints += 2
    else if (vm === vt) halfPoints += 1

    used[opp[0]] = 0
    used[opp[1]] = 0
    for (let k = 0; k < need; k++) used[mine[2 + board.length + k]!] = 0
  }

  return halfPoints / (2 * samples)
}
