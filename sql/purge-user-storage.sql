










create extension if not exists pg_net with schema extensions;



do $$
begin
  if not exists (select 1 from vault.secrets where name = 'paperink_purge_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'paperink_purge_secret',
                                'Shared secret for the purge-user Edge Function');
  end if;
end $$;


create or replace function public.paperink_purge_user_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paperink_purge_secret' limit 1;
  if v_secret is null then
    raise warning 'paperink: purge secret missing; storage of % was not purged', old.user_id;
    return old;
  end if;
  perform net.http_post(
    url := 'https://jowygcsnfwabaoihkkzt.supabase.co/functions/v1/purge-user',
    body := jsonb_build_object('user_id', old.user_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  );
  return old;
end;
$$;

revoke execute on function public.paperink_purge_user_storage() from public, anon, authenticated;

drop trigger if exists profiles_purge_storage on public.profiles;
create trigger profiles_purge_storage
  after delete on public.profiles
  for each row execute function public.paperink_purge_user_storage();







