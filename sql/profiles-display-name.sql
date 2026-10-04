









create or replace function public.paperink_display_name(p_email text, p_meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    coalesce(
      case when p_email like '%@users.paperink.invalid' then split_part(p_email, '@', 1) end,
      nullif(btrim(p_meta ->> 'full_name'), ''),
      nullif(btrim(p_meta ->> 'name'), ''),
      nullif(split_part(coalesce(p_email, ''), '@', 1), '')
    ),
    100
  )
$$;


create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, public.paperink_display_name(new.email, new.raw_user_meta_data))
  on conflict (user_id) do update
    set display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;


update public.profiles p
set display_name = public.paperink_display_name(u.email, u.raw_user_meta_data),
    updated_at = now()
from auth.users u
where u.id = p.user_id
  and p.display_name is null;


insert into public.profiles (user_id, display_name)
select u.id, public.paperink_display_name(u.email, u.raw_user_meta_data)
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id);



revoke update (display_name) on public.profiles from authenticated;
revoke execute on function public.paperink_display_name(text, jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;



