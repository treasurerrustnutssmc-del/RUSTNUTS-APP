-- Runs the sync-rides Edge Function every 15 minutes. The function's address is a setting an admin
-- fills in once (private.app_settings 'ride_sync_url'); until then the schedule does nothing.

create table if not exists private.app_settings (
  key text primary key,
  value text not null
);
revoke all on private.app_settings from public, anon, authenticated;
alter table private.app_settings enable row level security;

-- The feeds, for the sync function only (it runs with the service key).
create or replace function public.ride_feeds_for_sync()
returns table (id uuid, url text, category public.ride_category)
language sql stable security definer set search_path = '' as $$
  select f.id, f.url, f.category from private.ride_feeds f order by f.id;
$$;
revoke all on function public.ride_feeds_for_sync() from public, anon, authenticated;
grant execute on function public.ride_feeds_for_sync() to service_role;

create or replace function private.ride_sync_url()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'ride_sync_url';
$$;

-- pg_cron and pg_net come with Supabase. A plain Postgres (the local test database) has neither,
-- so the schedule is only set up where they exist.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule(
      'sync-rides',
      '*/15 * * * *',
      $job$select net.http_post(url := u, body := '{}'::jsonb) from private.ride_sync_url() as u where u is not null$job$
    );
  end if;
end $$;
