-- Deep audit repair F3 (31 Oct 2026): pg_net was recorded in the public schema. Its tables and
-- functions have always lived in the net schema; only the extension's home was public, which the
-- Supabase security advisor flags (extension_in_public). pg_net can't be moved with SET SCHEMA, so
-- where it sits anywhere but extensions it is dropped and created again there, inside this one
-- statement: if the create failed, the drop would roll back and nothing would change. Nothing else
-- depends on the extension (checked live: 0 external dependents; the cron jobs call net.http_post by
-- name), so the only thing lost is the net._http_response history of past calls.
-- Live got the same move from paste item 45 (build/pg-net-move.sql), so here it finds nothing to do;
-- a plain Postgres (the local test database) has no pg_net and does nothing either. Safe to run twice.
do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname <> 'extensions'
  ) then
    drop extension pg_net;
    create extension pg_net schema extensions;
  end if;
end $$;
