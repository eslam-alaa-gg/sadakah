-- Add visitor-facing placement and visibility controls for the memories section.
alter table public.memories_gallery_settings
  add column if not exists is_visible boolean not null default true,
  add column if not exists display_position text not null default 'before-more';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memories_gallery_settings_display_position_check'
      and conrelid = 'public.memories_gallery_settings'::regclass
  ) then
    alter table public.memories_gallery_settings
      add constraint memories_gallery_settings_display_position_check
      check (display_position in (
        'before-remember','before-quran','before-hadith',
        'before-dua','before-tasbih','before-names','before-more'
      ));
  end if;
end $$;
