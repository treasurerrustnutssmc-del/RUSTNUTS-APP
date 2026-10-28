-- Checks Stage 5D's database side beyond the shared parity cases: conduct records delete
-- themselves (the purge, set-aside reviews, reads past their day), who reads what, a paid merch
-- order lands in the books as CR-005, contribution shares add up to the cent and settle by
-- majority, and an approved chapter is made with its founders, seats and chats.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005d1', 'chair@example.com'),  -- NEC Chairman, North
  ('00000000-0000-0000-0000-0000000005d2', 'sec@example.com'),    -- West Secretary
  ('00000000-0000-0000-0000-0000000005d3', 'tre@example.com'),    -- West Treasurer
  ('00000000-0000-0000-0000-0000000005d4', 'rider@example.com'),  -- West Full
  ('00000000-0000-0000-0000-0000000005d5', 'other@example.com'),  -- North Full
  ('00000000-0000-0000-0000-0000000005d6', 'f1@example.com'),
  ('00000000-0000-0000-0000-0000000005d7', 'f2@example.com'),
  ('00000000-0000-0000-0000-0000000005d8', 'f3@example.com'),
  ('00000000-0000-0000-0000-0000000005d9', 'f4@example.com'),
  ('00000000-0000-0000-0000-0000000005da', 'f5@example.com'),
  ('00000000-0000-0000-0000-0000000005db', 'nsec@example.com');   -- North Secretary

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, 'full', 'approved'
from (values
  ('00000000-0000-0000-0000-0000000005d1', 'north', 'Cara Chair', null),
  ('00000000-0000-0000-0000-0000000005d2', 'west', 'Sam Secretary', null),
  ('00000000-0000-0000-0000-0000000005d3', 'west', 'Tess Treasurer', null),
  ('00000000-0000-0000-0000-0000000005d4', 'west', 'Rob Rider', 'Rusty'),
  ('00000000-0000-0000-0000-0000000005d5', 'north', 'Olly Other', null),
  ('00000000-0000-0000-0000-0000000005d6', 'west', 'Fay One', null),
  ('00000000-0000-0000-0000-0000000005d7', 'west', 'Fay Two', null),
  ('00000000-0000-0000-0000-0000000005d8', 'north', 'Fay Three', null),
  ('00000000-0000-0000-0000-0000000005d9', 'north', 'Fay Four', null),
  ('00000000-0000-0000-0000-0000000005da', 'north', 'Fay Five', null),
  ('00000000-0000-0000-0000-0000000005db', 'north', 'Nell Secretary', null)
) as v(id, slug, name, road)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000005d1', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000005d2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000005d3', 'west', 'treasurer'),
  ('00000000-0000-0000-0000-0000000005db', 'north', 'secretary')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;

create function pg_temp.as_user(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
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

create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute stmt into out;
  reset role;
  return out;
end $$;

\o
\echo 'Stage 5D: conduct records, merch, national contributions, new chapters'
\o /dev/null

-- Conduct records -------------------------------------------------------------------------------

do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000005d2';
  rider constant uuid := '00000000-0000-0000-0000-0000000005d4';
  other constant uuid := '00000000-0000-0000-0000-0000000005d5';
  chair constant uuid := '00000000-0000-0000-0000-0000000005d1';
  t constant date := private.club_date();
  rec uuid; old uuid; n int; err text;
begin
  rec := pg_temp.value_as(sec, format('select public.record_conduct(%L, ''vest'', ''  Helmet cover.  '', '''', %L, %L, null)', rider, t - 2, t - 1))::uuid;
  assert (select summary from conduct_records where id = rec) = 'Helmet cover.', 'trimmed like the app';
  assert (select rule from conduct_records where id = rec) is null, 'an empty rule is null';
  -- Readers: the member and their board see it; another chapter's member doesn't.
  assert jsonb_array_length(pg_temp.value_as(rider, 'select public.club_admin()->''conduct''')::jsonb) = 1, 'the member sees it';
  assert jsonb_array_length(pg_temp.value_as(other, 'select public.club_admin()->''conduct''')::jsonb) = 0, 'others don''t';
  -- It follows the member when they move chapter (12.4).
  update members set chapter_id = (select id from chapters where slug = 'north') where id = rider;
  assert jsonb_array_length(pg_temp.value_as('00000000-0000-0000-0000-0000000005db', 'select public.club_admin()->''conduct''')::jsonb) = 1, 'the new board sees it';
  assert jsonb_array_length(pg_temp.value_as(sec, 'select public.club_admin()->''conduct''')::jsonb) = 0, 'the old board doesn''t';
  update members set chapter_id = (select id from chapters where slug = 'west') where id = rider;
  -- No table access through the API.
  err := pg_temp.try_as(rider, 'select count(*) from public.conduct_records');
  assert err like 'permission denied%', 'no direct reads: ' || coalesce(err, 'allowed');

  -- A record past its day: never read, and the next action deletes it.
  insert into conduct_records (member_id, chapter_id, kind, summary, decided_on, notice_on, recorded_by)
  select rider, chapter_id, 'other', 'Old.', t - 400, t - 400, sec from members where id = rider returning id into old;
  assert jsonb_array_length(pg_temp.value_as(sec, 'select public.club_admin()->''conduct''')::jsonb) = 1, 'past its day, not read';
  assert pg_temp.try_as(sec, format('select public.hold_conduct(%L, %L, ''Grievance'')', old, t + 30)) = 'No such record.',
    'and can''t be held back once past its day';
  perform pg_temp.try_as(sec, format('select public.hold_conduct(%L, null, '''')', rec));
  assert not exists (select 1 from conduct_records where id = old), 'the purge deleted it';

  -- An open review keeps an old record; the purge leaves it; settling lets it go.
  insert into conduct_records (member_id, chapter_id, kind, summary, decided_on, notice_on, recorded_by)
  select rider, chapter_id, 'other', 'Under review.', t - 400, t - 400, sec from members where id = rider returning id into old;
  insert into conduct_appeals (record_id, lodged_on, lodged_by, grounds) values (old, t - 390, rider, 'Unfair.');
  perform private.purge_conduct();
  assert exists (select 1 from conduct_records where id = old), 'an open review keeps it';
  update conduct_appeals set withdrawn_on = t where record_id = old;
  perform private.purge_conduct();
  assert not exists (select 1 from conduct_records where id = old), 'withdrawn, it goes';

  -- A hold keeps it through the hold date.
  insert into conduct_records (member_id, chapter_id, kind, summary, decided_on, notice_on, recorded_by, hold_until, hold_reason)
  select rider, chapter_id, 'other', 'Held.', t - 400, t - 400, sec, t, 'Court' from members where id = rider returning id into old;
  perform private.purge_conduct();
  assert exists (select 1 from conduct_records where id = old), 'held through today';
  update conduct_records set hold_until = t - 1 where id = old;
  perform private.purge_conduct();
  assert not exists (select 1 from conduct_records where id = old), 'gone the day after the hold';

  -- A review, a panel, and set aside: the record goes straight away (6.9).
  assert pg_temp.try_as(rider, format('select public.lodge_conduct_appeal(%L, ''It was a rain cover.'')', rec)) is null, 'lodged';
  assert (select lodged_on from conduct_appeals where record_id = rec) = t, 'lodged today';
  assert pg_temp.try_as(chair, format('select public.set_conduct_hearing(%L, array[%L, %L, %L]::uuid[], %L)',
    rec, other, '00000000-0000-0000-0000-0000000005d6', '00000000-0000-0000-0000-0000000005d7', t)) is null, 'panel set';
  assert jsonb_array_length(pg_temp.value_as(other, 'select public.club_admin()->''conduct''')::jsonb) = 1, 'the panel sees it';
  assert pg_temp.try_as(other, format('select public.decide_conduct_appeal(%L, ''set_aside'', '''')', rec)) is null, 'set aside';
  assert not exists (select 1 from conduct_records where id = rec), 'set aside deletes the record';
  assert not exists (select 1 from conduct_appeals where record_id = rec), 'and its review';

  -- Confirmed keeps it, with the outcome.
  rec := pg_temp.value_as(sec, format('select public.record_conduct(%L, ''expulsion'', ''Expelled.'', ''RR 22'', %L, null, null)', rider, t))::uuid;
  assert (select notice_on from conduct_records where id = rec) = t, 'a formal outcome''s notice is its decision date';
  perform pg_temp.try_as(rider, format('select public.lodge_conduct_appeal(%L, ''Appeal.'')', rec));
  perform pg_temp.try_as(chair, format('select public.set_conduct_hearing(%L, array[%L, %L, %L]::uuid[], %L)',
    rec, other, '00000000-0000-0000-0000-0000000005d6', '00000000-0000-0000-0000-0000000005d7', t));
  assert pg_temp.try_as(other, format('select public.decide_conduct_appeal(%L, ''confirmed'', ''Upheld by secret ballot.'')', rec)) is null, 'upheld';
  assert (select outcome from conduct_appeals where record_id = rec) = 'confirmed', 'kept as confirmed';
  assert pg_temp.try_as(sec, format('select public.remove_conduct(%L)', rec)) is null, 'removed by the board';
  assert not exists (select 1 from conduct_records where id = rec), 'and gone';

  -- Lengths count code points, like the app.
  assert pg_temp.try_as(sec, format('select public.record_conduct(%L, ''vest'', %L, '''', %L, %L, null)', rider, repeat('🏍', 1000), t, t)) is null,
    '1000 emoji are 1000 characters';
end $$;
\o
\echo '  Conduct records delete themselves: the purge, holds, open reviews and set-aside'
\o /dev/null

-- Merch ----------------------------------------------------------------------------------------

do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000005d2';
  tre constant uuid := '00000000-0000-0000-0000-0000000005d3';
  rider constant uuid := '00000000-0000-0000-0000-0000000005d4';
  other constant uuid := '00000000-0000-0000-0000-0000000005d5';
  west constant uuid := (select id from chapters where slug = 'west');
  t constant date := private.club_date();
  item uuid; ord uuid; entry uuid; le ledger_entries;
begin
  item := pg_temp.value_as(sec, format('select public.propose_merch(%L, '' Tee '', '''', array['' S '', ''M'', ''L''], 3500, false)', west))::uuid;
  assert (select sizes from merch_items where id = item) = array['S', 'M', 'L'], 'sizes trimmed, in order';
  assert jsonb_array_length(pg_temp.value_as(rider, 'select public.club_admin()->''merch_items''')::jsonb) = 0, 'members don''t see proposals';
  assert pg_temp.try_as(sec, format('select public.decide_merch(%L, true, '''')', item)) = 'Someone other than whoever put it up approves it (15.1).', 'two people';
  assert pg_temp.try_as(tre, format('select public.decide_merch(%L, true, '''')', item)) is null, 'approved';
  assert jsonb_array_length(pg_temp.value_as(other, 'select public.club_admin()->''merch_items''')::jsonb) = 1, 'on sale for everyone';
  ord := pg_temp.value_as(rider, format('select public.order_merch(%L, ''L'', 2, '''')', item))::uuid;
  assert (select unit_cents from merch_orders where id = ord) = 3500, 'price fixed when ordered';
  assert jsonb_array_length(pg_temp.value_as(other, 'select public.club_admin()->''merch_orders''')::jsonb) = 0, 'others don''t see the order';
  assert pg_temp.try_as(sec, format('select public.decide_merch_order(%L, true, '''')', ord)) is null, 'order approved';
  entry := pg_temp.value_as(tre, format('select public.pay_merch_order(%L, %L)', ord, t))::uuid;
  select * into le from ledger_entries where id = entry;
  assert le.code = 'CR-005' and le.amount_cents = 7000 and le.state = 'paid' and le.entry_on = t and le.chapter_id = west,
    'a CR-005 line, banked today, in West''s fund';
  assert le.description = 'Merch: Tee (L) ×2 for Rusty', 'described like the demo: ' || le.description;
  assert (select ledger_entry_id from merch_orders where id = ord) = entry, 'the order points at it';
  assert pg_temp.try_as(sec, format('select public.hand_over_merch_order(%L)', ord)) is null, 'handed over';
  assert (select status from merch_orders where id = ord) = 'handed_over', 'and marked so';
end $$;
\o
\echo '  Merch: two-person design approval, orders, and the money in the books as CR-005'
\o /dev/null

-- National contributions -----------------------------------------------------------------------

do $$
declare
  chair constant uuid := '00000000-0000-0000-0000-0000000005d1';
  sec constant uuid := '00000000-0000-0000-0000-0000000005d2';
  nsec constant uuid := '00000000-0000-0000-0000-0000000005db';
  west constant uuid := (select id from chapters where slug = 'west');
  north constant uuid := (select id from chapters where slug = 'north');
  k uuid; sh jsonb; v uuid;
begin
  -- West 5 Voting Members, North 6: $100.01 splits 4546 / 5455 cents.
  k := pg_temp.value_as(chair, 'select public.propose_contribution(''National run'', ''Patches.'', 10001)')::uuid;
  select shares into sh from national_contributions where id = k;
  assert (select sum((e->>'cents')::int) from jsonb_array_elements(sh) e) = 10001, 'the shares add up to the cent';
  assert sh = jsonb_build_array(
    jsonb_build_object('chapter_id', north, 'voting_members', 6, 'cents', 5455),
    jsonb_build_object('chapter_id', west, 'voting_members', 5, 'cents', 4546)), 'by slug, remainders to the largest fractions: ' || sh::text;
  insert into votes (id, chapter_id, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result)
  values (gen_random_uuid(), west, 'Fund it?', 'chapter_board', 'majority', 1, now() + interval '1 second', now() + interval '2 seconds', now() + interval '2 seconds', 'carried')
  returning id into v;
  assert pg_temp.try_as(sec, format('select public.decide_contribution(%L, %L, %L)', k, west, v)) is null, 'West says yes';
  assert (select status from national_contributions where id = k) = 'proposed', 'one of two isn''t a majority';
  insert into votes (id, chapter_id, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result)
  values (gen_random_uuid(), north, 'Fund it?', 'chapter_board', 'majority', 1, now() + interval '1 second', now() + interval '2 seconds', now() + interval '2 seconds', 'lost')
  returning id into v;
  assert pg_temp.try_as(nsec, format('select public.decide_contribution(%L, %L, %L)', k, north, v)) is null, 'North says no';
  assert (select status from national_contributions where id = k) = 'not_approved', 'one each can''t make a majority of two';
end $$;
\o
\echo '  National contributions: shares to the cent by Voting Members, settled by a majority of chapters'
\o /dev/null

-- New chapters ---------------------------------------------------------------------------------

do $$
declare
  chair constant uuid := '00000000-0000-0000-0000-0000000005d1';
  f uuid[] := array['00000000-0000-0000-0000-0000000005d6', '00000000-0000-0000-0000-0000000005d7', '00000000-0000-0000-0000-0000000005d8',
                    '00000000-0000-0000-0000-0000000005d9', '00000000-0000-0000-0000-0000000005da']::uuid[];
  p uuid; v uuid; ch uuid;
begin
  p := pg_temp.value_as(f[1], format('select public.propose_chapter(''Surf Coast'', ''Geelong'', ''VIC'', ''a'', ''b'', ''c'', ''d'', ''e'', %L, %L, %L)',
    f, f[1], f[2]))::uuid;
  assert (select plan from chapter_proposals where id = p) = '{"location":"a","membership":"b","leadership":"c","budget":"d","operations":"e"}'::jsonb, 'the plan';
  insert into votes (id, chapter_id, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result)
  values (gen_random_uuid(), null, 'Surf Coast?', 'nec', 'majority', 1, now() + interval '1 second', now() + interval '2 seconds', now() + interval '2 seconds', 'carried')
  returning id into v;
  ch := pg_temp.value_as(chair, format('select public.settle_chapter_proposal(%L, %L)', p, v))::uuid;
  assert (select slug from chapters where id = ch) = 'surf-coast', 'the chapter is made';
  assert (select count(*) from members where chapter_id = ch) = 5, 'the founders moved to it';
  assert exists (select 1 from positions where chapter_id = ch and member_id = f[1] and role = 'president' and ended_on is null), 'President seated';
  assert exists (select 1 from positions where chapter_id = ch and member_id = f[2] and role = 'sergeant_at_arms'), 'SAA seated';
  assert exists (select 1 from conversations where kind = 'chapter' and chapter_id = ch), 'its chats made themselves';
  assert (select status from chapter_proposals where id = p) = 'approved' and (select chapter_id from chapter_proposals where id = p) = ch, 'marked approved';
  -- One vote stands for one decision.
  p := pg_temp.value_as(f[1], format('select public.propose_chapter(''Torquay'', ''Torquay'', ''VIC'', ''a'', ''b'', ''c'', ''d'', ''e'', %L, %L, %L)',
    f, f[1], f[2]))::uuid;
  assert pg_temp.try_as(chair, format('select public.settle_chapter_proposal(%L, %L)', p, v)) = 'Pick the NEC’s closed vote on it (12.1).',
    'a vote already used can''t settle another proposal';
end $$;
\o
\echo '  New chapters: an NEC vote makes the chapter, moves the founders and seats the President and SAA'
\echo 'All Stage 5D checks passed'
