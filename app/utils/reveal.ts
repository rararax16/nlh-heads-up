// オールイン時のボード段階公開（ランアウト演出）のタイミング定義。
// 対戦画面（表示側）と useRoom（次ハンド送りの遅延）で共有する。

/** 結果到着から最初のストリート公開までの間 */
export const REVEAL_FIRST_MS = 800
/** ストリート公開の間隔（フロップ→ターン→リバー） */
export const REVEAL_STEP_MS = 1100
/** 公開すべきストリートが無い場合に結果バナーを出すまでの間 */
export const RESULT_ONLY_MS = 300

/** ストリート境界（ボード枚数）。フロップ=3, ターン=4, リバー=5 */
const STREET_BOUNDARIES = [3, 4, 5]

/** from 枚 → to 枚 に増えるとき、段階公開するストリートの枚数リスト */
export function revealTargets(from: number, to: number): number[] {
  return STREET_BOUNDARIES.filter((b) => b > from && b <= to)
}

/** 結果到着からバナー表示までの所要時間（次ハンド送りの遅延にも使う） */
export function runoutDurationMs(from: number, to: number): number {
  const steps = revealTargets(from, to).length
  return steps === 0 ? RESULT_ONLY_MS : REVEAL_FIRST_MS + steps * REVEAL_STEP_MS
}
