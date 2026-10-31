-- Checks the shared secret for the functions pg_cron calls (deep audit F6): it exists and is random,
-- the scheduled calls' headers carry it, a second run keeps it, and no app role can read it. pg_cron
-- isn't in the local database, so the jobs themselves are checked live (the paste queue's verify
-- step). Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

\echo 'The cron secret exists, is random, goes out in the headers, and survives a second run of the migration'
create temp table first_run as select private.cron_secret() as secret;
do $$
declare s text; h jsonb;
begin
  s := (select secret from first_run);
  assert s ~ '^[0-9a-f]{64}$', coalesce(s, 'null');
  h := private.cron_headers();
  assert h->>'x-cron-secret' = s, h::text;
  assert h->>'Content-Type' = 'application/json', h::text;
end $$;
\ir ../migrations/20270630000000_cron_secret.sql
do $$
declare s text;
begin
  s := (select secret from first_run);
  assert private.cron_secret() = s, 'a second run keeps the value the functions were given';
  update private.app_settings set value = '' where key = 'cron_secret';
  assert not (private.cron_headers() ? 'x-cron-secret'), 'no header without a secret';
  assert private.cron_headers()->>'Content-Type' = 'application/json', 'still JSON';
  update private.app_settings set value = s where key = 'cron_secret';
end $$;

\echo 'Neither a signed-in member, an anonymous caller nor the service key can read the secret'
do $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  foreach r in array array['authenticated', 'anon', 'service_role'] loop
    execute format('set local role %I', r);
    begin
      perform private.cron_secret();
      raise exception '% read the cron secret', r;
    exception when insufficient_privilege then null;
    end;
    begin
      perform private.cron_headers();
      raise exception '% read the cron headers', r;
    exception when insufficient_privilege then null;
    end;
    begin
      perform value from private.app_settings where key = 'cron_secret';
      raise exception '% read the settings table', r;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

\echo 'CRON SECRET CHECKS PASSED'
