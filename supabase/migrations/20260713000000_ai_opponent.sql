-- =============================================================
-- AI 対戦（vs GTO AI）対応
--
-- AI の席は auth.users に紐づかない仮想プレイヤーとして表現する:
--   * room_players.user_id を nullable 化し、is_ai フラグを追加
--   * hole_cards.user_id も nullable 化（AI のホールカード保存用）
--
-- 秘匿性は既存 RLS がそのまま機能する:
--   * hole_cards の閲覧は `user_id = auth.uid()` — user_id が NULL の
--     AI の手札はどのクライアントにもマッチせず、ショーダウンでの
--     revealed = true 経由でのみ公開される（人間の相手と同じ挙動）
--   * AI の意思決定は Nitro サーバー（service_role）のみが行う
-- =============================================================

alter table public.room_players alter column user_id drop not null;
alter table public.room_players add column is_ai boolean not null default false;

-- AI 席は user_id を持たない・人間席は必ず持つ
alter table public.room_players
  add constraint room_players_ai_user check (
    (is_ai and user_id is null) or (not is_ai and user_id is not null)
  );

alter table public.hole_cards alter column user_id drop not null;
