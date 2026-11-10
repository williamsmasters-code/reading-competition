-- =====================================================================
-- Michelle Coy Reading Competition: 07_email_sync.sql
-- Lets a login email be changed later and keeps public.profiles.email in step with
-- Supabase Auth (auth.users.email). Run after 01-05. Safe to run again.
--  * A user changes their own email from "Change email" in their console
--    (Supabase sends a confirmation link; the change happens when it is clicked).
--  * The Site Admin can change anyone's email instantly (admin-users Edge Function).
-- Users still cannot write profiles.email themselves (no column grant); only this sync
-- trigger can change it.
-- =====================================================================
create or replace function public.guard_profile_self() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() = old.id
     and (new.role is distinct from old.role or (old.active and not new.active)) then
    raise exception 'You cannot change your own role or deactivate your own account.';
  end if;
  -- Email is managed by Supabase Auth only. The one allowed writer is the
  -- auth.users sync trigger below (it runs nested, so pg_trigger_depth() > 1).
  if new.email is distinct from old.email and auth.uid() is not null and pg_trigger_depth() <= 1 then
    new.email := old.email;
  end if;
  return new;
end $$;

create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.sync_profile_email() from public, anon, authenticated;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- Bring any existing rows into line (no-op on a fresh project).
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is distinct from u.email;
