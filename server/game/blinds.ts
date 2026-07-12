import type { BlindLevel } from '~~/shared/types'

/**
 * 標準的なブラインド構造プリセットを生成する。
 * BB は概ね前レベルの 1.5〜2 倍で上昇。ante は bb と同額（BBアンティ）。
 */
export function defaultBlindStructure(startingBb = 200, levels = 20): BlindLevel[] {
  // よく使われるトーナメント風の倍率カーブ
  const multipliers = [
    1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768,
  ]
  const out: BlindLevel[] = []
  for (let i = 0; i < levels; i++) {
    const m = multipliers[Math.min(i, multipliers.length - 1)]!
    const bb = roundBlind(startingBb * m)
    out.push({ level: i + 1, sb: Math.max(1, Math.round(bb / 2)), bb, ante: bb })
  }
  return out
}

/** ブラインドを見栄えの良い刻みに丸める */
function roundBlind(v: number): number {
  if (v < 100) return Math.round(v / 5) * 5
  if (v < 1000) return Math.round(v / 25) * 25
  if (v < 10000) return Math.round(v / 100) * 100
  return Math.round(v / 500) * 500
}

/**
 * ブラインド構造を最小チップ単位に合わせる。
 * bb/ante は単位の倍数へ丸め（最低 1 単位）。これによりベット/レイズの
 * 合法額が常に単位の倍数になる。sb は bb/2（端数可・支払いは正確に行われる）。
 */
export function snapStructureToChipUnit(
  structure: BlindLevel[],
  chipUnit: number,
): BlindLevel[] {
  if (chipUnit <= 1) return structure
  return structure.map((l) => {
    const bb = Math.max(chipUnit, Math.round(l.bb / chipUnit) * chipUnit)
    const ante = l.ante > 0 ? Math.max(chipUnit, Math.round(l.ante / chipUnit) * chipUnit) : 0
    return { level: l.level, sb: Math.max(1, Math.round(bb / 2)), bb, ante }
  })
}

/**
 * 経過時間からブラインドレベルを算出（タイムスタンプ方式・常駐タイマー不要）。
 * @param startedAt 対局開始時刻
 * @param intervalSeconds レベルアップ間隔（秒）
 * @param structure ブラインド構造
 * @param now 現在時刻（省略時は now）
 */
export function currentLevel(
  startedAt: Date | string | null,
  intervalSeconds: number,
  structure: BlindLevel[],
  now: Date = new Date(),
): BlindLevel {
  if (!startedAt) return structure[0]!
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt
  const elapsed = (now.getTime() - start.getTime()) / 1000
  const idx = Math.min(
    Math.max(0, Math.floor(elapsed / intervalSeconds)),
    structure.length - 1,
  )
  return structure[idx]!
}

/** 次のレベルアップ時刻（最終レベル到達後は null） */
export function nextLevelAt(
  startedAt: Date | string | null,
  intervalSeconds: number,
  structure: BlindLevel[],
  now: Date = new Date(),
): string | null {
  if (!startedAt) return null
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt
  const elapsed = (now.getTime() - start.getTime()) / 1000
  const idx = Math.floor(elapsed / intervalSeconds)
  if (idx >= structure.length - 1) return null
  return new Date(start.getTime() + (idx + 1) * intervalSeconds * 1000).toISOString()
}
