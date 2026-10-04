



alter table public.highlights add column if not exists tags text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'highlights_tags_limits') then
    alter table public.highlights
      add constraint highlights_tags_limits
      check (cardinality(tags) <= 50 and char_length(array_to_string(tags, ',')) <= 2000);
  end if;
end $$;


alter table public.highlights add column if not exists drawer text not null default 'lighten';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'highlights_drawer_check') then
    alter table public.highlights
      add constraint highlights_drawer_check check (drawer in ('lighten', 'underscore', 'strikeout', 'invert'));
  end if;
end $$;



delete from public.notes
where highlight_id is null
  and location is not null
  and coalesce(location -> 'quote' ->> 'exact', '') <> '';

notify pgrst, 'reload schema';
