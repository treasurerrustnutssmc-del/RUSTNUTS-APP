-- Checks the club website's Constitution feed (public_documents): anon reads the shown version of
-- the Constitution and nothing else from the library; the tables themselves stay locked.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt;
  exception when others then
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return null;
end;
$$;

-- An error inside leaves the role set, but the do block below aborts with it anyway.
create function pg_temp.as_anon(stmt text) returns setof record language plpgsql as $$
begin
  set local role anon;
  return query execute stmt;
  reset role;
end;
$$;

-- The library: the Registered Rules, the Constitution with three versions, a policy.
insert into public.documents (id, kind, title) values
  ('00000000-0000-0000-0000-00000000da01', 'registered_rules', 'Registered Rules'),
  ('00000000-0000-0000-0000-00000000da02', 'constitution', 'Constitution'),
  ('00000000-0000-0000-0000-00000000da03', 'policy', 'Patch policy');
insert into public.document_versions (document_id, number, label, body, approving_body, approved_on, commences_on) values
  ('00000000-0000-0000-0000-00000000da01', 1, 'r1', '# Rules', 'association_general_meeting', '2020-01-01', '2020-01-01'),
  ('00000000-0000-0000-0000-00000000da02', 1, 'v2', '# Old', 'full_members', '2024-01-01', '2024-01-01'),
  ('00000000-0000-0000-0000-00000000da02', 2, 'v3', '# Current', 'full_members', '2025-01-01', '2025-01-01'),
  ('00000000-0000-0000-0000-00000000da02', 3, 'v4', '# Awaiting approval', null, null, null),
  ('00000000-0000-0000-0000-00000000da03', 1, 'p1', '# Policy', 'nec', '2025-01-01', '2025-01-01');

do $$
declare rows_seen int; row_seen record;
begin
  -- Anon reads one row: the Constitution's version in force (v3), not the unapproved v4.
  select count(*) into rows_seen from pg_temp.as_anon('select * from public.public_documents()')
    as t(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamptz, body text);
  if rows_seen <> 1 then raise exception 'anon should see one document, saw %', rows_seen; end if;
  select * into row_seen from pg_temp.as_anon('select * from public.public_documents()')
    as t(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamptz, body text);
  if row_seen.kind <> 'constitution' or row_seen.label <> 'v3' or row_seen.body <> '# Current'
     or row_seen.approving_body <> 'full_members' or row_seen.approved_on <> '2025-01-01' then
    raise exception 'anon should see the Constitution in force (v3), saw % % %', row_seen.kind, row_seen.label, row_seen.body;
  end if;

  -- Once v4 commences it takes over.
  update public.document_versions set approving_body = 'full_members', approved_on = '2026-01-01', commences_on = '2026-01-01'
    where document_id = '00000000-0000-0000-0000-00000000da02' and number = 3;
  select * into row_seen from pg_temp.as_anon('select * from public.public_documents()')
    as t(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamptz, body text);
  if row_seen.label <> 'v4' then raise exception 'anon should see v4 once it commences, saw %', row_seen.label; end if;

  -- Nothing in force at all: the newest version shows, approval facts empty (the live v4 today).
  update public.document_versions set approving_body = null, approved_on = null, commences_on = null
    where document_id = '00000000-0000-0000-0000-00000000da02';
  select * into row_seen from pg_temp.as_anon('select * from public.public_documents()')
    as t(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamptz, body text);
  if row_seen.label <> 'v4' or row_seen.approved_on is not null then
    raise exception 'with nothing in force anon should see the newest version with no approval facts, saw %', row_seen.label;
  end if;

  -- A Constitution added but not yet published (no versions): nothing, no error.
  delete from public.document_versions where document_id = '00000000-0000-0000-0000-00000000da02';
  select count(*) into rows_seen from pg_temp.as_anon('select * from public.public_documents()')
    as t(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamptz, body text);
  if rows_seen <> 0 then raise exception 'with no versions anon should see nothing, saw %', rows_seen; end if;

  -- No Constitution in the library at all: nothing, no error.
  delete from public.documents where id = '00000000-0000-0000-0000-00000000da02';
  select count(*) into rows_seen from pg_temp.as_anon('select * from public.public_documents()')
    as t(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamptz, body text);
  if rows_seen <> 0 then raise exception 'with no Constitution anon should see nothing, saw %', rows_seen; end if;

  -- The tables stay locked for anon.
  if pg_temp.try_as(null, 'select * from public.documents') is null then raise exception 'anon read documents'; end if;
  if pg_temp.try_as(null, 'select * from public.document_versions') is null then raise exception 'anon read document_versions'; end if;
  if pg_temp.try_as(null, 'select * from public.document_signoffs') is null then raise exception 'anon read document_signoffs'; end if;
end $$;

\o
\echo 'public_documents: all checks passed'
