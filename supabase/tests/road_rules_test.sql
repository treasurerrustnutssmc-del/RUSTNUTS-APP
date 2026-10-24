-- Checks the Road Rules: publish_road_rules and sign_road_rules, with the refusals in the same words
-- and order as src/domain/roadRules.ts, the publisher rule (the NEC only, not a chapter board),
-- the version-seen conflict, trimming and the limits in code points, version 1 always fresh, who
-- can read what, no writes through the API, the publish lock, and private.road_rules_signed on the
-- same expiry edges as the app's roadRulesStatus.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'cara@example.com', now()),     -- NEC Chairman (North member)
  ('00000000-0000-0000-0000-0000000000f2', 'wes@example.com', now()),      -- West President (so on the NEC)
  ('00000000-0000-0000-0000-0000000000f3', 'sam@example.com', now()),      -- West Secretary: a board seat, not the NEC
  ('00000000-0000-0000-0000-0000000000f4', 'nora@example.com', now()),     -- North Road Captain: a board seat, not the NEC
  ('00000000-0000-0000-0000-0000000000f5', 'fergus@example.com', now()),   -- FNG
  ('00000000-0000-0000-0000-0000000000f6', 'pete@example.com', now()),     -- Full, once West President
  ('00000000-0000-0000-0000-0000000000f7', 'fran@example.com', now()),     -- Full
  ('00000000-0000-0000-0000-0000000000f9', 'paul@example.com', now()),     -- pending
  ('00000000-0000-0000-0000-0000000000fb', 'stranger@example.com', now()); -- signed in, no record

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000f1', 'north', 'Cara Chair', 'Gavel', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', 'west', 'Wes President', 'Prez', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', 'west', 'Sam Secretary', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f4', 'north', 'Nora Captain', 'Compass', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f5', 'west', 'Fergus FNG', null, 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000000f6', 'west', 'Pete Past', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f7', 'west', 'Fran Full', 'Sparks', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f9', 'west', 'Paul Pending', null, 'introduced', 'pending')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000f1', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000000f2', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000000f3', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000f4', 'north', 'road_captain')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;
-- An ended seat gives no powers: Pete was West President once.
insert into positions (member_id, chapter_id, role, started_on, ended_on)
select '00000000-0000-0000-0000-0000000000f6', id, 'president', current_date - 400, current_date - 30
from chapters where slug = 'west';

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

-- publish_road_rules as someone: its error, or null.
create function pg_temp.publish(who uuid, body text, changes text, fresh boolean, seen int) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.publish_road_rules(%L, %L, %L, %L)', body, changes, fresh, seen));
$$;

-- publish_road_rules as someone, returning the new number.
create function pg_temp.published(who uuid, body text, changes text, fresh boolean, seen int) returns int language sql as $$
  select pg_temp.value_as(who, format('select public.publish_road_rules(%L, %L, %L, %L)', body, changes, fresh, seen))::int;
$$;

-- sign_road_rules as someone: its error, or null.
create function pg_temp.sign(who uuid, version int) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.sign_road_rules(%L)', version));
$$;

-- The current version number, 0 when there is none.
create function pg_temp.current() returns int language sql stable as $$
  select coalesce(max(number), 0) from public.road_rules_versions;
$$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.try_signed_out(text), pg_temp.value_as(uuid, text),
  pg_temp.count_as(uuid, text), pg_temp.publish(uuid, text, text, boolean, int),
  pg_temp.published(uuid, text, text, boolean, int), pg_temp.sign(uuid, int), pg_temp.current() to anon, authenticated;

\o
\echo 'Road Rules actions are SECURITY DEFINER with an empty search_path, and only signed-in users can run them'
do $$
declare
  fns constant regprocedure[] := array[
    'public.publish_road_rules(text, text, boolean, int)'::regprocedure,
    'public.sign_road_rules(int)'::regprocedure];
  f regprocedure;
  signed constant regprocedure := 'private.road_rules_signed(uuid)'::regprocedure;
begin
  assert (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid = any (fns)),
    'definer, empty search_path';
  foreach f in array fns loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon can''t run %s', f);
    assert not has_function_privilege('public', f, 'execute'), format('public can''t run %s', f);
    assert has_function_privilege('authenticated', f, 'execute'), format('members can run %s', f);
  end loop;
  assert (select prorettype = 'int'::regtype from pg_proc where oid = fns[1]), 'publish returns the new number';
  assert (select prorettype = 'void'::regtype from pg_proc where oid = fns[2]), 'sign returns nothing';

  assert (select prorettype = 'boolean'::regtype and provolatile = 's' and proconfig @> array['search_path=""']
          from pg_proc where oid = signed), 'road_rules_signed: a stable yes or no, empty search_path';
  assert not has_function_privilege('anon', signed, 'execute'), 'anon can''t run road_rules_signed';
  assert not has_function_privilege('public', signed, 'execute'), 'public can''t run road_rules_signed';
  assert not has_function_privilege('authenticated', signed, 'execute'), 'members can''t run road_rules_signed';

  assert pg_temp.publish(null, 'Ride safe', null, true, 0) is not null, 'the public can''t publish';
  assert pg_temp.sign(null, 1) is not null, 'nor sign';
  assert not exists (select 1 from road_rules_versions), 'nothing was written';
end $$;

\echo 'The first checks come in the app''s order: signed in, then approved'
do $$
declare
  paul constant uuid := '00000000-0000-0000-0000-0000000000f9';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000fb';
  approved constant text := 'Only approved members can do that.';
begin
  assert pg_temp.try_signed_out('select public.publish_road_rules(''Ride safe'', null, true, 0)') = 'Sign in first.',
    'publish: signed out';
  assert pg_temp.try_signed_out('select public.publish_road_rules(null, null, null, 7)') = 'Sign in first.',
    'publish: signed out comes before everything';
  assert pg_temp.try_signed_out('select public.sign_road_rules(1)') = 'Sign in first.', 'sign: signed out';
  assert pg_temp.try_signed_out('select public.sign_road_rules(null)') = 'Sign in first.',
    'sign: signed out comes before no versions';
  assert pg_temp.publish(paul, 'Ride safe', null, true, 0) = approved, 'publish: pending';
  assert pg_temp.publish(stranger, 'Ride safe', null, true, 0) = approved, 'publish: no record';
  assert pg_temp.publish(paul, '', repeat('x', 501), true, 9) = approved, 'approved comes before everything else';
  assert pg_temp.sign(paul, 1) = approved, 'sign: pending';
  assert pg_temp.sign(stranger, 1) = approved, 'sign: no record';
  assert not exists (select 1 from road_rules_versions), 'nothing was published';
  assert not exists (select 1 from road_rules_signoffs), 'nor signed';
end $$;

\echo 'Signing with nothing published: There are no Road Rules to sign yet'
do $$
declare
  fergus constant uuid := '00000000-0000-0000-0000-0000000000f5';
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  none_yet constant text := 'There are no Road Rules to sign yet.';
begin
  assert pg_temp.sign(fergus, 1) = none_yet, 'an FNG';
  assert pg_temp.sign(cara, 1) = none_yet, 'not even the Chairman';
  assert pg_temp.sign(fergus, 0) = none_yet, 'version 0';
  assert pg_temp.sign(fergus, null) = none_yet, 'no version at all';
  assert not exists (select 1 from road_rules_signoffs), 'nothing was signed';
  assert not private.road_rules_signed(fergus), 'nobody is signed with nothing to sign';
end $$;

\echo 'Only the NEC publishes: a chapter board seat, an ended seat or a plain member is refused, before anything else'
do $$
declare
  sam constant uuid := '00000000-0000-0000-0000-0000000000f3';
  nora constant uuid := '00000000-0000-0000-0000-0000000000f4';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000f5';
  pete constant uuid := '00000000-0000-0000-0000-0000000000f6';
  nobody constant text := 'Only the NEC can publish the Road Rules.';
begin
  assert pg_temp.publish(sam, 'Ride safe', null, true, 0) = nobody, 'a West Secretary, on the board but not the NEC';
  assert pg_temp.publish(nora, 'Ride safe', null, true, 0) = nobody, 'a Road Captain, on the board but not the NEC';
  assert pg_temp.publish(pete, 'Ride safe', null, true, 0) = nobody, 'a President whose seat ended';
  assert pg_temp.publish(fergus, 'Ride safe', null, true, 0) = nobody, 'an FNG';
  assert pg_temp.publish(sam, 'Ride safe', null, true, 3) = nobody, 'who publishes comes before the conflict';
  assert pg_temp.publish(nora, '   ', repeat('x', 501), true, 0) = nobody, 'and before the limits';
  assert not exists (select 1 from road_rules_versions), 'nothing was published';
end $$;

\echo 'Then the version the editor opened on, then the text and what changed, in that order'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  clash constant text :=
    'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the Road Rules again.';
  empty constant text := 'Write the Road Rules first.';
  too_long constant text := 'That’s too long (20000 characters at most).';
  changes_long constant text := 'Keep what changed to 500 characters at most.';
begin
  assert pg_temp.publish(cara, 'Ride safe', null, true, 1) = clash, 'opened on version 1 when there are none';
  assert pg_temp.publish(cara, 'Ride safe', null, true, null) = clash, 'opened on no version at all';
  assert pg_temp.publish(cara, 'Ride safe', null, true, -1) = clash, 'a nonsense number';
  assert pg_temp.publish(cara, '', repeat('x', 501), true, 1) = clash, 'the conflict comes before empty';
  assert pg_temp.publish(cara, repeat('x', 20001), null, true, 1) = clash, 'and before too long';

  assert pg_temp.publish(cara, '', null, true, 0) = empty, 'empty';
  assert pg_temp.publish(cara, null, null, true, 0) = empty, 'no text at all';
  assert pg_temp.publish(cara, E' \t\r\n　﻿ ', null, true, 0) = empty, 'whitespace the app trims';
  assert pg_temp.publish(cara, '  ', repeat('x', 501), true, 0) = empty, 'empty comes before what changed';

  assert pg_temp.publish(cara, repeat('x', 20001), null, true, 0) = too_long, '20001 characters';
  assert pg_temp.publish(cara, repeat('🏍', 20001), null, true, 0) = too_long, '20001 code points';
  assert pg_temp.publish(cara, repeat('é', 20001), null, true, 0) = too_long, '20001 accented letters';
  assert pg_temp.publish(cara, repeat('x', 20001), repeat('x', 501), true, 0) = too_long,
    'the text''s length comes before what changed';

  assert pg_temp.publish(cara, 'Ride safe', repeat('x', 501), true, 0) = changes_long, '501 characters of what changed';
  assert pg_temp.publish(cara, 'Ride safe', repeat('🏍', 501), true, 0) = changes_long, '501 code points';
  assert not exists (select 1 from road_rules_versions), 'nothing was published';
end $$;

\echo 'Version 1: trimmed, at the limits, always a fresh sign-off, blank what changed stored as none, and its number returned'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  v road_rules_versions%rowtype;
begin
  assert pg_temp.published(cara, E'\n  ' || repeat('🏍', 20000) || E' \t', E'  \n ', false, 0) = 1, 'the first version is 1';
  select * into v from road_rules_versions where number = 1;
  assert found, 'version 1 is there';
  assert v.body = repeat('🏍', 20000), '20000 code points, trimmed';
  assert v.changes is null, 'blank what changed is none';
  assert v.fresh, 'version 1 needs a fresh sign-off, whatever was asked';
  assert v.published_by = cara and v.published_at = now(), 'Cara, now';
end $$;

\echo 'Later versions: the next number on top of the one seen, what changed trimmed, fresh as asked'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000f2';
  clash constant text :=
    'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the Road Rules again.';
  v road_rules_versions%rowtype;
begin
  assert pg_temp.publish(wes, '# Road Rules', null, false, 0) = clash, 'opened on none, but version 1 is there now';
  assert pg_temp.publish(wes, '# Road Rules', null, false, 2) = clash, 'opened on a version that isn''t there yet';
  assert pg_temp.published(wes, E'# Road Rules\n\n- Ride staggered', '  Fixed a typo  ', false, 1) = 2,
    'a sitting President publishes version 2';
  select * into v from road_rules_versions where number = 2;
  assert v.body = E'# Road Rules\n\n- Ride staggered', 'the text, inside lines kept';
  assert v.changes = 'Fixed a typo', 'what changed, trimmed';
  assert not v.fresh, 'a small fix: sign-offs carry over';
  assert v.published_by = wes, 'Wes';
  assert pg_temp.publish(cara, 'Ride safe', null, true, 1) = clash, 'the Chairman, on an editor opened on version 1';
  assert pg_temp.current() = 2 and (select count(*) from road_rules_versions) = 2, 'two versions';
  -- 500 code points of what changed is fine.
  assert pg_temp.published(cara, E'# Road Rules\n\n- Ride staggered\n- Keep left', repeat('é', 500), null, 2) = 3,
    'the Chairman publishes version 3';
  select * into v from road_rules_versions where number = 3;
  assert v.changes = repeat('é', 500), '500 code points';
  assert v.fresh, 'no answer means the default, everyone signs again';
end $$;

\echo 'Signing: the version on screen must be the current one; signing again moves the date on'
do $$
declare
  fergus constant uuid := '00000000-0000-0000-0000-0000000000f5';
  fran constant uuid := '00000000-0000-0000-0000-0000000000f7';
  paul constant uuid := '00000000-0000-0000-0000-0000000000f9';
  outdated constant text := 'The Road Rules changed while you had them open. Read the new version, then sign.';
  s road_rules_signoffs%rowtype;
begin
  assert pg_temp.sign(fergus, 2) = outdated, 'an older version';
  assert pg_temp.sign(fergus, 1) = outdated, 'version 1';
  assert pg_temp.sign(fergus, 4) = outdated, 'a version that isn''t there';
  assert pg_temp.sign(fergus, null) = outdated, 'no version';
  assert pg_temp.sign(paul, 3) = 'Only approved members can do that.', 'an applicant, even on the current version';
  assert not exists (select 1 from road_rules_signoffs), 'nothing was signed';

  assert pg_temp.sign(fergus, 3) is null, 'Fergus signs version 3';
  select * into s from road_rules_signoffs where member_id = fergus;
  assert found and s.version = 3 and s.signed_at = now(), 'version 3, now';
  assert private.road_rules_signed(fergus), 'so he is signed';
  assert not private.road_rules_signed(fran), 'Fran isn''t';

  update road_rules_signoffs set version = 1, signed_at = now() - interval '200 days' where member_id = fergus;
  assert pg_temp.sign(fergus, 3) is null, 'he signs again';
  select * into s from road_rules_signoffs where member_id = fergus;
  assert s.version = 3 and s.signed_at = now(), 'the version and date move on';
  assert (select count(*) from road_rules_signoffs where member_id = fergus) = 1, 'one row per member';
  assert pg_temp.sign(fergus, 3) is null, 'signing while signed is fine';
  assert (select count(*) from road_rules_signoffs) = 1, 'still one row';
end $$;

\echo 'Nobody writes versions or sign-offs through the API; approved members see all of both, applicants and the public nothing'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000f5';
  n_versions bigint := (select count(*) from road_rules_versions);
  n_signoffs bigint := (select count(*) from road_rules_signoffs);
  fergus_at timestamptz := (select signed_at from road_rules_signoffs where member_id = '00000000-0000-0000-0000-0000000000f5');
begin
  assert n_versions > 0 and n_signoffs > 0, 'there is something to read';
  assert pg_temp.try_as(cara, $q$insert into road_rules_versions (number, body, fresh) values (9, 'Sneaky', true)$q$)
    is not null, 'insert a version, even as the Chairman';
  assert pg_temp.try_as(cara, $q$update road_rules_versions set body = 'Mine'$q$) is not null, 'edit versions';
  assert pg_temp.try_as(cara, $q$delete from road_rules_versions$q$) is not null, 'remove versions';
  assert pg_temp.try_as(fergus, format($q$insert into road_rules_signoffs (member_id, version, signed_at) values (%L, 3, now())$q$,
    cara)) is not null, 'insert a sign-off';
  assert pg_temp.try_as(fergus, $q$update road_rules_signoffs set signed_at = now() + interval '5 years'$q$) is not null,
    'move a sign-off on';
  assert pg_temp.try_as(fergus, $q$delete from road_rules_signoffs$q$) is not null, 'remove sign-offs';
  assert pg_temp.try_as(null, $q$delete from road_rules_versions$q$) is not null, 'anon, versions';
  assert pg_temp.try_as(null, $q$delete from road_rules_signoffs$q$) is not null, 'anon, sign-offs';
  assert pg_temp.try_as(null, $q$insert into road_rules_versions (number, body, fresh) values (9, 'Sneaky', true)$q$)
    is not null, 'anon, a version';
  assert (select count(*) from road_rules_versions) = n_versions and (select count(*) from road_rules_signoffs) = n_signoffs,
    'untouched';
  assert not exists (select 1 from road_rules_versions where body in ('Sneaky', 'Mine')), 'really untouched';
  assert (select signed_at from road_rules_signoffs where member_id = fergus) = fergus_at, 'Fergus''s date as it was';

  assert pg_temp.count_as(fergus, 'road_rules_versions') = n_versions, 'an FNG reads every version';
  assert pg_temp.count_as(fergus, 'road_rules_signoffs') = n_signoffs, 'and every sign-off';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000f9', 'road_rules_versions') = 0, 'an applicant sees no versions';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000f9', 'road_rules_signoffs') = 0, 'nor any sign-offs';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000fb', 'road_rules_versions') = 0, 'nor a stranger';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000fb', 'road_rules_signoffs') = 0, 'nor a stranger, sign-offs';
  assert pg_temp.count_as(null, 'road_rules_versions') = -1, 'the public has no grant';
  assert pg_temp.count_as(null, 'road_rules_signoffs') = -1, 'nor on sign-offs';
end $$;

\echo 'The table rules hold even for a direct write'
do $$
begin
  begin
    insert into road_rules_versions (number, body, fresh) values (0, 'Ride safe', true);
    assert false, 'version 0 got in';
  exception when check_violation then null;
  end;
  begin
    insert into road_rules_versions (number, body, fresh) values (9, repeat('🏍', 20001), true);
    assert false, 'a long text got in';
  exception when check_violation then null;
  end;
  begin
    insert into road_rules_versions (number, body, fresh) values (9, E' \t　', true);
    assert false, 'a blank text got in';
  exception when check_violation then null;
  end;
  begin
    insert into road_rules_versions (number, body, fresh) values (9, null, true);
    assert false, 'no text got in';
  exception when not_null_violation then null;
  end;
  begin
    insert into road_rules_versions (number, body, changes, fresh) values (9, 'Ride safe', repeat('x', 501), true);
    assert false, 'a long what changed got in';
  exception when check_violation then null;
  end;
  begin
    insert into road_rules_versions (number, body, fresh) values (9, 'Ride safe', null);
    assert false, 'no fresh answer got in';
  exception when not_null_violation then null;
  end;
  begin
    insert into road_rules_versions (number, body, fresh) values (3, 'Ride safe', true);
    assert false, 'a second version 3 got in';
  exception when unique_violation then null;
  end;
  begin
    insert into road_rules_signoffs (member_id, version, signed_at) values ('00000000-0000-0000-0000-0000000000f7', 9, now());
    assert false, 'a sign-off on a version that isn''t there got in';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into road_rules_signoffs (member_id, version) values ('00000000-0000-0000-0000-0000000000f7', 3);
    assert false, 'a sign-off with no date got in';
  exception when not_null_violation then null;
  end;
  begin
    insert into road_rules_signoffs (member_id, version, signed_at) values ('00000000-0000-0000-0000-0000000000f5', 3, now());
    assert false, 'a second sign-off for Fergus got in';
  exception when unique_violation then null;
  end;
  -- A version with no time is published now; undone after.
  begin
    insert into road_rules_versions (number, body, fresh) values (9, 'Ride safe', true);
    assert (select published_at = now() and published_by is null and changes is null from road_rules_versions where number = 9),
      'published now by default, by nobody, with no What changed';
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert not exists (select 1 from road_rules_versions where number = 9), 'undone';
end $$;

-- private.road_rules_signed for a member as if today (in Melbourne) were p_today. The club's clock
-- is swapped for the call and put back after it.
create function pg_temp.signed_on(p_member uuid, p_today date) returns boolean language plpgsql as $$
declare out boolean;
begin
  execute format($f$create or replace function private.club_date(at_time timestamptz default now())
    returns date language sql stable set search_path = '' as $b$select %L::date$b$ $f$, p_today);
  execute 'select private.road_rules_signed($1)' into out using p_member;
  raise sqlstate 'U0002' using message = out::text;
exception when sqlstate 'U0002' then
  return sqlerrm::boolean;
end $$;

-- Gives a member a sign-off on a version at a time, replacing any they had.
create function pg_temp.give(p_member uuid, p_version int, p_at timestamptz) returns void language sql as $$
  insert into public.road_rules_signoffs (member_id, version, signed_at) values (p_member, p_version, p_at)
  on conflict (member_id) do update set version = excluded.version, signed_at = excluded.signed_at;
$$;

\echo 'road_rules_signed agrees with the app on the expiry edges: the same Melbourne date a year on, 29 February to 28 February'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000f7';
begin
  assert private.club_date() = (now() at time zone 'Australia/Melbourne')::date, 'the real clock is back';
  -- Signed on 29 February 2028 in Melbourne: good until 28 February 2029.
  perform pg_temp.give(fran, 3, '2028-02-29T03:00:00Z');
  assert pg_temp.signed_on(fran, '2028-02-29'), 'the day she signed';
  assert pg_temp.signed_on(fran, '2029-01-28'), '31 days left';
  assert pg_temp.signed_on(fran, '2029-01-29'), '30 days left: due soon, still signed';
  assert pg_temp.signed_on(fran, '2029-02-28'), 'still signed on the good-until date';
  assert not pg_temp.signed_on(fran, '2029-03-01'), 'run out the day after';
  -- 28 February 13:30 UTC is already 29 February in Melbourne.
  perform pg_temp.give(fran, 3, '2028-02-28T13:30:00Z');
  assert pg_temp.signed_on(fran, '2029-02-28') and not pg_temp.signed_on(fran, '2029-03-01'), 'a Melbourne 29 February';
  -- 14 November 14:00 UTC is 15 November in Melbourne: good until 15 November 2026.
  perform pg_temp.give(fran, 3, '2025-11-14T14:00:00Z');
  assert pg_temp.signed_on(fran, '2026-10-16'), '30 days left';
  assert pg_temp.signed_on(fran, '2026-11-15'), 'the good-until date, Melbourne''s';
  assert not pg_temp.signed_on(fran, '2026-11-16'), 'the day after';
  perform pg_temp.give(fran, 3, '2025-11-14T12:00:00Z');
  assert not pg_temp.signed_on(fran, '2026-11-15'), 'signed 14 November in Melbourne, so run out by the 15th';
  -- 30 June 15:00 UTC is 1 July in Melbourne.
  perform pg_temp.give(fran, 3, '2025-06-30T15:00:00Z');
  assert pg_temp.signed_on(fran, '2026-07-01') and not pg_temp.signed_on(fran, '2026-07-02'), 'good until 1 July';
  perform pg_temp.give(fran, 3, '2027-02-28T03:00:00Z');
  assert pg_temp.signed_on(fran, '2028-02-28') and not pg_temp.signed_on(fran, '2028-02-29'), 'a plain 28 February';
  perform pg_temp.give(fran, 3, '2025-12-31T03:00:00Z');
  assert pg_temp.signed_on(fran, '2026-12-31') and not pg_temp.signed_on(fran, '2027-01-01'), 'over the new year';

  -- On the real clock: signed a year ago today (in Melbourne) is still signed, a day earlier is not.
  perform pg_temp.give(fran, 3, ((private.club_date() - interval '1 year')::date + time '12:00') at time zone 'Australia/Melbourne');
  if to_char(private.club_date(), 'MM-DD') <> '02-29' then
    assert private.road_rules_signed(fran), 'signed a year ago today';
  end if;
  perform pg_temp.give(fran, 3, ((private.club_date() - interval '1 year')::date - 1 + time '12:00') at time zone 'Australia/Melbourne');
  assert not private.road_rules_signed(fran), 'a year and a day ago';
  assert not private.road_rules_signed('00000000-0000-0000-0000-0000000000f3'), 'never signed';
  assert not private.road_rules_signed(null), 'nobody';
  assert private.club_date() = (now() at time zone 'Australia/Melbourne')::date, 'the real clock is still there';
end $$;

\echo 'road_rules_signed: a sign-off counts on the base (the newest fresh version) or later, so small fixes carry over'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000f5';
  fran constant uuid := '00000000-0000-0000-0000-0000000000f7';
  sam constant uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  -- Version 3 is the base. Fran signed version 2, before it.
  perform pg_temp.give(fran, 2, now());
  assert not private.road_rules_signed(fran), 'a sign-off before the base doesn''t count, however recent';
  perform pg_temp.give(sam, 3, now() - interval '30 days');
  assert private.road_rules_signed(sam) and private.road_rules_signed(fergus), 'Sam and Fergus signed the base';

  -- Version 4 is a small fix: sign-offs on 3 carry over.
  assert pg_temp.published(cara, 'Ride safe, version 4', 'Typo', false, 3) = 4, 'version 4, not fresh';
  assert private.road_rules_signed(sam) and private.road_rules_signed(fergus), 'still signed after a small fix';
  assert not private.road_rules_signed(fran), 'and Fran still isn''t';
  assert pg_temp.sign(sam, 3) = 'The Road Rules changed while you had them open. Read the new version, then sign.',
    'but signing means the current version';
  assert pg_temp.sign(fran, 4) is null, 'Fran signs version 4';
  assert private.road_rules_signed(fran), 'so she counts';

  -- Version 5 needs everyone again.
  assert pg_temp.published(cara, 'Ride safe, version 5', 'New rule on pillions', true, 4) = 5, 'version 5, fresh';
  assert not private.road_rules_signed(sam) and not private.road_rules_signed(fergus) and not private.road_rules_signed(fran),
    'nobody is signed now';
  assert pg_temp.sign(fergus, 5) is null, 'Fergus signs version 5';
  assert private.road_rules_signed(fergus), 'so he counts again';
end $$;

\echo 'Publishing takes the Road Rules lock, so two publishes queue; a sign shares it, so it waits for a publish'
create extension if not exists dblink;
-- The advisory locks this session holds on the Road Rules key right now, by mode.
create function pg_temp.rules_locks() returns text[] language sql as $$
  select coalesce(array_agg(l.mode order by l.mode), '{}') from pg_locks l
  where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
    and l.classid::bigint = (hashtext('road_rules_publish')::bigint >> 32) & 4294967295
    and l.objid::bigint = hashtext('road_rules_publish')::bigint & 4294967295;
$$;
-- Whether a second session can take the Road Rules lock right now, without waiting.
create function pg_temp.other_session_can(p_shared boolean) returns boolean language sql as $$
  select ok from dblink(
    format('dbname=%s host=%s port=%s user=postgres', current_database(),
      split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port')),
    format('select %s(hashtext(''road_rules_publish''))',
      case when p_shared then 'pg_try_advisory_xact_lock_shared' else 'pg_try_advisory_xact_lock' end)
  ) as t(ok boolean);
$$;
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  fran constant uuid := '00000000-0000-0000-0000-0000000000f7';
  locks text[];
  other_publish boolean;
  other_sign boolean;
begin
  assert pg_temp.rules_locks() = '{}', 'no lock to begin with';
  assert pg_temp.other_session_can(false), 'a second session can take the lock when nobody holds it';

  -- Each action runs in a block that is then undone, which also lets go of its locks.
  begin
    assert pg_temp.published(cara, 'Ride safe, version 6', null, true, 5) = 6, 'Cara publishes';
    locks := pg_temp.rules_locks();
    other_publish := pg_temp.other_session_can(false);
    other_sign := pg_temp.other_session_can(true);
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{ExclusiveLock}', format('publish holds the lock until it commits, not %s', locks);
  assert not other_publish, 'so a second publish waits';
  assert not other_sign, 'and so does a sign';
  assert pg_temp.current() = 5, 'the check changed nothing';

  begin
    assert pg_temp.sign(fran, 5) is null, 'Fran signs';
    locks := pg_temp.rules_locks();
    other_publish := pg_temp.other_session_can(false);
    other_sign := pg_temp.other_session_can(true);
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{ShareLock}', format('sign shares the lock, not %s', locks);
  assert not other_publish, 'so a publish waits for it';
  assert other_sign, 'but other signs don''t';
  assert pg_temp.rules_locks() = '{}' and pg_temp.other_session_can(false), 'and it is let go';
end $$;

\echo 'A sign-off goes with its member; a version stays when its publisher leaves'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000f1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000f5';
begin
  assert exists (select 1 from road_rules_signoffs where member_id = fergus), 'Fergus signed';
  delete from members where id = fergus;
  assert not exists (select 1 from road_rules_signoffs where member_id = fergus), 'his sign-off went with him';
  delete from members where id = cara;
  assert (select count(*) from road_rules_versions) = 5, 'every version stays';
  assert (select published_by is null from road_rules_versions where number = 1), 'unsigned now';
end $$;
