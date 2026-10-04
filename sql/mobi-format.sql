begin;

alter table public.documents drop constraint if exists documents_source_format_check;
alter table public.documents add constraint documents_source_format_check
  check (source_format is null or source_format in ('pdf', 'epub', 'txt', 'md', 'html', 'fb2', 'cbz', 'cbt', 'mobi'));

commit;
