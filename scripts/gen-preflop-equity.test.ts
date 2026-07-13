import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { generateEquityTable } from '../server/game/ai/equityGen'

// =============================================================
// 169x169 プリフロップ勝率表の生成スクリプト（vitest 経由で実行）
//
//   GEN_EQUITY=1 pnpm vitest run scripts/gen-preflop-equity.test.ts
//
// 通常の `pnpm test` ではスキップされる。結果は
// server/game/ai/data/preflopEquity.ts へ書き出してコミットする。
// =============================================================

const SAMPLES = 40000
const SEED = 20260713

it.skipIf(!process.env.GEN_EQUITY)(
  'プリフロップ勝率表を生成して data/preflopEquity.ts に書き出す',
  { timeout: 60 * 60 * 1000 },
  () => {
    const started = Date.now()
    const table = generateEquityTable(SAMPLES, SEED, (done, total) => {
      if (done % 2000 === 0 || done === total) {
        const sec = ((Date.now() - started) / 1000).toFixed(0)
        console.log(`equity: ${done}/${total} (${sec}s)`)
      }
    })

    const body = [
      '// 自動生成ファイル - 手で編集しないこと',
      `// 生成: GEN_EQUITY=1 pnpm vitest run scripts/gen-preflop-equity.test.ts`,
      `// samples/pair=${SAMPLES}, seed=${SEED}, 生成日=${new Date().toISOString().slice(0, 10)}`,
      '// 169x169 正準ハンド間プリフロップ勝率（上三角 i<=j・per-mille・タイ=0.5）',
      `export const PREFLOP_EQUITY_PERMILLE =`,
      `  '${Array.from(table).join(',')}'`,
      '',
    ].join('\n')

    writeFileSync('server/game/ai/data/preflopEquity.ts', body)
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  },
)
