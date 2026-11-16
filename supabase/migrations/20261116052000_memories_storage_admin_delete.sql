drop policy if exists memories_storage_admin_delete on storage.objects;
create policy memories_storage_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'memorial-images'
  and (storage.foldername(name))[1] = 'memories'
  and (select public.is_admin())
);