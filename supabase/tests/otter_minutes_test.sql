-- Checks Draft from Otter's database side: who may draft a meeting's minutes, each refusal, the
-- 5-draft cap, the month's budget, and the people and board it hands back. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'sec@example.com'),     -- West Secretary
  ('00000000-0000-0000-0000-0000000000b2', 'rider@example.com'),   -- West Full member
  ('00000000-0000-0000-0000-0000000000b3', 'fam@example.com'),     -- West Family
  ('00000000-0000-0000-0000-0000000000b4', 'newbie@example.com'),  -- West applicant, introduced
  ('00000000-0000-0000-0000-0000000000b5', 'northie@example.com'), -- North applicant, introduced
  ('00000000-0000-0000-0000-0000000000b6', 'nsec@example.com'),    -- North Secretary
  ('00000000-0000-0000-0000-0000000000b7', 'chair@example.com');   -- National Chair

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.full_name, v.road_name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000b1', 'west', 'Sally Secretary', 'Pen', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'west', 'Rob Rider', 'Torque', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'west', 'Fay Family', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000b4', 'west', 'Ned Newbie', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000b5', 'north', 'Nora North', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000b6', 'north', 'Norm Secretary', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b7', 'north', 'Cheryl Chair', 'El Jefe', 'full', 'approved')
) as v(id, slug, full_name, road_name, status, approval)
join chapters c on c.slug = v.slug;
insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000000b1', id, 'secretary', '2026-08-01' from chapters where slug = 'west';
insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000000b6', id, 'secretary', '2026-08-01' from chapters where slug = 'north';
insert into positions (member_id, chapter_id, role, started_on) values ('00000000-0000-0000-0000-0000000000b7', null, 'nec_chair', '2026-08-01');

-- A West meeting last night, one tomorrow, a cancelled one, a confirmed one and a whole-club one.
insert into meetings (id, chapter_id, kind, title, starts_at, location, agenda, minutes, minutes_approved_at, cancelled_at)
select v.id::uuid, (select id from chapters where slug = 'west'), 'general', v.title, v.starts_at, 'Clubrooms',
       '[{"title": "Banner", "notes": null}]'::jsonb, v.minutes, v.approved, v.cancelled
from (values
  ('00000000-0000-0000-0000-0000000000e1', 'October meeting', now() - interval '1 day', null, null::timestamptz, null::timestamptz),
  ('00000000-0000-0000-0000-0000000000e2', 'Next meeting', now() + interval '1 day', null, null, null),
  ('00000000-0000-0000-0000-0000000000e3', 'Called off', now() - interval '1 day', null, null, now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000e4', 'Done and dusted', now() - interval '20 days', 'All good.', now() - interval '1 day', null)
) as v(id, title, starts_at, minutes, approved, cancelled);
insert into meetings (id, chapter_id, kind, title, starts_at) values
  ('00000000-0000-0000-0000-0000000000e5', null, 'nec', 'NEC meeting', now() - interval '1 day');

create function pg_temp.as_member(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.start_error(p uuid, p_meeting uuid) returns text language plpgsql as $$
begin
  perform pg_temp.as_member(p);
  set local role authenticated;
  perform public.minutes_draft_start(p_meeting);
  reset role;
  return null;
exception when raise_exception then
  reset role;
  return sqlerrm;
end $$;

\o
\echo 'Only whoever runs the meeting can draft it'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1') = 'Only that chapter’s board can do that.', 'a member';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000e1') = 'Only that chapter’s board can do that.', 'the other chapter';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e5') = 'Only the NEC can do that.', 'a whole-club meeting';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ff') = 'No such meeting.';
end $$;

\echo 'Not a cancelled meeting, a confirmed one, or one still to come'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3') = 'That meeting was cancelled.';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e4') = 'Those minutes are approved and locked.';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2') = 'The meeting hasn’t happened yet.';
end $$;

\echo 'Switched off until Ask the club is on'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1') = 'Ask the club isn’t switched on yet.';
  assert not exists (select 1 from private.minutes_drafts), 'a refused draft isn’t counted';
end $$;
insert into private.app_settings (key, value) values ('assistant_on', 'true');

\echo 'The secretary gets the meeting, the people and the board, and the draft is counted'
select pg_temp.as_member('00000000-0000-0000-0000-0000000000b1') \g /dev/null
set role authenticated;
do $$
declare
  got jsonb := public.minutes_draft_start('00000000-0000-0000-0000-0000000000e1');
  names text[];
begin
  assert got #>> '{meeting,title}' = 'October meeting', got::text;
  assert got #>> '{meeting,chapter}' = 'West', got::text;
  assert got #>> '{meeting,agenda,0,title}' = 'Banner', got::text;
  assert got #>> '{meeting,location}' = 'Clubrooms', got::text;
  select array_agg(p ->> 'name' order by p ->> 'name') into names from jsonb_array_elements(got -> 'people') p;
  assert names = array['Cheryl Chair', 'Ned Newbie', 'Norm Secretary', 'Rob Rider', 'Sally Secretary'], names::text;
  assert exists (select 1 from jsonb_array_elements(got -> 'people') p where p ->> 'roadName' = 'Torque' and p ->> 'chapter' = 'West'), got::text;
  assert got -> 'board' = '[{"name": "Sally Secretary", "role": "secretary"}]'::jsonb, (got -> 'board')::text;
end $$;
reset role;
do $$
begin
  assert (select drafts from private.minutes_drafts where meeting_id = '00000000-0000-0000-0000-0000000000e1') = 1;
  assert (select questions from private.assistant_months where month = date_trunc('month', private.club_date())::date) = 1;
end $$;

\echo 'A whole-club meeting: the NEC drafts it, members only, the national board'
select pg_temp.as_member('00000000-0000-0000-0000-0000000000b7') \g /dev/null
set role authenticated;
do $$
declare got jsonb := public.minutes_draft_start('00000000-0000-0000-0000-0000000000e5');
begin
  assert got #>> '{meeting,chapter}' is null, got::text;
  assert not exists (select 1 from jsonb_array_elements(got -> 'people') p where p ->> 'name' in ('Ned Newbie', 'Nora North', 'Fay Family')), got::text;
  assert got -> 'board' = '[{"name": "Cheryl Chair", "role": "nec_chair"}]'::jsonb, (got -> 'board')::text;
end $$;
reset role;

\echo 'Five drafts a meeting, then it’s finished by hand'
do $$
begin
  update private.minutes_drafts set drafts = 5 where meeting_id = '00000000-0000-0000-0000-0000000000e1';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1') = 'This meeting has been drafted 5 times. Finish it by hand.';
end $$;

\echo 'Each draft is one of the member’s Ask the club questions for the day'
do $$
begin
  assert (select questions from private.assistant_days where member_id = '00000000-0000-0000-0000-0000000000b1' and day = private.club_date()) = 1;
  update private.assistant_days set questions = 15 where member_id = '00000000-0000-0000-0000-0000000000b7';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000e5') = 'You’ve asked 15 today. More tomorrow.';
  assert (select drafts from private.minutes_drafts where meeting_id = '00000000-0000-0000-0000-0000000000e5') = 1, 'a refused draft rolls its count back';
  update private.assistant_days set questions = 0 where member_id = '00000000-0000-0000-0000-0000000000b7';
end $$;

\echo 'Not once the month’s budget is used'
do $$
begin
  update private.assistant_months set spent_microusd = 20000000 where month = date_trunc('month', private.club_date())::date;
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000e5')
    like 'Ask the club is resting until %: this month’s budget is used.';
end $$;

\echo 'Members and the public can’t call it at all'
do $$
begin
  assert not has_function_privilege('anon', 'public.minutes_draft_start(uuid)', 'execute');
  assert has_function_privilege('authenticated', 'public.minutes_draft_start(uuid)', 'execute');
  assert not has_table_privilege('authenticated', 'private.minutes_drafts', 'select');
end $$;
