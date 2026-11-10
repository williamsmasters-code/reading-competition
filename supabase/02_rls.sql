-- =====================================================================
-- Michelle Coy Reading Competition: 02_rls.sql
-- Row Level Security on EVERY table + table privileges.
-- Writes that need rules (scoring, opening judging, finalizing, the panel,
-- start time, revert) go through SECURITY DEFINER functions in 03_rpcs.sql,
-- so those tables have NO insert/update/delete policies for normal users.
-- The public (anon) gets nothing from tables; the landing page uses
-- public_landing() only (published results, start time, photos).
-- =====================================================================

-- ---------- role helpers (SECURITY DEFINER so they can read profiles under RLS) ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() = 'site_admin', false) $$;
create or replace function public.is_head() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() = 'head_judge', false) $$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$ select public.my_role() is not null $$;
create or replace function public.on_panel(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.panel p join public.profiles pr on pr.id = p.judge_id
                 where p.judge_id = p_uid and pr.active and pr.role in ('judge','head_judge'))
$$;

revoke all on function public.my_role(), public.is_admin(), public.is_head(), public.is_staff(), public.on_panel(uuid) from public, anon;
grant execute on function public.my_role(), public.is_admin(), public.is_head(), public.is_staff(), public.on_panel(uuid) to authenticated;

-- ---------- turn RLS on everywhere ----------
alter table public.profiles        enable row level security;
alter table public.panel           enable row level security;
alter table public.readers         enable row level security;
alter table public.criteria        enable row level security;
alter table public.scores          enable row level security;
alter table public.sheets          enable row level security;
alter table public.event_settings  enable row level security;
alter table public.finalization    enable row level security;
alter table public.revert_requests enable row level security;
alter table public.photos          enable row level security;
alter table public.audit_log       enable row level security;

-- ---------- privileges: start from nothing, then grant the minimum ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles, public.panel, public.readers, public.criteria, public.scores, public.sheets,
                public.event_settings, public.finalization, public.revert_requests, public.photos, public.audit_log
  to authenticated;
-- Site Admin edits (still filtered by the policies below)
grant update (full_name, role, active) on public.profiles to authenticated;
grant insert (position, student_name, school, item, reading_date, round, district) on public.readers to authenticated;
grant update (position, student_name, school, item, reading_date, round, district) on public.readers to authenticated;
grant delete on public.readers to authenticated;
grant insert (position, text), update (position, text), delete on public.criteria to authenticated;
grant insert (storage_path, caption, position), update (caption, position), delete on public.photos to authenticated;
-- judging_status is NOT grantable: only open_reader()/close_reader() (Head Judge) change it.

-- ---------- policies ----------
-- profiles: yourself; the Site Admin sees everyone; the Head Judge sees judge accounts (names for the scores table)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or (public.is_head() and role in ('judge','head_judge')));
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- panel: every staff member can see who sits on the panel (their own label "Judge 2" etc.)
drop policy if exists panel_select on public.panel;
create policy panel_select on public.panel for select to authenticated using (public.is_staff());

-- readers: all staff read; Site Admin writes (not judging_status, see grants)
drop policy if exists readers_select on public.readers;
create policy readers_select on public.readers for select to authenticated using (public.is_staff());
drop policy if exists readers_insert on public.readers;
create policy readers_insert on public.readers for insert to authenticated with check (public.is_admin());
drop policy if exists readers_update on public.readers;
create policy readers_update on public.readers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists readers_delete on public.readers;
create policy readers_delete on public.readers for delete to authenticated using (public.is_admin());

-- criteria: all staff read; Site Admin writes
drop policy if exists criteria_select on public.criteria;
create policy criteria_select on public.criteria for select to authenticated using (public.is_staff());
drop policy if exists criteria_insert on public.criteria;
create policy criteria_insert on public.criteria for insert to authenticated with check (public.is_admin());
drop policy if exists criteria_update on public.criteria;
create policy criteria_update on public.criteria for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists criteria_delete on public.criteria;
create policy criteria_delete on public.criteria for delete to authenticated using (public.is_admin());

-- scores + sheets: a judge sees ONLY their own; Head Judge and Site Admin see all. Writes via RPC only.
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select to authenticated
  using ((judge_id = auth.uid() and public.is_staff()) or public.is_admin() or public.is_head());
drop policy if exists sheets_select on public.sheets;
create policy sheets_select on public.sheets for select to authenticated
  using ((judge_id = auth.uid() and public.is_staff()) or public.is_admin() or public.is_head());

-- event settings + finalization status: staff read (the public gets them via public_landing())
drop policy if exists event_select on public.event_settings;
create policy event_select on public.event_settings for select to authenticated using (public.is_staff());
drop policy if exists final_select on public.finalization;
create policy final_select on public.finalization for select to authenticated using (public.is_staff());

-- revert requests: Head Judge and Site Admin
drop policy if exists revert_select on public.revert_requests;
create policy revert_select on public.revert_requests for select to authenticated using (public.is_admin() or public.is_head());

-- photos: staff read rows here; Site Admin writes. The public sees them via public_landing().
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select to authenticated using (public.is_staff());
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated with check (public.is_admin());
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos for delete to authenticated using (public.is_admin());

-- audit log: Site Admin only
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());
