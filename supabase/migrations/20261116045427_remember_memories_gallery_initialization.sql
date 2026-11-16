-- Remember when the managed gallery has been initialized, even if its last image is deleted.
create table if not exists public.memories_gallery_settings (
  id boolean primary key default true check (id is true),
  initialized boolean not null default false
);
alter table public.memories_gallery_settings enable row level security;
grant select on public.memories_gallery_settings to anon, authenticated;
grant insert, update on public.memories_gallery_settings to authenticated;
drop policy if exists memories_gallery_settings_public_read on public.memories_gallery_settings;
create policy memories_gallery_settings_public_read on public.memories_gallery_settings
  for select to anon, authenticated using (true);
drop policy if exists memories_gallery_settings_admin_insert on public.memories_gallery_settings;
create policy memories_gallery_settings_admin_insert on public.memories_gallery_settings
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists memories_gallery_settings_admin_update on public.memories_gallery_settings;
create policy memories_gallery_settings_admin_update on public.memories_gallery_settings
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));
