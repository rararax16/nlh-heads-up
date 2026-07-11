# デプロイ手順

本番は **Vercel（アプリ）+ Supabase（DB）** の 2 系統で動く。

- **アプリ本体**: Vercel の GitHub 連携が `main` への push で自動デプロイ
- **DB マイグレーション**: GitHub Actions（[.github/workflows/db-migrate.yml](.github/workflows/db-migrate.yml)）が
  `supabase/migrations/**` の変更時に `supabase db push` を実行

## 1. 本番 Supabase プロジェクト

1. https://supabase.com/dashboard で本番プロジェクトを作成
2. 次の値を控える
   - **Project ref**（Project Settings → General → Reference ID）
   - **DB password**（作成時に設定したもの。忘れたら Database → Reset database password）
   - **API URL / anon key / service_role key**（Project Settings → API）
3. **Personal access token** を発行（Account → Access Tokens）

## 2. GitHub Secrets（マイグレーション用）

リポジトリ → Settings → Secrets and variables → Actions → New repository secret で 3 つ登録:

| 名前 | 値 |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | 手順1-3 のアクセストークン |
| `SUPABASE_DB_PASSWORD` | 本番 DB パスワード |
| `SUPABASE_PROJECT_ID` | 本番 Project ref |

登録後、Actions タブから `Deploy DB migrations` を **Run workflow**（`workflow_dispatch`）で初回適用できる。

## 3. Vercel 環境変数（ランタイム用）

Vercel プロジェクト → Settings → Environment Variables（Production スコープ）:

| 名前 | 値 |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_KEY` | anon key |
| `SUPABASE_SERVICE_KEY` | service_role key（**絶対にクライアントへ露出させない**） |

> `SUPABASE_SERVER_URL` は Docker 専用。Vercel では未設定でよい（`SUPABASE_URL` にフォールバック）。

## 4. Vercel と GitHub の連携

Vercel Dashboard → Add New Project → `rararax16/nlh-heads-up` を import。
Nuxt は自動検出され、[nuxt.config.ts](nuxt.config.ts) の `nitro.preset: 'vercel'` でそのままデプロイされる。

## 順序に関する注意

マイグレーション（GitHub Actions）とアプリデプロイ（Vercel）は並行して走る。
今回の初期スキーマはテーブル新規作成のみで後方互換なので問題ないが、
**破壊的なスキーマ変更を入れるときは「先にマイグレーション → 後からアプリ」** の順を意識すること。
