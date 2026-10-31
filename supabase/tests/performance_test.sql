-- Checks the database stays the way Supabase's performance advisor wants it (deep audit F4): every
-- foreign key has a covering index, no policy re-evaluates auth.uid() for every row, no table has two
-- permissive policies for the same role and action, and every table has a primary key.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

\echo 'Every foreign key in public and private has an index that starts with its columns'
do $$
declare missing text;
begin
  select string_agg(n.nspname || '.' || c.relname || ' (' || con.conname || ')', ', ' order by n.nspname || '.' || c.relname) into missing
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f' and n.nspname in ('public', 'private')
    and not exists (
      select 1 from pg_index i
      where i.indrelid = con.conrelid and i.indisvalid
        and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(con.conkey, 1)] = con.conkey
    );
  assert missing is null, 'foreign keys without a covering index: ' || missing;
end $$;

\echo 'No policy in public calls auth.uid() or current_setting() once per row (they are wrapped in a select)'
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename || '.' || policyname) into bad
  from pg_policies
  where schemaname = 'public'
    and regexp_replace(regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                                      '\(\s*SELECT\s+auth\.\w+\(\)\s+AS\s+\w+\)', '', 'gi'),
                       '\(\s*SELECT\s+current_setting\([^)]*\)\s+AS\s+\w+\)', '', 'gi')
        ~* '(auth\.\w+|current_setting)\(';
  assert bad is null, 'policies that call auth.<fn>() or current_setting() per row: ' || bad;
end $$;

\echo 'No table in public has two permissive policies for the same role and action'
do $$
declare bad text;
begin
  select string_agg(tablename || ' ' || role || ' ' || action || ': ' || names, ', ' order by tablename) into bad
  from (
    select p.tablename, r.role, a.action, string_agg(p.policyname, '+' order by p.policyname) as names
    from pg_policies p
    cross join lateral unnest(case when 'public' = any (p.roles) then array['anon', 'authenticated'] else p.roles::text[] end) as r(role)
    cross join lateral unnest(case when p.cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[p.cmd] end) as a(action)
    where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
    group by p.tablename, r.role, a.action
    having count(*) > 1
  ) dup;
  assert bad is null, 'tables with overlapping permissive policies: ' || bad;
end $$;

\echo 'Every table in public and private has a primary key'
do $$
declare bad text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname || '.' || c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
    and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p');
  assert bad is null, 'tables without a primary key: ' || bad;
end $$;

\echo 'PERFORMANCE CHECKS PASSED'
