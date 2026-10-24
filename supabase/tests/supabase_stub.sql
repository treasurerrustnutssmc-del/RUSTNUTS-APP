-- Just enough of Supabase's built-ins to test the migration on a plain Postgres.
-- Not used in production: Supabase provides the real auth schema and roles.

create role anon nologin;
create role authenticated nologin;

create schema auth;
grant usage on schema auth to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated;
-- Supabase grants everything on new tables and leaves the locking-down to RLS.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
