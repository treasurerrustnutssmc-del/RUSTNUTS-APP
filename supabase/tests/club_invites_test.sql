-- Checks invites to and from other clubs: who can read the clubs and invites, that nothing is
-- writable directly through the API, and what the actions store. The refusals themselves are the
-- shared parity cases (supabase/tests/parity.json).
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000005a1', 'fran@example.com', now()),   -- Full
  ('00000000-0000-0000-0000-0000000005a2', 'fergus@example.com', now()), -- FNG
  ('00000000-0000-0000-0000-0000000005a3', 'paul@example.com', now()),   -- pending
  ('00000000-0000-0000-0000-0000000005a4', 'sid@example.com', now()),    -- suspended
  ('00000000-0000-0000-0000-0000000005a5', 'stranger@example.com', now()); -- signed in, no record

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000005a1', 'west', 'Fran Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000005a2', 'north', 'Fergus FNG', 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000005a3', 'west', 'Paul Pending', 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000005a4', 'west', 'Sid Suspended', 'full', 'suspended')
) as v(id, slug, name, status, approval)
join chapters c on c.slug = v.slug;

-- Runs a statement as a signed-in user (or anon when who is null) and returns its error, or null.
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
end $$;

-- The same, as the authenticated role with no user at all (a lost session).
create function pg_temp.try_signed_out(stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;

-- Runs a query as a signed-in user and returns its one value as text. Errors go on up.
create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

create function pg_temp.count_as(who uuid, tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute format('select count(*) from %s', tbl) into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
exception when insufficient_privilege then
  reset role;
  return -1;
end $$;

-- Fran is West Road Captain; Fergus (North FNG) has no say over invites.
insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000005a1', c.id, 'road_captain', date '2025-08-16' from chapters c where c.slug = 'west';
insert into rides (id, source, starts_at, title, category) values
  ('00000000-0000-0000-0000-00000000a001', 'app', '2030-03-02T00:00:00Z', 'West coffee run', 'west'),
  ('00000000-0000-0000-0000-00000000a002', 'app', '2030-03-02T00:00:00Z', 'Mates’ toy run', 'non_nuts');

\o
\echo 'Invites: a member passes one on, the road captain answers and links it to its calendar ride'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000005a1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000005a2';
  club uuid;
  inv uuid;
  i club_invites%rowtype;
  err text;
begin
  err := pg_temp.try_as(fergus, $q$select public.save_other_club(null, '  Grease Monkeys MCC ', 'Werribee', '', null)$q$);
  assert err is null, format('an FNG adds a club, not %s', err);
  select id into club from other_clubs where name = 'Grease Monkeys MCC';
  assert club is not null, 'kept trimmed';
  assert (select town = 'Werribee' and contact is null and note is null and added_by = fergus from other_clubs where id = club),
    'blanks kept as none';

  err := pg_temp.try_as(fergus, format($q$select public.save_invite_in(null, %L, null, 'Toy run', '2030-03-02', '', 'Bring a toy', null)$q$, club));
  assert err is null, format('passes on an invite for the whole club, not %s', err);
  select * into i from club_invites where club_id = club and direction = 'in';
  inv := i.id;
  assert i.answer = 'waiting' and i.chapter_id is null and i.event_on = date '2030-03-02' and i.place is null
    and i.details = 'Bring a toy' and i.added_by = fergus, 'kept as passed on';

  err := pg_temp.try_as(fran, format($q$select public.answer_invite(%L, 'yes', 'non_nuts', 9, ' ')$q$, inv));
  assert err is null, format('the road captain says yes, not %s', err);
  select * into i from club_invites where id = inv;
  assert i.answer = 'yes' and i.calendar_label = 'non_nuts' and i.bikes is null and i.note is null
    and i.answered_by = fran and i.answered_at is not null, 'a yes on the Non-Nuts label, no bikes on an incoming one';

  err := pg_temp.try_as(fran, format($q$select public.save_invite_in(%L, %L, null, 'Toy run', '2030-03-02', '', 'Bring a toy', %L)$q$,
    inv, club, '00000000-0000-0000-0000-00000000a002'));
  assert err is null, format('links it to the ride, not %s', err);
  assert (select ride_id = '00000000-0000-0000-0000-00000000a002' from club_invites where id = inv), 'linked';

  err := pg_temp.try_as(fran, format($q$select public.answer_invite(%L, 'waiting', 'non_nuts', null, '')$q$, inv));
  assert err is null, format('back to waiting, not %s', err);
  assert (select calendar_label is null and answered_by is null and answered_at is null from club_invites where id = inv),
    'waiting clears the answer';
end $$;

\o
\echo 'Invites: the road captain asks a club to a West ride and records their reply'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000005a1';
  club uuid := (select id from other_clubs where name = 'Grease Monkeys MCC');
  inv uuid;
  err text;
begin
  err := pg_temp.try_as(fran, format($q$select public.invite_club('00000000-0000-0000-0000-00000000a001', %L, '')$q$, club));
  assert err is null, format('invites them, not %s', err);
  select id into inv from club_invites where direction = 'out' and club_id = club;
  assert (select chapter_id = (select id from chapters where slug = 'west') and note is null and answer = 'waiting'
          from club_invites where id = inv), 'the ride''s chapter, nothing else';

  err := pg_temp.try_as(fran, format($q$select public.answer_invite(%L, 'yes', 'supported', 12, 'Big Al''s lot')$q$, inv));
  assert err is null, format('records their yes, not %s', err);
  assert (select bikes = 12 and calendar_label is null and note = 'Big Al''s lot' from club_invites where id = inv),
    'bikes on an outgoing yes, no label';

  err := pg_temp.try_as(fran, format($q$select public.answer_invite(%L, 'yes', null, 2.5, '')$q$, inv));
  assert err = 'Bikes expected must be a whole number from 1 to 500.', format('half a bike: %s', err);

  -- The partial unique index backs up the check.
  begin
    insert into club_invites (direction, club_id, ride_id) values ('out', club, '00000000-0000-0000-0000-00000000a001');
    assert false, 'a second open invite to the same ride went in';
  exception when unique_violation then null;
  end;
end $$;

\o
\echo 'Invites: approved members read what stands; applicants, the suspended and anon read nothing; no direct writes'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000005a1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000005a2';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  sid constant uuid := '00000000-0000-0000-0000-0000000005a4';
  stranger constant uuid := '00000000-0000-0000-0000-0000000005a5';
  club uuid := (select id from other_clubs where name = 'Grease Monkeys MCC');
  err text;
begin
  assert pg_temp.count_as(fergus, 'other_clubs') = 1, 'an FNG reads the club';
  assert pg_temp.count_as(fergus, 'club_invites') = 2, 'and both invites';
  assert pg_temp.count_as(paul, 'other_clubs') = 0 and pg_temp.count_as(paul, 'club_invites') = 0, 'an applicant reads none';
  assert pg_temp.count_as(sid, 'club_invites') = 0, 'nor the suspended';
  assert pg_temp.count_as(stranger, 'club_invites') = 0, 'nor someone with no record';
  assert pg_temp.count_as(null, 'other_clubs') = -1 and pg_temp.count_as(null, 'club_invites') = -1, 'anon can''t read at all';

  err := pg_temp.try_as(fran, format($q$insert into other_clubs (name) values ('Sneaky MC')$q$));
  assert err like 'permission denied%', format('no direct insert: %s', err);
  err := pg_temp.try_as(fran, format($q$update club_invites set answer = 'yes' where club_id = %L$q$, club));
  assert err like 'permission denied%', format('no direct update: %s', err);
  err := pg_temp.try_as(fran, 'delete from club_invites');
  assert err like 'permission denied%', format('no delete: %s', err);
  err := pg_temp.try_as(null, $q$select public.save_other_club(null, 'Anon MC', null, null, null)$q$);
  assert err like 'permission denied%', format('anon can''t call the actions: %s', err);

  -- Taken off: hidden from everyone, kept in the table.
  err := pg_temp.try_as(fran, format('select public.archive_other_club(%L)', club));
  assert err is null, format('the road captain takes the club off, not %s', err);
  assert pg_temp.count_as(fergus, 'other_clubs') = 0, 'hidden once taken off';
  assert (select archived_by = fran from other_clubs where id = club), 'kept, with who took it off';
  assert pg_temp.count_as(fergus, 'club_invites') = 2, 'its invites stay';
  err := pg_temp.try_as(fergus, $q$select public.save_other_club(null, 'grease monkeys mcc', null, null, null)$q$);
  assert err is null, format('and its name can come back, not %s', err);
end $$;

\o
\echo 'Invites to and from other clubs: all checks passed'
