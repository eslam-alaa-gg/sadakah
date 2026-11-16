-- Memories gallery: additive schema and admin-only storage writes
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  image_path text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.memories enable row level security;
grant select on public.memories to anon, authenticated;
grant insert, update, delete on public.memories to authenticated;

drop policy if exists memories_public_read on public.memories;
create policy memories_public_read on public.memories
  for select to anon, authenticated using (true);

drop policy if exists memories_admin_insert on public.memories;
create policy memories_admin_insert on public.memories
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists memories_admin_update on public.memories;
create policy memories_admin_update on public.memories
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists memories_admin_delete on public.memories;
create policy memories_admin_delete on public.memories
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists memories_storage_admin_insert on storage.objects;
create policy memories_storage_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'memorial-images'
    and (storage.foldername(name))[1] = 'memories'
    and (select public.is_admin())
  );

drop policy if exists memories_storage_admin_update on storage.objects;
create policy memories_storage_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'memorial-images'
    and (storage.foldername(name))[1] = 'memories'
    and (select public.is_admin())
  )
  with check (
    bucket_id = 'memorial-images'
    and (storage.foldername(name))[1] = 'memories'
    and (select public.is_admin())
  );
