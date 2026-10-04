alter table public.documents alter column size_bytes type bigint;

alter table public.documents drop constraint if exists documents_size_bytes_check;
alter table public.documents add constraint documents_size_bytes_check check (size_bytes >= 0);
