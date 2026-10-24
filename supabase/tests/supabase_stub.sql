-- Just enough of Supabase's built-ins to test the migration on a plain Postgres.
-- Not used in production: Supabase provides the real auth schema and roles.

-- Roles belong to the whole server, so a second test database finds them already there.
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

create schema auth;
grant usage on schema auth to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants everything on new tables and leaves the locking-down to RLS.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Storage: the bucket and file tables, enough for the chat photo policies.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[] := string_to_array(name, '/');
begin
  return parts[1:array_length(parts, 1) - 1];
end $$;

-- Realtime listens to the tables in this publication.
set client_min_messages = error; -- a local test server has no logical replication, and needn't
do $$ begin
  create publication supabase_realtime;
exception when duplicate_object then null;
end $$;
