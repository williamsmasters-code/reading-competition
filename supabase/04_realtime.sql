-- =====================================================================
-- Michelle Coy Reading Competition: 04_realtime.sql
-- Live updates (Supabase Realtime, postgres_changes). Realtime still applies
-- Row Level Security, so a judge only receives changes to their own scores.
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['readers','scores','sheets','panel','criteria','event_settings','finalization','revert_requests','photos','profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
