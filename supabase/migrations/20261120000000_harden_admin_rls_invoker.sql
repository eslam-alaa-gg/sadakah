create policy admins_read_own
on public.admins
for select
to authenticated
using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.admins
    where user_id = (select auth.uid())
  );
$function$;
