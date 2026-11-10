-- =====================================================================
-- Michelle Coy Reading Competition: 08_setup.sql   (Competition setup)
-- Items (readings), Rounds (1..N, optional name, a default Item each) and
-- Districts, managed by the Head Judge or the Site Admin from the Setup tab.
--   * Each reader has a round (round_no), a district (district_id) and an
--     optional Item override (item_id). Effective Item = override, else the
--     round's default Item.
--   * readers.item / readers.round / readers.district are now DERIVED labels,
--     kept up to date by triggers, so the score sheet header and the Excel
--     export (C3 / J3 / J5) keep working unchanged.
--   * Changing a reader's Item, Round, District or place in the running order
--     never touches scores or sheets.
--   * Ranking / finalize are unchanged: one overall ranking, and only the overall
--     results are posted publicly.
-- Run after 01-05 and 07. Safe to run again. Existing readers (e.g. the 6 from
-- seed_readers.sql with 'Just Harriet' / 'Round 1' / 'ONE') are mapped onto the
-- new lists automatically; nothing they show changes.
-- =====================================================================

-- ---------- lists ----------
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 200),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists items_title_uq on public.items (lower(btrim(title)));

create table if not exists public.rounds (
  number           int primary key check (number between 1 and 20),
  name             text not null default '' check (length(name) <= 40),
  default_item_id  uuid references public.items(id) on delete set null,
  updated_at       timestamptz not null default now()
);
insert into public.rounds (number) values (1) on conflict (number) do nothing;

create table if not exists public.districts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 40),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists districts_name_uq on public.districts (lower(btrim(name)));

-- ---------- reader links (scores are untouched by any of these) ----------
alter table public.readers add column if not exists round_no    int  not null default 1 references public.rounds(number) on update cascade;
alter table public.readers add column if not exists district_id uuid references public.districts(id);
alter table public.readers add column if not exists item_id     uuid references public.items(id);   -- null = use the round's default
create index if not exists readers_round_idx on public.readers (round_no);

drop trigger if exists t_items_touch on public.items;
create trigger t_items_touch before update on public.items for each row execute function public.touch_updated_at();
drop trigger if exists t_rounds_touch on public.rounds;
create trigger t_rounds_touch before update on public.rounds for each row execute function public.touch_updated_at();
drop trigger if exists t_districts_touch on public.districts;
create trigger t_districts_touch before update on public.districts for each row execute function public.touch_updated_at();

create or replace function public._round_label(p_no int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(name), '') from public.rounds where number = p_no), 'Round ' || p_no)
$$;

-- Keeps readers.item / round / district (the labels the sheets and export show) in step.
-- On INSERT it also adopts plain text values (seed_readers.sql, older clients) into the lists.
create or replace function public.reader_labels() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item uuid; v_n int;
begin
  if tg_op = 'INSERT' then
    if new.district_id is null and btrim(coalesce(new.district, '')) <> '' then
      select id into new.district_id from public.districts where lower(btrim(name)) = lower(btrim(new.district));
      if new.district_id is null then
        insert into public.districts (name, position)
          values (btrim(new.district), coalesce((select max(position) from public.districts), 0) + 1)
          returning id into new.district_id;
      end if;
    end if;
    if new.round_no = 1 and coalesce(new.round, '') ~* '^\s*round\s+[0-9]+\s*$' then
      v_n := substring(new.round from '[0-9]+')::int;
      if v_n between 1 and 20 then
        insert into public.rounds (number) select g from generate_series(1, v_n) g on conflict (number) do nothing;
        new.round_no := v_n;
      end if;
    end if;
    if new.item_id is null and btrim(coalesce(new.item, '')) <> '' then
      select id into v_item from public.items where lower(btrim(title)) = lower(btrim(new.item));
      if v_item is null then
        insert into public.items (title, position)
          values (btrim(new.item), coalesce((select max(position) from public.items), 0) + 1)
          returning id into v_item;
      end if;
      update public.rounds set default_item_id = v_item where number = new.round_no and default_item_id is null;
      if v_item is distinct from (select default_item_id from public.rounds where number = new.round_no) then
        new.item_id := v_item;   -- differs from the round default: keep it as this reader's override
      end if;
    end if;
  end if;
  new.round    := public._round_label(new.round_no);
  new.district := coalesce((select name from public.districts where id = new.district_id), '');
  new.item     := coalesce((select title from public.items
                             where id = coalesce(new.item_id, (select default_item_id from public.rounds where number = new.round_no))), '');
  return new;
end $$;
drop trigger if exists t_readers_labels on public.readers;
create trigger t_readers_labels before insert or update on public.readers for each row execute function public.reader_labels();

-- When a list entry changes, refresh the labels of the readers that use it.
create or replace function public.refresh_reader_labels() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'items' then
    update public.readers set item_id = item_id
     where item_id = new.id or (item_id is null and round_no in (select number from public.rounds where default_item_id = new.id));
  elsif tg_table_name = 'rounds' then
    update public.readers set round_no = round_no where round_no = new.number;
  elsif tg_table_name = 'districts' then
    update public.readers set district_id = district_id where district_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists t_items_relabel on public.items;
create trigger t_items_relabel after update of title on public.items for each row execute function public.refresh_reader_labels();
drop trigger if exists t_rounds_relabel on public.rounds;
create trigger t_rounds_relabel after update of name, default_item_id on public.rounds for each row execute function public.refresh_reader_labels();
drop trigger if exists t_districts_relabel on public.districts;
create trigger t_districts_relabel after update of name on public.districts for each row execute function public.refresh_reader_labels();

-- ---------- one-time mapping of readers that existed before this file ----------
do $$
declare r record; v_item uuid; v_n int;
begin
  for r in select * from public.readers where district_id is null and item_id is null order by position loop
    v_n := case when coalesce(r.round, '') ~* '^\s*round\s+[0-9]+\s*$' then least(20, greatest(1, substring(r.round from '[0-9]+')::int)) else 1 end;
    insert into public.rounds (number) select g from generate_series(1, v_n) g on conflict (number) do nothing;
    if btrim(coalesce(r.district, '')) <> '' then
      insert into public.districts (name, position)
        select btrim(r.district), coalesce((select max(position) from public.districts), 0) + 1
        where not exists (select 1 from public.districts where lower(btrim(name)) = lower(btrim(r.district)));
    end if;
    v_item := null;
    if btrim(coalesce(r.item, '')) <> '' then
      insert into public.items (title, position)
        select btrim(r.item), coalesce((select max(position) from public.items), 0) + 1
        where not exists (select 1 from public.items where lower(btrim(title)) = lower(btrim(r.item)));
      select id into v_item from public.items where lower(btrim(title)) = lower(btrim(r.item));
      update public.rounds set default_item_id = v_item where number = v_n and default_item_id is null;
    end if;
    update public.readers set
      round_no    = v_n,
      district_id = (select id from public.districts where lower(btrim(name)) = lower(btrim(r.district))),
      item_id     = case when v_item is distinct from (select default_item_id from public.rounds where number = v_n) then v_item end
    where id = r.id;
  end loop;
end $$;

-- ---------- access ----------
alter table public.items     enable row level security;
alter table public.rounds    enable row level security;
alter table public.districts enable row level security;
revoke all on public.items, public.rounds, public.districts from anon, authenticated;
grant select on public.items, public.rounds, public.districts to authenticated;
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated using (public.is_staff());
drop policy if exists rounds_select on public.rounds;
create policy rounds_select on public.rounds for select to authenticated using (public.is_staff());
drop policy if exists districts_select on public.districts;
create policy districts_select on public.districts for select to authenticated using (public.is_staff());

-- Readers: the Site Admin still adds/removes readers and edits name, school and date directly.
-- Item / Round / District and the running order change only through the functions below
-- (Head Judge or Site Admin). The text labels are derived, so nobody writes them.
revoke insert, update on public.readers from authenticated;
grant insert (position, student_name, school, reading_date, round_no, district_id, item_id) on public.readers to authenticated;
grant update (student_name, school, reading_date) on public.readers to authenticated;

-- ---------- functions (Head Judge or Site Admin) ----------
create or replace function public._setup_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_head()) then
    raise exception 'Only the Head Judge or the Site Admin can change the competition setup.';
  end if;
end $$;

create or replace function public.setup_change(p_action text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_id uuid; v_txt text; v_n int; v_max int; v_cnt int; v_def uuid; v_old text;
begin
  perform public._setup_guard();
  if p_action in ('add_item', 'rename_item') then
    v_txt := btrim(coalesce(a->>'title', ''));
    if length(v_txt) not between 1 and 200 then raise exception 'Type the item title (up to 200 characters).'; end if;
    if exists (select 1 from public.items where lower(btrim(title)) = lower(v_txt) and id is distinct from (a->>'id')::uuid) then
      raise exception 'There is already an item called "%".', v_txt;
    end if;
  elsif p_action in ('add_district', 'rename_district') then
    v_txt := btrim(coalesce(a->>'name', ''));
    if length(v_txt) not between 1 and 40 then raise exception 'Type the district name (up to 40 characters).'; end if;
    if exists (select 1 from public.districts where lower(btrim(name)) = lower(v_txt) and id is distinct from (a->>'id')::uuid) then
      raise exception 'There is already a district called "%".', v_txt;
    end if;
  end if;

  if p_action = 'add_item' then
    insert into public.items (title, position) values (v_txt, coalesce((select max(position) from public.items), 0) + 1) returning id into v_id;
    update public.rounds set default_item_id = v_id where default_item_id is null;   -- the first item becomes the default
  elsif p_action = 'rename_item' then
    v_id := (a->>'id')::uuid;
    select title into v_old from public.items where id = v_id;
    if v_old is null then raise exception 'That item no longer exists.'; end if;
    update public.items set title = v_txt where id = v_id;
    a := a || jsonb_build_object('from', v_old);
  elsif p_action = 'remove_item' then
    v_id := (a->>'id')::uuid;
    select title into v_old from public.items where id = v_id;
    if v_old is null then raise exception 'That item no longer exists.'; end if;
    select count(*) into v_cnt from public.readers where item_id = v_id;
    if v_cnt > 0 then raise exception '"%" is set for % reader(s). Change them to another item first.', v_old, v_cnt; end if;
    select min(number) into v_n from public.rounds where default_item_id = v_id;
    if v_n is not null then raise exception '"%" is the default item for %. Pick another default first.', v_old, public._round_label(v_n); end if;
    delete from public.items where id = v_id;
    a := a || jsonb_build_object('title', v_old);
  elsif p_action = 'set_round_count' then
    v_n := (a->>'count')::int;
    if v_n is null or v_n not between 1 and 20 then raise exception 'Pick between 1 and 20 rounds.'; end if;
    select coalesce(max(round_no), 1) into v_max from public.readers;
    if v_n < v_max then
      raise exception '% still has readers. Move them to an earlier round first.', public._round_label(v_max);
    end if;
    select default_item_id into v_def from public.rounds order by number desc limit 1;
    insert into public.rounds (number, default_item_id) select g, v_def from generate_series(1, v_n) g on conflict (number) do nothing;
    delete from public.rounds where number > v_n;
  elsif p_action = 'set_round' then
    v_n := (a->>'number')::int;
    if not exists (select 1 from public.rounds where number = v_n) then raise exception 'That round does not exist.'; end if;
    if a ? 'name' then
      v_txt := btrim(coalesce(a->>'name', ''));
      if length(v_txt) > 40 then raise exception 'Keep the round name to 40 characters.'; end if;
      update public.rounds set name = v_txt where number = v_n;
    end if;
    if a ? 'default_item_id' then
      v_def := nullif(a->>'default_item_id', '')::uuid;
      if v_def is not null and not exists (select 1 from public.items where id = v_def) then raise exception 'That item no longer exists.'; end if;
      update public.rounds set default_item_id = v_def where number = v_n;
    end if;
  elsif p_action = 'add_district' then
    insert into public.districts (name, position) values (v_txt, coalesce((select max(position) from public.districts), 0) + 1) returning id into v_id;
  elsif p_action = 'rename_district' then
    v_id := (a->>'id')::uuid;
    select name into v_old from public.districts where id = v_id;
    if v_old is null then raise exception 'That district no longer exists.'; end if;
    update public.districts set name = v_txt where id = v_id;
    a := a || jsonb_build_object('from', v_old);
  elsif p_action = 'remove_district' then
    v_id := (a->>'id')::uuid;
    select name into v_old from public.districts where id = v_id;
    if v_old is null then raise exception 'That district no longer exists.'; end if;
    select count(*) into v_cnt from public.readers where district_id = v_id;
    if v_cnt > 0 then raise exception '% has % reader(s). Move them to another district first.', v_old, v_cnt; end if;
    delete from public.districts where id = v_id;
    a := a || jsonb_build_object('name', v_old);
  else
    raise exception 'Unknown setup change.';
  end if;
  perform public._log('setup_' || p_action, a);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- A reader's Round, District and Item (p_item null = use the round default).
-- Allowed at any time; scores and sheets stay exactly as they are.
create or replace function public.set_reader_details(p_reader uuid, p_round int, p_district uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.readers;
begin
  perform public._setup_guard();
  select * into o from public.readers where id = p_reader;
  if o.id is null then raise exception 'That reader no longer exists.'; end if;
  if not exists (select 1 from public.rounds where number = p_round) then raise exception 'Pick a round.'; end if;
  if p_district is not null and not exists (select 1 from public.districts where id = p_district) then raise exception 'That district no longer exists.'; end if;
  if p_item is not null and not exists (select 1 from public.items where id = p_item) then raise exception 'That item no longer exists.'; end if;
  update public.readers set round_no = p_round, district_id = p_district, item_id = p_item where id = p_reader;
  perform public._log('set_reader_details', jsonb_build_object('reader', p_reader, 'name', o.student_name,
    'from', jsonb_build_object('round', o.round, 'district', o.district, 'item', o.item),
    'to',   (select jsonb_build_object('round', round, 'district', district, 'item', item) from public.readers where id = p_reader)));
end $$;

-- Move a reader to place p_to (1 = first) in the running order. Scores are not touched.
create or replace function public.move_reader(p_reader uuid, p_to int) returns void
language plpgsql security definer set search_path = public as $$
declare v_n int; v_from int;
begin
  perform public._setup_guard();
  if not exists (select 1 from public.readers where id = p_reader) then raise exception 'That reader no longer exists.'; end if;
  select count(*) into v_n from public.readers;
  p_to := greatest(1, least(coalesce(p_to, 1), v_n));
  select rn into v_from from (select id, row_number() over (order by position, created_at, id) rn from public.readers) q where id = p_reader;
  update public.readers r set position = x.newpos
  from (
    select id, case when rn < p_to then rn else rn + 1 end as newpos
      from (select id, row_number() over (order by position, created_at, id) rn from public.readers where id <> p_reader) q
    union all select p_reader, p_to
  ) x where r.id = x.id and r.position is distinct from x.newpos;
  perform public._log('move_reader', jsonb_build_object('reader', p_reader, 'from', v_from, 'to', p_to));
end $$;

revoke all on function public._round_label(int), public.reader_labels(), public.refresh_reader_labels(), public._setup_guard(),
  public.setup_change(text, jsonb), public.set_reader_details(uuid, int, uuid, uuid), public.move_reader(uuid, int)
  from public, anon, authenticated;
grant execute on function public.setup_change(text, jsonb), public.set_reader_details(uuid, int, uuid, uuid), public.move_reader(uuid, int)
  to authenticated;

-- ---------- live updates ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  foreach t in array array['items', 'rounds', 'districts'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
