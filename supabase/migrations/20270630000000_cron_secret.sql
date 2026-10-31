-- Deep audit repair F6: a shared secret for the functions pg_cron calls (send-push, sync-rides and
-- purge-files). They run with no sign-in (verify_jwt off), so anyone who learns their address can make
-- them run. Each can only do what the database has queued, so that costs invocations and nothing
-- else, but it needn't be possible. This gives the database a random secret, which every scheduled
-- call now sends in an x-cron-secret header. Once the same value is saved as the functions'
-- CRON_SECRET secret (Supabase > Edge Functions > Secrets), each function refuses a call without it
-- (supabase/functions/_shared/cronAuth.ts). Until then the header is simply ignored.
--
-- The value is never written in this file or in the job commands: the jobs read it at run time
-- through private.cron_headers(), which only the database owner can call. Going live, in this order
-- (each step is harmless on its own): this file; redeploy the three functions from their one-file
-- pastes; save the value (select private.cron_secret()) as the CRON_SECRET secret. Needs
-- 20270620000000_storage_purge.sql first for the purge-files job; without it that job is left alone.
-- To run a function by hand once the secret is on:
--   select net.http_post(url := private.ride_sync_url(), headers := private.cron_headers(), body := '{}'::jsonb);
-- Running an older schedule file again (20261024120100_ride_sync_schedule.sql, 20270201020000_push.sql)
-- would put that job's header-less command back and its calls would be refused: run this file again after.

-- 64 hex characters from two v4 UUIDs (Postgres draws them from a strong random source). A second run
-- keeps the value, so the saved CRON_SECRET keeps matching.
insert into private.app_settings (key, value)
select 'cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
where not exists (select 1 from private.app_settings where key = 'cron_secret');

create or replace function private.cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'cron_secret';
$$;
revoke all on function private.cron_secret() from public, anon, authenticated, service_role;

-- The headers for a scheduled call: JSON, plus the secret when there is one.
create or replace function private.cron_headers()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('Content-Type', 'application/json')
    || coalesce((select jsonb_build_object('x-cron-secret', s.value) from private.app_settings s where s.key = 'cron_secret' and s.value <> ''), '{}'::jsonb);
$$;
revoke all on function private.cron_headers() from public, anon, authenticated, service_role;

-- The three scheduled calls, now with the headers. The jobs are unscheduled first, so this holds on
-- any pg_cron version (newer ones also replace a job scheduled again under the same name).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.unschedule(jobid) from cron.job where jobname in ('sync-rides', 'send-push', 'purge-files');
    perform cron.schedule('sync-rides', '*/15 * * * *',
      $job$select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.ride_sync_url() as u where u is not null$job$);
    perform cron.schedule('send-push', '* * * * *',
      $job$select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.push_url() as u where u is not null$job$);
    if to_regprocedure('private.purge_url()') is not null then
      perform cron.schedule('purge-files', '*/10 * * * *',
        $job$select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.purge_url() as u where u is not null$job$);
    end if;
  end if;
end $$;
