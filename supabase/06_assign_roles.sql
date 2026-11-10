-- =====================================================================
-- Michelle Coy Reading Competition: 06_assign_roles.sql
-- Run AFTER the 6 accounts exist (Supabase > Authentication > Users > Add user,
-- tick "Auto Confirm User"). Replace every CHANGE-ME email and name below with
-- the real ones first. This gives each account its role and puts the 4 judges
-- on the panel (the Head Judge joins the panel automatically).
-- Later changes are made in the Site Admin console instead.
-- =====================================================================
begin;
-- 1 Site Admin
update public.profiles set role = 'site_admin', full_name = 'CHANGE-ME Site Admin name'
 where lower(email) = lower('CHANGE-ME-admin@example.com');
-- 1 Head Judge (joins the panel as seat 0 automatically)
update public.profiles set role = 'head_judge', full_name = 'CHANGE-ME Head Judge name'
 where lower(email) = lower('CHANGE-ME-headjudge@example.com');
-- 4 Judges
update public.profiles set role = 'judge', full_name = 'CHANGE-ME Judge 1 name' where lower(email) = lower('CHANGE-ME-judge1@example.com');
update public.profiles set role = 'judge', full_name = 'CHANGE-ME Judge 2 name' where lower(email) = lower('CHANGE-ME-judge2@example.com');
update public.profiles set role = 'judge', full_name = 'CHANGE-ME Judge 3 name' where lower(email) = lower('CHANGE-ME-judge3@example.com');
update public.profiles set role = 'judge', full_name = 'CHANGE-ME Judge 4 name' where lower(email) = lower('CHANGE-ME-judge4@example.com');
-- Panel seats 1-4, in this order
insert into public.panel (judge_id, seat)
select p.id, x.seat from (values
  (lower('CHANGE-ME-judge1@example.com'), 1), (lower('CHANGE-ME-judge2@example.com'), 2),
  (lower('CHANGE-ME-judge3@example.com'), 3), (lower('CHANGE-ME-judge4@example.com'), 4)
) as x(email, seat) join public.profiles p on lower(p.email) = x.email
on conflict (judge_id) do nothing;
-- Check: should list 6 rows with roles, and seats 0-4
select p.email, p.full_name, p.role, pn.seat from public.profiles p left join public.panel pn on pn.judge_id = p.id order by pn.seat nulls last;
commit;
