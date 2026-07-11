# ♠ NLH ヘッズアップ対戦アプリ

リアルタイムで 1vs1（ヘッズアップ）の No-Limit Hold'em を対戦できる Web アプリ。
部屋を作成 → 部屋コードで入室 → トーナメントルール（SB/BB + BBアンティ、時間経過でブラインド上昇）で対決します。

- **プラットフォーム**: Vercel（Nuxt 4 / Nitro）
- **バックエンド**: Supabase（Postgres + Realtime + 匿名認証）
- **開発環境**: Docker Compose（アプリ）+ Supabase CLI（バックエンド）

---

## アーキテクチャ

Vercel はサーバーレスで常時起動の WebSocket サーバーを持てないため、次の設計で**サーバー権威**と**リアルタイム性**を両立しています。

```
[プレイヤーA] ─┐                              ┌─ Supabase Postgres（唯一の真実）
[プレイヤーB] ─┼─→ Nitro API (Vercel/Docker) ─┤   RLS でカード秘匿
               │      ゲームロジック(TS)         └─ Supabase Realtime（変更を両者へ配信）
               └──────────── 購読 ←───────────────┘
```

### 3つの重要な設計判断

1. **サーバー権威**: シャッフル・配札・ベット処理・勝敗判定はすべて Nitro サーバー（`service_role`）が実行。
   クライアントには相手の手札を送りません（イカサマ防止）。
2. **秘匿の3層**（[マイグレーション](supabase/migrations/) 参照）
   - `hands` … 公開ゲーム状態（ボード/ポット/手番）→ 部屋メンバーは閲覧可
   - `hole_cards` … 各自のホールカード → **本人のみ**（RLS）、ショーダウンで公開
   - `hand_secrets` … 未使用デッキ → **クライアントは一切閲覧不可**（RLS ポリシー無し、service_role のみ）
3. **タイムスタンプ方式のタイマー**（常駐タイマー不要 = サーバーレス向き）
   - ブラインドレベル = `開始時刻からの経過時間` で算出
   - アクション制限 = 手番開始時に `action_deadline` を保存し、期限超過はクライアントが「タイムアウト請求」→ サーバーが期限を検証して自動フォールド/チェック

### ヘッズアップ特有ルール（実装済み）

- ボタン席 = SB、相手 = BB。**プリフロップは SB(ボタン) が先手、フロップ以降は BB が先手**
- BBアンティ（BB のみアンティを死に金として拠出）
- 未コールのオールイン超過分の返却、スプリットポット、最小レイズ、ショートオールインの再レイズ制限に対応

---

## 必要なもの

- Node.js 22+ / [pnpm](https://pnpm.io/) 10+
- Docker（Docker Compose v2+）
- Supabase CLI は devDependency として同梱（`pnpm exec supabase ...`）

---

## セットアップ & 起動

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. Supabase ローカルスタックの起動

```bash
pnpm db:start      # = supabase start（初回は Docker イメージを取得）
pnpm db:reset      # マイグレーション適用（スキーマ + RLS + grants）
```

起動時に表示される `API URL` / `anon key` / `service_role key` を確認し、`.env` を用意します。

```bash
cp .env.example .env
# 表示された値に合わせて SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_KEY を設定
```

> `.env.example` の値は Supabase ローカル開発の well-known デモキーです。多くの環境でそのまま動きます。

### 3. アプリの起動（いずれか）

**A. Docker Compose（推奨・開発環境を統一）**

```bash
pnpm docker:up     # = docker compose up --build
```

アプリコンテナはホスト上の Supabase へ `host.docker.internal:54321` 経由で接続します。
→ http://localhost:3000

**B. ローカルで直接**

```bash
pnpm dev
```

→ http://localhost:3000（使用中なら 3001 等にフォールバック）

### 4. 対戦する

1. ブラウザで開く（自動で匿名サインイン）
2. 表示名を入れて「部屋を作成」→ 部屋コードが発行される
3. **別のブラウザ / シークレットウィンドウ**でコードを入れて入室
4. 作成者が「対局を開始」→ ヘッズアップ開始

---

## テスト

```bash
pnpm test          # 全テスト（要 Supabase 起動: 統合テストが DB を使用）
```

- `tests/engine.test.ts` … ポーカーエンジンの単体テスト（ブラインド/手番順/フォールド/ショーダウン/オールイン/返却/最小レイズ）
- `tests/integration.test.ts` … 作成→入室→開始→全ハンド消化→バスト決着、チップ総量保存、カード秘匿を検証
- `tests/http-smoke.mjs` … HTTP + 認証層のスモーク（`node tests/http-smoke.mjs`、dev/コンテナ起動が前提）

---

## 環境変数

| 変数 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase API URL（ブラウザ/SSR） |
| `SUPABASE_KEY` | anon キー（公開可） |
| `SUPABASE_SERVICE_KEY` | service_role キー（**サーバー専用・秘匿**）。`@nuxtjs/supabase` が参照 |

---

## プロジェクト構成

```
├── docker-compose.yml        # Nuxt アプリの開発コンテナ
├── Dockerfile.dev
├── nuxt.config.ts            # @nuxtjs/supabase, vercel preset
├── shared/types.ts           # クライアント/サーバー共有の型
├── server/
│   ├── game/                 # 純粋なゲームロジック（フレームワーク非依存）
│   │   ├── cards.ts          #   デッキ + 暗号論的シャッフル
│   │   ├── blinds.ts         #   ブラインド構造 + 経過時間からのレベル算出
│   │   ├── evaluator.ts      #   役判定（pokersolver ラッパ）
│   │   ├── engine.ts         #   ハンド進行の状態機械（サーバー権威）
│   │   └── persistence.ts    #   Engine <-> DB のマッピング
│   ├── utils/
│   │   ├── gameService.ts    # DB オーケストレーション（作成/入室/開始/配札/アクション）
│   │   └── http.ts           # 認証・エラーハンドリング
│   └── api/rooms/            # Nitro API ルート
├── app/                      # Nuxt フロント（ロビー + テーブル UI + Realtime）
│   ├── pages/index.vue       #   ロビー（作成/コード参加/公開部屋一覧）
│   ├── pages/room/[code].vue #   対戦テーブル
│   ├── composables/useRoom.ts#   状態取得 + Realtime 購読 + 自動処理
│   └── components/PlayingCard.vue
└── supabase/
    ├── config.toml           # 匿名認証を有効化
    └── migrations/           # スキーマ + RLS + grants + realtime publication
```

---

## Vercel へのデプロイ

1. [Supabase](https://supabase.com/) でプロジェクトを作成し、`supabase/migrations` を本番に適用
   ```bash
   pnpm exec supabase link --project-ref <your-ref>
   pnpm exec supabase db push
   ```
   ダッシュボードの Authentication で **Anonymous sign-ins** を有効化。
2. Vercel にインポートし、環境変数を設定
   - `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY`（本番プロジェクトの値）
3. デプロイ（Nitro の `vercel` preset を使用）

---

## MVP のスコープと今後

**実装済み**: 部屋作成/入室、公開ロビー、ヘッズアップ対戦本体、ブラインド上昇、BBアンティ、
タイムバンク、Realtime 同期、匿名認証、サーバー権威 + カード秘匿。

**今後の候補**:
- アカウント連携（匿名 → メール等へのアップグレード）と戦績/ハンド履歴
- 再戦（リマッチ）、チャット/エモート、観戦
- 切断時の猶予・再接続 UX の強化
