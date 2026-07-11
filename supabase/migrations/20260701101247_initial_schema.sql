-- =============================================================
-- NLH ヘッズアップ対戦アプリ 初期スキーマ
-- 設計方針:
--   * サーバー権威: 状態の更新はすべて service_role（Nitro サーバー）が行う。
--     クライアントは INSERT/UPDATE 権限を持たない（読み取りのみ）。
--   * 秘匿の3層:
--       - hands       : 公開ゲーム状態（ボード/ポット/手番など）→ 部屋メンバーは閲覧可
--       - hole_cards  : 各自のホールカード → 本人 or ショーダウンで公開されたもののみ閲覧可
--       - hand_secrets: 未使用デッキ等 → RLS 有効・ポリシー無し = クライアントは一切閲覧不可
-- =============================================================

-- ------------------------------------------------------------------
-- rooms: ヘッズアップの部屋
-- ------------------------------------------------------------------
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                         -- 入室用の短いコード
  name          text,
  status        text not null default 'waiting'
                  check (status in ('waiting', 'playing', 'finished')),
  is_public     boolean not null default true,                -- ロビー一覧に出すか
  created_by    uuid not null references auth.users(id) on delete cascade,

  -- 部屋作成時に決める設定
  initial_stack         integer not null default 10000 check (initial_stack > 0),
  blind_interval_seconds integer not null default 300 check (blind_interval_seconds > 0),
  action_timeout_seconds integer not null default 30  check (action_timeout_seconds > 0),
  ante_mode     text not null default 'bb'
                  check (ante_mode in ('none', 'bb')),         -- BB アンティ（BB のみ支払）
  -- ブラインド構造: [{ "level":1, "sb":25, "bb":50, "ante":50 }, ...]
  blind_structure jsonb not null,

  -- 対局進行
  started_at    timestamptz,                                   -- ブラインドレベル算出の基点
  hand_number   integer not null default 0,
  button_seat   smallint,                                      -- 次ハンドのボタン席（0/1）
  winner_seat   smallint,                                      -- 対局の勝者席

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index rooms_lobby_idx on public.rooms (is_public, status, created_at desc);

-- ------------------------------------------------------------------
-- room_players: 座席（ヘッズアップなので最大2）
-- ------------------------------------------------------------------
create table public.room_players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  seat         smallint not null check (seat in (0, 1)),
  display_name text not null,
  stack        integer not null default 0,
  connected    boolean not null default true,
  joined_at    timestamptz not null default now(),
  unique (room_id, seat),
  unique (room_id, user_id)
);

create index room_players_room_idx on public.room_players (room_id);

-- ------------------------------------------------------------------
-- ヘルパー: 呼び出しユーザーが部屋のメンバーか判定
-- （RLS 再帰回避のため SECURITY DEFINER。room_players 定義後に作成）
-- ------------------------------------------------------------------
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------------
-- hands: 1ハンド分の公開ゲーム状態（秘匿情報は含めない）
-- ------------------------------------------------------------------
create table public.hands (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  hand_number   integer not null,
  button_seat   smallint not null check (button_seat in (0, 1)),
  level         integer not null,
  sb            integer not null,
  bb            integer not null,
  ante          integer not null default 0,

  board         jsonb not null default '[]'::jsonb,            -- 公開されたコミュニティカード
  pot           integer not null default 0,
  street        text not null default 'preflop'
                  check (street in ('preflop','flop','turn','river','showdown','complete')),
  to_act_seat   smallint check (to_act_seat in (0, 1)),
  action_deadline timestamptz,                                 -- 手番の制限期限（タイムバンク）

  current_bet   integer not null default 0,                    -- 現ストリートの最高ベット額
  min_raise     integer not null default 0,                    -- 最小レイズ幅
  last_aggressor_seat smallint,
  dead_money    integer not null default 0,                    -- アンティ等の死に金（席のcommittedに含めない）
  block_reraise_seat smallint,                                 -- ショートオールインで再レイズ不可の席

  -- 各席の当ハンドの状態（ホールカードは含めない）
  -- { "0": {"committed":0,"street_committed":0,"folded":false,"allin":false,"stack":10000},
  --   "1": {...} }
  seats         jsonb not null default '{}'::jsonb,

  result        jsonb,                                         -- 結果（勝者/配当/公開手札など）
  version       integer not null default 0,                    -- 楽観ロック
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (room_id, hand_number)
);

create index hands_room_idx on public.hands (room_id, hand_number desc);

-- ------------------------------------------------------------------
-- hole_cards: 各席のホールカード（本人のみ / 公開後は全員閲覧可）
-- ------------------------------------------------------------------
create table public.hole_cards (
  hand_id   uuid not null references public.hands(id) on delete cascade,
  seat      smallint not null check (seat in (0, 1)),
  user_id   uuid not null references auth.users(id) on delete cascade,
  cards     jsonb not null,                                    -- ["As","Kd"]
  revealed  boolean not null default false,                    -- ショーダウンで公開されたか
  primary key (hand_id, seat)
);

-- ------------------------------------------------------------------
-- hand_secrets: 未使用デッキ等の完全秘匿情報（service_role のみ）
-- ------------------------------------------------------------------
create table public.hand_secrets (
  hand_id   uuid primary key references public.hands(id) on delete cascade,
  deck      jsonb not null                                     -- 残りデッキ（配布順）
);

-- ------------------------------------------------------------------
-- actions: アクション履歴（アニメーション/履歴/リアルタイム通知用）
-- ------------------------------------------------------------------
create table public.actions (
  id         uuid primary key default gen_random_uuid(),
  hand_id    uuid not null references public.hands(id) on delete cascade,
  seat       smallint not null check (seat in (0, 1)),
  user_id    uuid,
  street     text not null,
  type       text not null
               check (type in ('post_sb','post_bb','post_ante','fold','check',
                               'call','bet','raise','allin','timeout')),
  amount     integer not null default 0,
  created_at timestamptz not null default now()
);

create index actions_hand_idx on public.actions (hand_id, created_at);

-- =============================================================
-- RLS
-- =============================================================
alter table public.rooms         enable row level security;
alter table public.room_players  enable row level security;
alter table public.hands         enable row level security;
alter table public.hole_cards    enable row level security;
alter table public.hand_secrets  enable row level security;   -- ポリシー無し = クライアント閲覧不可
alter table public.actions       enable row level security;

-- rooms: 公開部屋 or 自分がメンバーの部屋を閲覧可（書き込みはサーバーのみ）
create policy rooms_select on public.rooms
  for select to authenticated
  using (is_public or created_by = auth.uid() or public.is_room_member(id));

-- room_players: 公開部屋 or 自分がメンバーの部屋の座席を閲覧可
create policy room_players_select on public.room_players
  for select to authenticated
  using (
    public.is_room_member(room_id)
    or exists (select 1 from public.rooms r where r.id = room_id and r.is_public)
  );

-- hands: メンバーのみ閲覧可
create policy hands_select on public.hands
  for select to authenticated
  using (public.is_room_member(room_id));

-- hole_cards: 本人のカード or 公開済みカード（かつメンバー）を閲覧可
create policy hole_cards_select on public.hole_cards
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      revealed
      and exists (
        select 1 from public.hands h
        where h.id = hand_id and public.is_room_member(h.room_id)
      )
    )
  );

-- actions: メンバーのみ閲覧可
create policy actions_select on public.actions
  for select to authenticated
  using (
    exists (select 1 from public.hands h where h.id = hand_id and public.is_room_member(h.room_id))
  );

-- =============================================================
-- 権限（GRANT）
--   service_role: サーバー権威。RLS を BYPASS しつつ全操作可能にする。
--   authenticated/anon: テーブル権限は付与するが、行アクセスは上記 RLS が支配する
--     （書き込みポリシーを定義していないため実質的に読み取り専用）。
-- =============================================================
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role, authenticated, anon;
grant select on public.rooms, public.room_players, public.hands,
  public.hole_cards, public.actions to authenticated, anon;

-- =============================================================
-- Realtime: 変更通知を配信するテーブルを publication に追加
-- （postgres_changes は RLS を尊重するため、hole_cards は本人にのみ届く）
-- =============================================================
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.hands;
alter publication supabase_realtime add table public.hole_cards;
alter publication supabase_realtime add table public.actions;
