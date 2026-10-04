







select name, (metadata ->> 'size')::bigint as bytes, created_at
from storage.objects
where bucket_id = 'documents'
  and name like '00000000-0000-0000-0000-000000000000/%'
order by name;



create extension if not exists pg_net with schema extensions;



do $$
declare
  v_user constant uuid := '00000000-0000-0000-0000-000000000000';
  v_key  text;
  v_obj  record;
  v_n    int := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'paperink_service_role_key' limit 1;
  if v_key is null then
    raise exception 'Step 1 first: store the service-role key in Vault as paperink_service_role_key';
  end if;

  for v_obj in
    select name
    from storage.objects
    where bucket_id = 'documents'
      and name like v_user::text || '/%'          
  loop
    perform net.http_delete(
      
      url := 'https://jowygcsnfwabaoihkkzt.supabase.co/storage/v1/object/documents/' || replace(v_obj.name, ' ', '%20'),
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key),
      timeout_milliseconds := 30000
    );
    v_n := v_n + 1;
  end loop;

  raise notice 'Queued % file deletions for user %', v_n, v_user;
end $$;



select status_code, count(*) from net._http_response
where created > now() - interval '10 minutes'
group by status_code;

select count(*) from storage.objects
where bucket_id = 'documents' and name like '00000000-0000-0000-0000-000000000000/%';





