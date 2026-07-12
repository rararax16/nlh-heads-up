-- =============================================================
-- ゾンビデータの定期掃除（pg_cron・毎時実行）
--
-- 背景: ゲーム進行は完全にクライアント駆動（タイムアウト請求・次ハンド送りは
-- 画面を開いているブラウザが行う）ため、両者が離脱した playing 部屋は
-- 誰も進められず永久に残る。waiting / finished も期限なしで蓄積する。
--
-- ポリシー:
--   ① waiting  : 作成から24時間で削除（相手が来なかった募集）
--   ② playing  : ハンド更新が2時間途絶したら勝者なしで強制終了
--   ③ finished : 決着から7日で削除（hands 等はカスケード削除）
--   ④ 匿名ユーザー: 作成30日超かつ直近30日活動なしで削除
-- =============================================================

create or replace function public.cleanup_stale_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ① 相手が来なかった waiting 部屋
  delete from public.rooms
  where status = 'waiting'
    and created_at < now() - interval '24 hours';

  -- ② 両者離脱で凍結した playing 部屋 → 勝者なしで終了
  --    アクティブな対局は毎アクションで hands.updated_at が進むため誤爆しない
  update public.rooms r
  set status = 'finished',
      updated_at = now()
  where r.status = 'playing'
    and r.updated_at < now() - interval '2 hours'
    and not exists (
      select 1 from public.hands h
      where h.room_id = r.id
        and h.updated_at > now() - interval '2 hours'
    );

  -- ③ 決着から7日経過した部屋（配下の hands / hole_cards / hand_secrets /
  --    actions はカスケードで削除される）
  delete from public.rooms
  where status = 'finished'
    and updated_at < now() - interval '7 days';

  -- ④ 堆積した匿名ユーザー（進行中の部屋に着席中 or 直近30日に対局した
  --    ユーザーは残す）。削除時は本人作成の部屋・座席等もカスケードで消える
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '30 days'
    and not exists (
      select 1
      from public.room_players rp
      join public.rooms r on r.id = rp.room_id
      where rp.user_id = u.id
        and (r.status <> 'finished' or r.updated_at > now() - interval '30 days')
    );
end;
$$;

-- PostgREST の /rpc から匿名・認証ユーザーが叩けないようにする
-- （叩かれても期限切れデータの掃除しか起きないが、原則最小権限）
revoke execute on function public.cleanup_stale_data() from public, anon, authenticated;

-- pg_cron が使える環境（本番 Supabase / ローカル）では毎時17分にスケジュール。
-- 拡張が無い環境でもマイグレーション自体は失敗させない。
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension pg_cron;
    exception when others then
      raise notice 'pg_cron を有効化できないためスケジュールをスキップ: %', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 同名ジョブは上書きされる（再実行安全）
    perform cron.schedule(
      'cleanup-stale-data-hourly',
      '17 * * * *',
      'select public.cleanup_stale_data()'
    );
  end if;
end $$;
