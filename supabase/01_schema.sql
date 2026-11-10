-- =====================================================================
-- Michelle Coy Reading Competition: 01_schema.sql
-- Tables, constraints, triggers and default data (no personal data).
-- Run FIRST in Supabase > SQL Editor on a NEW project. Safe to re-run:
-- everything uses IF NOT EXISTS / ON CONFLICT.
-- Order: 01_schema -> 02_rls -> 03_rpcs -> 04_realtime -> 05_storage
--        -> seed_readers (real names) -> 06_assign_roles (after accounts exist)
-- =====================================================================

-- ---------- profiles: one row per login (created by trigger on auth.users) ----------
-- role NULL = no access at all (e.g. an account that was created by mistake).
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '' check (length(full_name) <= 100),
  role        text check (role in ('site_admin','head_judge','judge')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Exactly one Site Admin and one Head Judge (at most one row each; the setup steps create both).
create unique index if not exists profiles_single_admin_head on public.profiles (role)
  where role in ('site_admin','head_judge');

-- ---------- panel: the judges whose scores count. Head Judge = seat 0, always on it ----------
create table if not exists public.panel (
  judge_id  uuid primary key references public.profiles(id) on delete cascade,
  seat      int  not null unique check (seat >= 0),
  added_at  timestamptz not null default now()
);

-- ---------- readers (contestants), in running order ----------
create table if not exists public.readers (
  id              uuid primary key default gen_random_uuid(),
  position        int  not null default 0,
  student_name    text not null check (length(btrim(student_name)) between 1 and 120),
  school          text not null default '' check (length(school) <= 120),
  item            text not null default '' check (length(item) <= 200),
  reading_date    date,
  round           text not null default 'Round 1' check (length(round) <= 40),
  district        text not null default '' check (length(district) <= 40),
  judging_status  text not null default 'not_opened' check (judging_status in ('not_opened','open','closed')),
  opened_at       timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Only one reader can be open for judging at a time.
create unique index if not exists readers_one_open on public.readers (judging_status)
  where judging_status = 'open';
create index if not exists readers_position on public.readers (position);

-- ---------- criteria: the score sheet items, each scored 1 to 5 ----------
create table if not exists public.criteria (
  id          uuid primary key default gen_random_uuid(),
  position    int  not null default 0,
  text        text not null check (length(btrim(text)) between 1 and 300),
  created_at  timestamptz not null default now()
);

-- ---------- scores: one row per reader x judge x criterion ----------
create table if not exists public.scores (
  reader_id     uuid not null references public.readers(id)  on delete cascade,
  judge_id      uuid not null references public.profiles(id) on delete cascade,
  criterion_id  uuid not null references public.criteria(id) on delete cascade,
  score         smallint check (score between 1 and 5),        -- NULL = not scored yet (comment only)
  comment       text not null default '' check (length(comment) <= 1000),
  updated_at    timestamptz not null default now(),
  primary key (reader_id, judge_id, criterion_id)
);
create index if not exists scores_judge on public.scores (judge_id);

-- ---------- sheets: status of one judge's score sheet for one reader ----------
create table if not exists public.sheets (
  reader_id     uuid not null references public.readers(id)  on delete cascade,
  judge_id      uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'draft' check (status in ('draft','turned_in')),
  turned_in_at  timestamptz,
  reopened_at   timestamptz,
  reopened_by   uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (reader_id, judge_id)
);

-- ---------- event settings (single row) ----------
create table if not exists public.event_settings (
  id          smallint primary key default 1 check (id = 1),
  event_date  date not null default date '2026-11-20',
  start_time  time,                          -- Grenada time (AST). NULL = not set, banner shows the date only
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

-- ---------- finalization (single row). results = snapshot published on the landing page ----------
create table if not exists public.finalization (
  id            smallint primary key default 1 check (id = 1),
  status        text not null default 'open' check (status in ('open','published')),
  published_at  timestamptz,
  published_by  uuid references public.profiles(id) on delete set null,
  results       jsonb,                        -- [{place,name,school,total}] ; NULL unless published
  reverted_at   timestamptz,
  reverted_by   uuid references public.profiles(id) on delete set null
);

-- ---------- revert requests: Head Judge -> Site Admin ----------
create table if not exists public.revert_requests (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid references public.profiles(id) on delete set null,
  reason         text not null check (length(btrim(reason)) between 1 and 1000),
  status         text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at     timestamptz not null default now(),
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text not null default '' check (length(decision_note) <= 500)
);

-- ---------- event photos for the landing page gallery (files live in Storage bucket event-photos) ----------
create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null unique check (storage_path ~ '^photos/[A-Za-z0-9._-]+$'),
  caption       text not null default '' check (length(caption) <= 200),
  position      int  not null default 0,
  created_at    timestamptz not null default now(),
  uploaded_by   uuid references public.profiles(id) on delete set null
);

-- ---------- audit log (Site Admin can read) ----------
create table if not exists public.audit_log (
  id      bigserial primary key,
  actor   uuid,
  action  text not null,
  detail  jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now()
);

-- =====================================================================
-- Triggers
-- =====================================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists t_profiles_touch on public.profiles;
create trigger t_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists t_readers_touch on public.readers;
create trigger t_readers_touch before update on public.readers for each row execute function public.touch_updated_at();

-- New auth user -> profile. Role comes ONLY from app_metadata (set by the service role / admin
-- function, never by the user). Anything else gets role NULL = no access.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := new.raw_app_meta_data->>'role';
begin
  if r not in ('site_admin','head_judge','judge') then r := null; end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(left(new.raw_user_meta_data->>'full_name', 100), ''), r)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Keep the Head Judge on the panel (seat 0) automatically, and off it when the role changes.
create or replace function public.sync_head_judge_panel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'head_judge' then
    delete from public.panel where seat = 0 and judge_id <> new.id;
    insert into public.panel (judge_id, seat) values (new.id, 0)
      on conflict (judge_id) do update set seat = 0;
  elsif tg_op = 'UPDATE' and old.role = 'head_judge' then
    delete from public.panel where judge_id = new.id;
  end if;
  if tg_op = 'UPDATE' and new.role is distinct from 'judge' and new.role is distinct from 'head_judge' then
    delete from public.panel where judge_id = new.id;   -- site_admin / no role: never on the panel
  end if;
  return new;
end $$;
drop trigger if exists t_profiles_head_panel on public.profiles;
create trigger t_profiles_head_panel after insert or update of role on public.profiles
  for each row execute function public.sync_head_judge_panel();

-- The Head Judge cannot be removed from the panel while they are Head Judge.
create or replace function public.guard_panel() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.profiles where id = old.judge_id and role = 'head_judge') then
      raise exception 'The Head Judge is always on the panel and cannot be removed.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  select role into r from public.profiles where id = new.judge_id;
  if r = 'head_judge' and new.seat <> 0 then raise exception 'The Head Judge sits in seat 0.'; end if;
  if r = 'judge' and new.seat < 1 then raise exception 'Judges sit in seat 1 or higher.'; end if;
  if r is null or r not in ('judge','head_judge') then raise exception 'Only judge accounts can be on the panel.'; end if;
  return new;
end $$;
drop trigger if exists t_panel_guard on public.panel;
create trigger t_panel_guard before insert or update or delete on public.panel
  for each row execute function public.guard_panel();

-- A signed-in admin cannot remove their own Site Admin role or deactivate themselves (avoids lock-out).
create or replace function public.guard_profile_self() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() = old.id
     and (new.role is distinct from old.role or (old.active and not new.active)) then
    raise exception 'You cannot change your own role or deactivate your own account.';
  end if;
  if new.email is distinct from old.email and auth.uid() is not null then
    new.email := old.email;   -- email is managed by Supabase Auth only
  end if;
  return new;
end $$;
drop trigger if exists t_profiles_guard on public.profiles;
create trigger t_profiles_guard before update on public.profiles for each row execute function public.guard_profile_self();

-- =====================================================================
-- Default data (no personal information)
-- =====================================================================
insert into public.event_settings (id, event_date) values (1, date '2026-11-20') on conflict (id) do nothing;
insert into public.finalization (id, status) values (1, 'open') on conflict (id) do nothing;

-- The 10 criteria, verbatim from the score sheet (Judge1 Readers.xlsx). Only inserted when the table is empty.
insert into public.criteria (position, text)
select v.p, v.t from (values
  (1, 'Were all words read accurately?'),
  (2, 'Were phrases read effectively as complete units?'),
  (3, 'Was punctuation interpreted correctly?'),
  (4, 'Were all words pronounced distinctly?'),
  (5, 'Were key words emphasized?'),
  (6, 'Was mood or feeling conveyed effectively?'),
  (7, 'Was volume used effectively?'),
  (8, 'Was pitch used effectively?'),
  (9, 'Was the selection read at an appropriate rate for audience and purpose?'),
  (10,'Did the student appear relaxed, confident and able to recover quickly if a mistake was made?')
) as v(p, t)
where not exists (select 1 from public.criteria);
