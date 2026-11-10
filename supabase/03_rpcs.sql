-- =====================================================================
-- Michelle Coy Reading Competition: 03_rpcs.sql
-- SECURITY DEFINER functions for every privileged action. Each one checks
-- the caller's role itself, then writes. Errors are short plain-English
-- messages the website shows as-is.
-- =====================================================================

create or replace function public._log(p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, action, detail) values (auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public._published() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'published' from public.finalization where id = 1), false)
$$;

-- ---------------------------------------------------------------------
-- Judges (incl. Head Judge): save scores / comments (autosave), turn in
-- ---------------------------------------------------------------------
-- p_items: [{"criterion_id":"uuid","score":1..5 or null,"comment":"text"}]
create or replace function public.save_scores(p_reader uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); st text; sh text; it jsonb; sc int; n int := 0;
begin
  if me is null or not public.on_panel(me) then raise exception 'Only judges on the panel can score.'; end if;
  if public._published() then raise exception 'Results have been posted, so scores are locked.'; end if;
  select judging_status into st from public.readers where id = p_reader;
  if st is null then raise exception 'That reader no longer exists.'; end if;
  if st = 'not_opened' then raise exception 'The Head Judge has not opened judging for this reader yet.'; end if;
  select status into sh from public.sheets where reader_id = p_reader and judge_id = me;
  if sh = 'turned_in' then raise exception 'You have already turned in this sheet. Ask the Head Judge to reopen it.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then raise exception 'Bad score data.'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.criteria where id = (it->>'criterion_id')::uuid) then
      continue;  -- criterion was removed by the Site Admin meanwhile: ignore
    end if;
    sc := nullif(it->>'score', '')::int;
    if sc is not null and (sc < 1 or sc > 5) then raise exception 'Scores must be 1 to 5.'; end if;
    insert into public.scores (reader_id, judge_id, criterion_id, score, comment, updated_at)
    values (p_reader, me, (it->>'criterion_id')::uuid, sc, left(coalesce(it->>'comment', ''), 1000), now())
    on conflict (reader_id, judge_id, criterion_id)
      do update set score = excluded.score, comment = excluded.comment, updated_at = now();
    n := n + 1;
  end loop;
  insert into public.sheets (reader_id, judge_id, status, updated_at) values (p_reader, me, 'draft', now())
    on conflict (reader_id, judge_id) do update set updated_at = now();
  return jsonb_build_object('saved', n, 'at', now());
end $$;

create or replace function public.turn_in_sheet(p_reader uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); st text; missing int;
begin
  if me is null or not public.on_panel(me) then raise exception 'Only judges on the panel can score.'; end if;
  if public._published() then raise exception 'Results have been posted, so scores are locked.'; end if;
  select judging_status into st from public.readers where id = p_reader;
  if st is null or st = 'not_opened' then raise exception 'The Head Judge has not opened judging for this reader yet.'; end if;
  select count(*) into missing from public.criteria c
   where not exists (select 1 from public.scores s where s.reader_id = p_reader and s.judge_id = me
                       and s.criterion_id = c.id and s.score is not null);
  if missing > 0 then raise exception 'Please score every criterion before you finalize (% still unscored).', missing; end if;
  insert into public.sheets (reader_id, judge_id, status, turned_in_at, updated_at)
  values (p_reader, me, 'turned_in', now(), now())
  on conflict (reader_id, judge_id) do update set status = 'turned_in', turned_in_at = now(), updated_at = now();
  perform public._log('turn_in_sheet', jsonb_build_object('reader', p_reader));
end $$;

-- ---------------------------------------------------------------------
-- Head Judge (Site Admin may also reopen a sheet): reopen a turned-in sheet
-- ---------------------------------------------------------------------
create or replace function public.reopen_sheet(p_reader uuid, p_judge uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_head() or public.is_admin()) then raise exception 'Only the Head Judge can reopen a score sheet.'; end if;
  if public._published() then raise exception 'Results are posted. Ask the Site Admin to revert the finalization first.'; end if;
  update public.sheets set status = 'draft', reopened_at = now(), reopened_by = auth.uid(), updated_at = now()
   where reader_id = p_reader and judge_id = p_judge and status = 'turned_in';
  if not found then raise exception 'That sheet is not turned in, so there is nothing to reopen.'; end if;
  perform public._log('reopen_sheet', jsonb_build_object('reader', p_reader, 'judge', p_judge));
end $$;

-- ---------------------------------------------------------------------
-- Head Judge only: open / close judging for a reader (one open at a time)
-- ---------------------------------------------------------------------
create or replace function public.open_reader(p_reader uuid, p_close_current boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare cur uuid; curname text;
begin
  if not public.is_head() then raise exception 'Only the Head Judge can open judging.'; end if;
  if public._published() then raise exception 'Results are posted, so judging is closed.'; end if;
  if not exists (select 1 from public.readers where id = p_reader) then raise exception 'That reader no longer exists.'; end if;
  select id, student_name into cur, curname from public.readers where judging_status = 'open' and id <> p_reader;
  if cur is not null then
    if not p_close_current then raise exception 'Judging is still open for %. Close it first.', curname; end if;
    update public.readers set judging_status = 'closed', closed_at = now() where id = cur;
  end if;
  update public.readers set judging_status = 'open', opened_at = now() where id = p_reader;
  perform public._log('open_reader', jsonb_build_object('reader', p_reader, 'closed', cur));
end $$;

create or replace function public.close_reader(p_reader uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_head() then raise exception 'Only the Head Judge can close judging.'; end if;
  update public.readers set judging_status = 'closed', closed_at = now() where id = p_reader and judging_status = 'open';
  if not found then raise exception 'That reader is not open.'; end if;
  perform public._log('close_reader', jsonb_build_object('reader', p_reader));
end $$;

-- ---------------------------------------------------------------------
-- Head Judge or Site Admin: event start time (NULL clears it)
-- ---------------------------------------------------------------------
create or replace function public.set_start_time(p_time time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_head() or public.is_admin()) then raise exception 'Only the Head Judge or Site Admin can set the start time.'; end if;
  update public.event_settings set start_time = p_time, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('set_start_time', jsonb_build_object('time', p_time));
end $$;

-- ---------------------------------------------------------------------
-- Site Admin only: judges panel
-- ---------------------------------------------------------------------
create or replace function public.add_to_panel(p_judge uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r text; act boolean; s int;
begin
  if not public.is_admin() then raise exception 'Only the Site Admin can add judges to the panel.'; end if;
  select role, active into r, act from public.profiles where id = p_judge;
  if r is distinct from 'judge' then raise exception 'Pick an account with the Judge role.'; end if;
  if not act then raise exception 'That account is deactivated.'; end if;
  if exists (select 1 from public.panel where judge_id = p_judge) then raise exception 'That judge is already on the panel.'; end if;
  select coalesce(max(seat), 0) + 1 into s from public.panel;
  insert into public.panel (judge_id, seat) values (p_judge, s);
  perform public._log('add_to_panel', jsonb_build_object('judge', p_judge, 'seat', s));
  return s;
end $$;

create or replace function public.remove_from_panel(p_judge uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the Site Admin can remove judges from the panel.'; end if;
  if exists (select 1 from public.profiles where id = p_judge and role = 'head_judge') then
    raise exception 'The Head Judge is always on the panel and cannot be removed.';
  end if;
  delete from public.panel where judge_id = p_judge;
  if not found then raise exception 'That judge is not on the panel.'; end if;
  perform public._log('remove_from_panel', jsonb_build_object('judge', p_judge));
end $$;

-- ---------------------------------------------------------------------
-- Site Admin only: substitute a reader (keeps the place in the running order)
-- ---------------------------------------------------------------------
create or replace function public.substitute_reader(p_reader uuid, p_name text, p_school text, p_clear_scores boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only the Site Admin can substitute a reader.'; end if;
  if public._published() then raise exception 'Results are posted. Revert the finalization before changing readers.'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Type the new reader''s name.'; end if;
  select count(*) into n from public.scores where reader_id = p_reader;
  if n > 0 and not p_clear_scores then raise exception 'This reader already has % scores. Confirm to clear them.', n; end if;
  delete from public.scores where reader_id = p_reader;
  delete from public.sheets where reader_id = p_reader;
  update public.readers set student_name = btrim(p_name), school = coalesce(btrim(p_school), school),
         judging_status = 'not_opened', opened_at = null, closed_at = null
   where id = p_reader;
  if not found then raise exception 'That reader no longer exists.'; end if;
  perform public._log('substitute_reader', jsonb_build_object('reader', p_reader, 'cleared_scores', n));
end $$;

-- ---------------------------------------------------------------------
-- Ranking: sum of every PANEL judge's total for each reader
-- (judges removed from the panel do not count). Ties share a place.
-- ---------------------------------------------------------------------
create or replace function public._ranking() returns table(place int, reader_id uuid, name text, school text, total int)
language sql stable security definer set search_path = public as $$
  with t as (
    select r.id, r.student_name, r.school, r.position,
           coalesce((select sum(s.score) from public.scores s join public.panel p on p.judge_id = s.judge_id
                     join public.criteria c on c.id = s.criterion_id
                     where s.reader_id = r.id), 0)::int as total
    from public.readers r
  )
  select (rank() over (order by total desc))::int, id, student_name, school, total
  from t order by total desc, position, student_name
$$;

-- ---------------------------------------------------------------------
-- Head Judge only: finalize -> publish on the landing page
-- ---------------------------------------------------------------------
create or replace function public.finalize_results() returns jsonb
language plpgsql security definer set search_path = public as $$
declare open_n int; missing int; nreaders int; snap jsonb;
begin
  if not public.is_head() then raise exception 'Only the Head Judge can finalize and publish results.'; end if;
  if public._published() then raise exception 'Results are already posted.'; end if;
  select count(*) into nreaders from public.readers;
  if nreaders = 0 then raise exception 'There are no readers.'; end if;
  select count(*) into open_n from public.readers where judging_status <> 'closed';
  if open_n > 0 then raise exception 'Close judging for every reader first (% not closed).', open_n; end if;
  -- every panel judge must have turned in a complete sheet for every reader
  select count(*) into missing from public.readers r cross join public.panel p
   where not exists (select 1 from public.sheets sh where sh.reader_id = r.id and sh.judge_id = p.judge_id and sh.status = 'turned_in')
      or exists (select 1 from public.criteria c where not exists (
                   select 1 from public.scores s where s.reader_id = r.id and s.judge_id = p.judge_id
                      and s.criterion_id = c.id and s.score is not null));
  if missing > 0 then raise exception 'Some score sheets are not turned in or not complete (% missing).', missing; end if;
  select coalesce(jsonb_agg(jsonb_build_object('place', place, 'name', name, 'school', school, 'total', total)), '[]'::jsonb)
    into snap from public._ranking();
  update public.finalization set status = 'published', published_at = now(), published_by = auth.uid(), results = snap where id = 1;
  perform public._log('finalize_results', jsonb_build_object('results', snap));
  return snap;
end $$;

-- Head Judge: ask the Site Admin to revert (only after publishing)
create or replace function public.request_revert(p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_head() then raise exception 'Only the Head Judge can request a revert.'; end if;
  if not public._published() then raise exception 'Results are not posted, so there is nothing to revert.'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Please give a reason.'; end if;
  insert into public.revert_requests (requested_by, reason) values (auth.uid(), left(btrim(p_reason), 1000)) returning id into rid;
  perform public._log('request_revert', jsonb_build_object('request', rid));
  return rid;
end $$;

-- Site Admin: approve (= revert the finalization) or decline a request
create or replace function public.decide_revert(p_request uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the Site Admin can revert a finalization.'; end if;
  update public.revert_requests set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = left(coalesce(p_note, ''), 500)
   where id = p_request and status = 'pending';
  if not found then raise exception 'That request was already handled.'; end if;
  if p_approve then
    update public.finalization set status = 'open', results = null, published_at = null, published_by = null,
           reverted_at = now(), reverted_by = auth.uid() where id = 1;
    -- any other pending requests are now moot
    update public.revert_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = 'Handled with another request' where status = 'pending';
  end if;
  perform public._log(case when p_approve then 'revert_finalization' else 'decline_revert' end, jsonb_build_object('request', p_request));
end $$;

-- ---------------------------------------------------------------------
-- PUBLIC (anon): the ONLY public data. No scores before publishing, no comments.
-- ---------------------------------------------------------------------
create or replace function public.public_landing() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'event_date', e.event_date,
    'start_time', to_char(e.start_time, 'HH24:MI'),
    'published', f.status = 'published',
    'published_at', case when f.status = 'published' then f.published_at end,
    'results', case when f.status = 'published' then coalesce(f.results, '[]'::jsonb) else '[]'::jsonb end,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', p.storage_path, 'caption', p.caption) order by p.position, p.created_at)
                        from public.photos p), '[]'::jsonb)
  )
  from public.event_settings e, public.finalization f where e.id = 1 and f.id = 1
$$;

-- ---------------------------------------------------------------------
-- Privileges: nobody runs these except as listed
-- ---------------------------------------------------------------------
revoke all on function public._log(text, jsonb), public._published(), public._ranking(),
  public.save_scores(uuid, jsonb), public.turn_in_sheet(uuid), public.reopen_sheet(uuid, uuid),
  public.open_reader(uuid, boolean), public.close_reader(uuid), public.set_start_time(time),
  public.add_to_panel(uuid), public.remove_from_panel(uuid), public.substitute_reader(uuid, text, text, boolean),
  public.finalize_results(), public.request_revert(text), public.decide_revert(uuid, boolean, text),
  public.public_landing(), public.handle_new_user(), public.sync_head_judge_panel(), public.guard_panel(),
  public.guard_profile_self(), public.touch_updated_at()
  from public, anon, authenticated;

grant execute on function
  public.save_scores(uuid, jsonb), public.turn_in_sheet(uuid), public.reopen_sheet(uuid, uuid),
  public.open_reader(uuid, boolean), public.close_reader(uuid), public.set_start_time(time),
  public.add_to_panel(uuid), public.remove_from_panel(uuid), public.substitute_reader(uuid, text, text, boolean),
  public.finalize_results(), public.request_revert(text), public.decide_revert(uuid, boolean, text)
  to authenticated;
grant execute on function public.public_landing() to anon, authenticated;
