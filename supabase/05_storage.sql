-- =====================================================================
-- Michelle Coy Reading Competition: 05_storage.sql
-- Public Storage bucket for landing-page event photos. Anyone can VIEW a
-- photo by its public URL; only the Site Admin can upload or delete.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mcrc photos admin insert" on storage.objects;
create policy "mcrc photos admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and public.is_admin());
drop policy if exists "mcrc photos admin update" on storage.objects;
create policy "mcrc photos admin update" on storage.objects for update to authenticated
  using (bucket_id = 'event-photos' and public.is_admin()) with check (bucket_id = 'event-photos' and public.is_admin());
drop policy if exists "mcrc photos admin delete" on storage.objects;
create policy "mcrc photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-photos' and public.is_admin());
-- (No SELECT policy is needed: files in a public bucket are served by their public URL.)
