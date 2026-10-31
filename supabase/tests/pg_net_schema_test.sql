-- Checks that pg_net is never recorded in the public schema (deep audit F3). A plain Postgres has no
-- pg_net, so here the migration must run again without error and leave nothing recorded in public;
-- the move itself can only be seen live (paste item 45). Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

\echo 'The pg_net move runs again without error and leaves pg_net out of the public schema'
\ir ../migrations/20270640000000_pg_net_extensions_schema.sql
do $$
begin
  assert not exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname = 'public'
  ), 'pg_net is recorded in the public schema';
end $$;

\echo 'PG_NET SCHEMA CHECKS PASSED'
