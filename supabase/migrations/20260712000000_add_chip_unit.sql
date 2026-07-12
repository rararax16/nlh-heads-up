-- 最小チップ単位: ベット/レイズの合計額はこの倍数のみ許可（オールインは端数可）。
-- ブラインド構造も部屋作成時にこの単位へ丸めて保存する。
-- 既存の部屋は 1（制限なし）として従来挙動を維持。新規作成はアプリ側デフォルト 100。
alter table public.rooms
  add column chip_unit integer not null default 1 check (chip_unit > 0);
