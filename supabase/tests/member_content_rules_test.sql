-- Member content rules (App Store Guideline 1.2): the club rules gate on posting, reports on
-- listings, build updates, nominations, workshops and profiles, and suspending a member's app
-- access. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- The test harness defaults posting_rules_accepted_on for every test. Here it's set by hand.
alter table public.members alter column posting_rules_accepted_on drop default;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'wes@example.com', now()),     -- West Full, has agreed
  ('00000000-0000-0000-0000-0000000000c2', 'sec@example.com', now()),     -- West Secretary (board), agreed
  ('00000000-0000-0000-0000-0000000000c3', 'nora@example.com', now()),    -- North Full, agreed
  ('00000000-0000-0000-0000-0000000000c4', 'pres@example.com', now()),    -- North President (board, NEC), agreed
  ('00000000-0000-0000-0000-0000000000c5', 'fresh@example.com', now()),   -- West Full, NOT agreed yet
  ('00000000-0000-0000-0000-0000000000c6', 'fam@example.com', now());     -- West Family

insert into members (id, chapter_id, full_name, road_name, status, approval, bio, posting_rules_accepted_on)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state, v.bio, v.agreed
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'west', 'Wes West', 'Wes', 'full', 'approved', 'Rides a Harley', date '2026-10-31'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Sue Secretary', 'Sec', 'full', 'approved', null, date '2026-10-31'),
  ('00000000-0000-0000-0000-0000000000c3', 'north', 'Nora North', 'Nora', 'full', 'approved', null, date '2026-10-31'),
  ('00000000-0000-0000-0000-0000000000c4', 'north', 'Pat President', 'Pres', 'full', 'approved', null, date '2026-10-31'),
  ('00000000-0000-0000-0000-0000000000c5', 'west', 'Fresh Face', null, 'full', 'approved', null, null),
  ('00000000-0000-0000-0000-0000000000c6', 'west', 'Fay Family', null, 'family', 'approved', null, null)
) as v(id, chapter, name, road, status, approval, bio, agreed)
join chapters c on c.slug = v.chapter;

insert into positions (member_id, chapter_id, role, started_on)
select v.member::uuid, c.id, v.role::position_role, private.club_date()
from (values
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000c4', 'north', 'president')
) as v(member, chapter, role)
join chapters c on c.slug = v.chapter;

insert into bikes (id, member_id, make, model, year, is_project) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Honda', 'CB750', 1978, true),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5', 'Yamaha', 'XS650', 1979, true);

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

-- Runs a query as someone and returns its first value as text (errors are raised).
create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;
grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text) to anon, authenticated;

create function pg_temp.club_chat() returns uuid language sql as $$ select id from conversations where kind = 'club' $$;
grant execute on function pg_temp.club_chat() to anon, authenticated;

\echo 'Until a member agrees to the club rules, every kind of post is refused with the app’s words'
do $$
declare
  fresh uuid := '00000000-0000-0000-0000-0000000000c5';
  wes uuid := '00000000-0000-0000-0000-0000000000c1';
  agree text := 'Agree to the club rules for chats and posts first.';
  award uuid;
begin
  assert pg_temp.try_as(fresh, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.club_chat(), 'g’day')) = agree, 'message';
  assert pg_temp.try_as(fresh, 'select public.save_listing(null, ''sell'', ''Panniers'', 150, null, ''[]'')') = agree, 'listing';
  assert pg_temp.try_as(fresh, 'select public.post_build_update(''00000000-0000-0000-0000-0000000000b5'', ''Tank off'', ''[]'')') = agree, 'build';
  assert pg_temp.try_as(fresh, 'select public.save_mechanic(null, ''Joe’s'', null, null, null, null, ''Good bloke'')') = agree, 'mechanic';
  award := pg_temp.value_as('00000000-0000-0000-0000-0000000000c2',
    format('select public.open_award(''story'', ''Best breakdown'', %s, %L, %L)', extract(year from private.club_date())::int,
           private.club_date() + 10, private.club_date() + 20))::uuid;
  assert pg_temp.try_as(fresh, format('select public.nominate(%L, null, ''The night the chain went'', null, ''Long story'', null)', award)) = agree, 'nomination';
  assert pg_temp.try_as(fresh, 'select public.save_profile(''Fresh Face'', null, ''Loves a twisty road'', false)') = agree, 'bio';
  -- A name change with no bio is fine before agreeing (an applicant fixes a typo).
  assert pg_temp.try_as(fresh, 'select public.save_profile(''Fresh Facer'', null, null, false)') is null, 'name only';
  -- Someone who agreed is fine, and the content checks still come first for them.
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.club_chat(), 'g’day')) is null, 'wes message';
  assert pg_temp.try_as(wes, 'select public.save_listing(null, ''sell'', '''', 150, null, ''[]'')') = 'Give it a title.', 'content first';
end $$;

\echo 'Agreeing records today, once, and opens posting up; a second tap keeps the first date'
do $$
declare
  fresh uuid := '00000000-0000-0000-0000-0000000000c5';
  fam uuid := '00000000-0000-0000-0000-0000000000c6';
begin
  assert pg_temp.try_as(null, 'select public.accept_posting_rules()') is not null, 'anon';
  assert pg_temp.try_as(fam, 'select public.accept_posting_rules()') = 'Only approved members can do that.', 'family';
  assert pg_temp.value_as(fresh, 'select public.accept_posting_rules()')::date = private.club_date(), 'today';
  update public.members set posting_rules_accepted_on = date '2026-01-01' where id = fresh;
  assert pg_temp.value_as(fresh, 'select public.accept_posting_rules()')::date = date '2026-01-01', 'kept';
  assert pg_temp.try_as(fresh, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.club_chat(), 'now I can')) is null, 'message after';
  assert pg_temp.try_as(fresh, 'select public.save_profile(''Fresh Face'', null, ''Loves a twisty road'', false)') is null, 'bio after';
end $$;

\echo 'Reporting: the rules, in the app’s order'
do $$
declare
  wes uuid := '00000000-0000-0000-0000-0000000000c1';
  nora uuid := '00000000-0000-0000-0000-0000000000c3';
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  listing uuid;
  down uuid;
  r uuid;
begin
  listing := pg_temp.value_as(wes, 'select public.save_listing(null, ''sell'', ''Panniers'', 150, ''Hardly used'', ''[]'')')::uuid;
  down := pg_temp.value_as(wes, 'select public.save_listing(null, ''free'', ''Old tyre'', null, null, ''[]'')')::uuid;
  perform pg_temp.value_as(wes, format('select public.take_down_listing(%L)', down));
  assert pg_temp.try_as(null, format('select public.report_content(''listing'', %L, null)', listing)) is not null, 'anon';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c6', format('select public.report_content(''listing'', %L, null)', listing)) = 'Only approved members can do that.', 'family';
  assert pg_temp.try_as(nora, format('select public.report_content(''photo'', %L, null)', listing)) = 'Pick what you’re reporting.', 'kind';
  assert pg_temp.try_as(nora, 'select public.report_content(''listing'', gen_random_uuid(), null)') = 'No such listing.', 'missing';
  assert pg_temp.try_as(nora, 'select public.report_content(''profile'', gen_random_uuid(), null)') = 'That member no longer exists.', 'missing member';
  assert pg_temp.try_as(nora, format('select public.report_content(''listing'', %L, null)', down)) = 'That listing has been taken down.', 'gone';
  assert pg_temp.try_as(wes, format('select public.report_content(''listing'', %L, null)', listing)) = 'You can’t report your own listing.', 'own';
  assert pg_temp.try_as(wes, format('select public.report_content(''profile'', %L, null)', wes)) = 'You can’t report your own profile.', 'own profile';
  assert pg_temp.try_as(nora, format('select public.report_content(''listing'', %L, %L)', listing, repeat('x', 501))) = 'Keep the reason under 500 characters.', 'long';
  r := pg_temp.value_as(nora, format('select public.report_content(''listing'', %L, ''Not on'')', listing))::uuid;
  assert (select snapshot from content_reports where id = r) = E'Panniers\nHardly used', 'snapshot';
  assert (select author_id from content_reports where id = r) = wes, 'author';
  -- Reporting again changes the reason, with one report per member per thing.
  assert pg_temp.value_as(nora, format('select public.report_content(''listing'', %L, ''Really not on'')', listing))::uuid = r, 'same report';
  assert (select reason from content_reports where id = r) = 'Really not on', 'reason changed';
  -- Nobody reads or writes the table directly.
  assert pg_temp.try_as(nora, 'select * from public.content_reports') is not null, 'no direct read';
  assert pg_temp.try_as(sec, 'select * from public.content_reports') is not null, 'no direct read for the board';
  -- The reporter sees it among their own open reports; the thing's owner doesn't.
  assert pg_temp.value_as(nora, 'select public.my_open_reports()')::jsonb @> format('[{"kind":"listing","target_id":"%s"}]', listing)::jsonb, 'mine';
  assert pg_temp.value_as(wes, 'select public.my_open_reports()')::jsonb = '[]'::jsonb, 'not theirs';
end $$;

\echo 'Who sees a report, and dealing with it: remove takes the thing down and closes every report on it'
do $$
declare
  wes uuid := '00000000-0000-0000-0000-0000000000c1';
  nora uuid := '00000000-0000-0000-0000-0000000000c3';
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  pres uuid := '00000000-0000-0000-0000-0000000000c4';
  listing uuid := (select target_id from content_reports where kind = 'listing' limit 1);
  r uuid := (select id from content_reports where kind = 'listing' limit 1);
  r2 uuid;
  profile uuid;
  n int;
begin
  -- Any board member or the NEC sees a listing report; a plain member doesn't.
  assert jsonb_array_length(pg_temp.value_as(sec, 'select public.content_reports()')::jsonb) = 1, 'secretary sees it';
  assert jsonb_array_length(pg_temp.value_as(pres, 'select public.content_reports()')::jsonb) = 1, 'president sees it';
  assert jsonb_array_length(pg_temp.value_as(wes, 'select public.content_reports()')::jsonb) = 0, 'a member doesn’t';
  assert pg_temp.try_as(wes, format('select public.resolve_content_report(%L, true)', r)) = 'Only the board can do that.', 'member';
  assert pg_temp.try_as(sec, 'select public.resolve_content_report(gen_random_uuid(), true)') = 'No such report.', 'missing';
  -- A second member reports the same listing; one removal closes both.
  r2 := pg_temp.value_as(sec, format('select public.report_content(''listing'', %L, null)', listing))::uuid;
  assert pg_temp.try_as(pres, format('select public.resolve_content_report(%L, true)', r)) is null, 'removed';
  assert (select taken_down_at from listings where id = listing) is not null, 'listing taken down';
  assert (select taken_down_by from listings where id = listing) = pres, 'by whom';
  select count(*) into n from content_reports where target_id = listing and resolved_at is not null and outcome = 'removed';
  assert n = 2, 'both reports closed';
  assert pg_temp.try_as(pres, format('select public.resolve_content_report(%L, false)', r2)) = 'That report was already dealt with.', 'dealt with';
  assert pg_temp.value_as(nora, 'select public.my_open_reports()')::jsonb = '[]'::jsonb, 'nothing open for the reporter';

  -- A profile report goes to that member's chapter board only. Dismissing leaves the bio alone.
  profile := pg_temp.value_as(nora, format('select public.report_content(''profile'', %L, ''Rude bio'')', wes))::uuid;
  assert (select snapshot from content_reports where id = profile) = E'Wes West\nWes\nRides a Harley', 'profile snapshot';
  assert jsonb_array_length(pg_temp.value_as(sec, 'select public.content_reports()')::jsonb) = 1, 'West board sees it';
  assert jsonb_array_length(pg_temp.value_as(pres, 'select public.content_reports()')::jsonb) = 0, 'North president doesn’t';
  assert pg_temp.try_as(pres, format('select public.resolve_content_report(%L, true)', profile)) = 'Only that member’s chapter board can do that.', 'wrong board';
  assert pg_temp.try_as(sec, format('select public.resolve_content_report(%L, false)', profile)) is null, 'dismissed';
  assert (select bio from members where id = wes) = 'Rides a Harley', 'bio kept';
  -- Reported again and removed: the bio goes.
  profile := pg_temp.value_as(nora, format('select public.report_content(''profile'', %L, ''Still rude'')', wes))::uuid;
  assert pg_temp.try_as(sec, format('select public.resolve_content_report(%L, true)', profile)) is null, 'removed profile';
  assert (select bio from members where id = wes) is null, 'bio cleared';
end $$;

\echo 'Reports on a build update, a nomination and a workshop: remove does what the board can already do'
do $$
declare
  wes uuid := '00000000-0000-0000-0000-0000000000c1';
  nora uuid := '00000000-0000-0000-0000-0000000000c3';
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  upd uuid;
  mech uuid;
  award uuid := (select id from brag_awards limit 1);
  nom uuid;
  r uuid;
begin
  upd := pg_temp.value_as(wes, 'select public.post_build_update(''00000000-0000-0000-0000-0000000000b1'', ''Tank off'', ''[]'')')::uuid;
  r := pg_temp.value_as(nora, format('select public.report_content(''build_update'', %L, null)', upd))::uuid;
  assert (select snapshot from content_reports where id = r) = 'Tank off', 'update snapshot';
  assert pg_temp.try_as(sec, format('select public.resolve_content_report(%L, true)', r)) is null;
  assert (select taken_down_at from build_updates where id = upd) is not null, 'update taken down';
  assert pg_temp.try_as(nora, format('select public.report_content(''build_update'', %L, null)', upd)) = 'That update has been taken down.';

  mech := pg_temp.value_as(wes, 'select public.save_mechanic(null, ''Joe’s'', ''Sunshine'', null, null, ''Harleys'', ''Good bloke'')')::uuid;
  r := pg_temp.value_as(nora, format('select public.report_content(''mechanic'', %L, null)', mech))::uuid;
  assert (select snapshot from content_reports where id = r) = E'Joe’s\nHarleys\nGood bloke', 'workshop snapshot';
  assert pg_temp.try_as(sec, format('select public.resolve_content_report(%L, true)', r)) is null;
  assert (select archived_at from mechanics where id = mech) is not null, 'workshop off the list';
  assert pg_temp.try_as(nora, format('select public.report_content(''mechanic'', %L, null)', mech)) = 'That workshop is off the list.';

  nom := pg_temp.value_as(wes, format('select public.nominate(%L, null, ''The night the chain went'', null, ''Long story'', ''Classic'')', award))::uuid;
  r := pg_temp.value_as(nora, format('select public.report_content(''nomination'', %L, null)', nom))::uuid;
  assert (select snapshot from content_reports where id = r) = E'The night the chain went\nLong story\n“Classic”', 'nomination snapshot';
  -- Even after nominations close, the board can still remove a reported one.
  update brag_awards set nominations_close = private.club_date() - 1, voting_close = private.club_date() + 5 where id = award;
  assert pg_temp.try_as(sec, format('select public.resolve_content_report(%L, true)', r)) is null;
  assert (select withdrawn_at from brag_nominations where id = nom) is not null, 'nomination withdrawn';
  assert pg_temp.try_as(nora, format('select public.report_content(''nomination'', %L, null)', nom)) = 'That nomination has been withdrawn.';
end $$;

\echo 'Suspending app access locks a member out at once; restoring lets them back'
do $$
declare
  wes uuid := '00000000-0000-0000-0000-0000000000c1';
  nora uuid := '00000000-0000-0000-0000-0000000000c3';
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  pres uuid := '00000000-0000-0000-0000-0000000000c4';
  fam uuid := '00000000-0000-0000-0000-0000000000c6';
begin
  assert pg_temp.try_as(null, format('select public.suspend_member_access(%L)', wes)) is not null, 'anon';
  assert pg_temp.try_as(fam, format('select public.suspend_member_access(%L)', wes)) = 'Only approved members can do that.', 'family';
  assert pg_temp.try_as(sec, 'select public.suspend_member_access(gen_random_uuid())') = 'That member no longer exists.', 'missing';
  assert pg_temp.try_as(sec, format('select public.suspend_member_access(%L)', sec)) = 'You can’t suspend your own access.', 'self';
  assert pg_temp.try_as(pres, format('select public.suspend_member_access(%L)', wes)) = 'Only that member’s chapter board can do that.', 'other chapter';
  assert pg_temp.try_as(nora, format('select public.suspend_member_access(%L)', wes)) = 'Only that member’s chapter board can do that.', 'plain member';
  assert pg_temp.try_as(sec, format('select public.restore_member_access(%L)', wes)) = 'Their access isn’t suspended.', 'not suspended';
  assert pg_temp.try_as(sec, format('select public.suspend_member_access(%L)', wes)) is null, 'suspended';
  assert (select approval from members where id = wes) = 'suspended';
  assert pg_temp.try_as(sec, format('select public.suspend_member_access(%L)', wes)) = 'They’re not an approved member.', 'twice';
  -- Locked out: no chat, no directory, but their own row is still readable (the app shows why).
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.club_chat(), 'hello?')) = 'Only approved members can do that.', 'no chat';
  assert pg_temp.value_as(wes, 'select count(*) from public.members')::int = 1, 'only their own row';
  assert pg_temp.value_as(wes, 'select approval from public.members')::text = 'suspended', 'and it says suspended';
  assert pg_temp.try_as(sec, format('select public.restore_member_access(%L)', sec)) = 'You can’t restore your own access.', 'self restore';
  assert pg_temp.try_as(pres, format('select public.restore_member_access(%L)', wes)) = 'Only that member’s chapter board can do that.', 'other chapter restore';
  assert pg_temp.try_as(sec, format('select public.restore_member_access(%L)', wes)) is null, 'restored';
  assert (select approval from members where id = wes) = 'approved';
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.club_chat(), 'back')) is null, 'chat again';
  -- Nobody can call the private helpers.
  assert pg_temp.try_as(sec, 'select private.can_act_on_content_report(gen_random_uuid())') is not null, 'private';
  assert pg_temp.try_as(sec, format('select private.posting_rules_agreed(%L)', wes)) is not null, 'private 2';
end $$;

\echo 'MEMBER CONTENT RULES CHECKS PASSED'
