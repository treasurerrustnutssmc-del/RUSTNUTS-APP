-- Meetings, minutes, action items and votes (Stage 5, part A).
-- See docs/superpowers/specs/2026-10-24-stage-5-meetings-and-votes-design.md.
-- Nobody reaches these tables directly: club_business() reads, and each action below checks the
-- rules in src/domain/meetings.ts and src/domain/votes.ts, refusing with the same words.
-- A meeting or vote belongs to one chapter (run by its board) or to the whole club (chapter_id
-- null, run by the NEC).

create type public.meeting_kind as enum ('board', 'general', 'agm', 'special', 'nec');
create type public.electorate as enum ('chapter_board', 'chapter_patched', 'club_patched', 'nec');
create type public.vote_threshold as enum ('majority', 'two_thirds', 'unanimous');
create type public.ballot_choice as enum ('yes', 'no', 'abstain');
create type public.vote_result as enum ('carried', 'lost', 'no_quorum');

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id),
  kind public.meeting_kind not null,
  title text not null,
  starts_at timestamptz not null,
  location text,
  agenda jsonb not null default '[]'::jsonb, -- [{title, notes}], in order
  minutes text,
  minutes_approved_at timestamptz,
  minutes_approved_by uuid references public.members (id),
  cancelled_at timestamptz,
  created_by uuid references public.members (id),
  created_at timestamptz not null default now()
);
create index meetings_starts_at on public.meetings (starts_at);

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings (id),
  chapter_id uuid references public.chapters (id),
  title text not null,
  owner_id uuid not null references public.members (id),
  due_on date,
  done_on date,
  created_by uuid references public.members (id),
  created_at timestamptz not null default now()
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id),
  meeting_id uuid references public.meetings (id),
  subject_member_id uuid references public.members (id),
  question text not null,
  details text,
  electorate public.electorate not null,
  threshold public.vote_threshold not null,
  secret boolean not null default false,
  quorum int not null check (quorum >= 1),
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  result public.vote_result,
  casting_vote text check (casting_vote in ('yes', 'no')),
  yes_count int,
  no_count int,
  abstain_count int,
  created_by uuid references public.members (id)
);

-- Who could vote, fixed when the vote opened, and whether they have. Never how.
create table public.vote_electors (
  vote_id uuid not null references public.votes (id),
  member_id uuid not null references public.members (id),
  voted_at timestamptz,
  primary key (vote_id, member_id)
);

-- The ballots. On a secret vote member_id is null, and there is deliberately no timestamp, so a
-- ballot can't be matched to vote_electors.voted_at.
create table public.vote_ballots (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes (id),
  member_id uuid references public.members (id),
  -- Null once a patch vote closes: only its result is kept (constitution 4.9).
  choice public.ballot_choice
);

alter table public.meetings enable row level security;
alter table public.action_items enable row level security;
alter table public.votes enable row level security;
alter table public.vote_electors enable row level security;
alter table public.vote_ballots enable row level security;
revoke all on public.meetings, public.action_items, public.votes, public.vote_electors, public.vote_ballots
  from public, anon, authenticated;

-- Helpers ----------------------------------------------------------------------------------------

-- Session and approval: the first two checks of every action. Returns the caller's id.
create or replace function private.require_member()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  return auth.uid();
end;
$$;

-- Runs a chapter (its board, or anyone on the NEC) or the whole club (the NEC).
create or replace function private.runs_scope(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_chapter is null then private.is_national() else private.is_board_of(p_chapter) end;
$$;

create or replace function private.require_scope(p_chapter uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.runs_scope(p_chapter) then
    if p_chapter is null then raise exception 'Only the NEC can do that.'; end if;
    raise exception 'Only that chapter’s board can do that.';
  end if;
end;
$$;

-- Whoever has the casting vote: the chapter's President, or the National Chairman (inferred).
create or replace function private.chair_of(p_chapter uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  -- The chapter President, then the Vice President (constitution 10.9); the National Chairperson
  -- for the whole club (11.2).
  select member_id from public.positions
  where ended_on is null and chapter_id is not distinct from p_chapter
    and role in (case when p_chapter is null then 'nec_chair' else 'president' end::public.position_role,
                 case when p_chapter is null then 'nec_chair' else 'vice_president' end::public.position_role)
  order by role = 'vice_president', started_on desc limit 1;
$$;

-- Who casts a chapter's NEC vote: its President, unless they chair the NEC; then its Vice President
-- (constitution 11.2). The newest holder of a seat acts during a handover (9.8).
create or replace function private.nec_voter_for(p_chapter uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select member_id from public.positions p
  where p.ended_on is null and p.chapter_id = p_chapter and p.role in ('president', 'vice_president')
    and not (p.role = 'president' and p.member_id in (
      select member_id from public.positions where ended_on is null and role = 'nec_chair'))
  order by p.role = 'vice_president', p.started_on desc limit 1;
$$;

-- The least quorum a vote may have, as defaultQuorum() in src/domain/votes.ts: a third of the voters
-- for chapter and national votes (10.6), 51% for the NEC (11.5), more than half a board (inferred).
create or replace function private.min_quorum(p_electorate public.electorate, p_electors int)
returns int language sql immutable set search_path = '' as $$
  select case p_electorate
    when 'chapter_board' then p_electors / 2 + 1
    when 'nec' then greatest(1, ceil(p_electors * 51 / 100.0)::int)
    else greatest(1, ceil(p_electors / 3.0)::int)
  end;
$$;

-- Everyone who gets a ballot. Legacy members and anyone not approved never vote. Nomads vote on
-- national matters only (10.7); the NEC has one vote per chapter, cast by its President (11.2).
create or replace function private.electors_for(p_electorate public.electorate, p_chapter uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.approval = 'approved' and m.status <> 'legacy' and case p_electorate
    when 'chapter_board' then exists (
      select 1 from public.positions p
      where p.member_id = m.id and p.ended_on is null and p.chapter_id = p_chapter
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))
    when 'chapter_patched' then m.chapter_id = p_chapter and m.status = 'full'
    when 'club_patched' then m.status in ('full', 'nomad')
    when 'nec' then m.id in (select private.nec_voter_for(c.id) from public.chapters c)
  end
  order by m.id;
$$;

-- The result of a count, as decide() in src/domain/votes.ts. Abstentions count to the quorum but
-- not for or against (10.7); unanimous means every elector votes yes (4.9); only a majority vote
-- can tie, and the casting vote settles it.
create or replace function private.decide(
  p_threshold public.vote_threshold, p_quorum int, p_yes int, p_no int, p_abstain int, p_casting text,
  p_electors int, out result public.vote_result, out tied boolean)
language plpgsql immutable set search_path = '' as $$
declare carried boolean;
begin
  if p_yes + p_no + p_abstain < p_quorum then
    result := 'no_quorum'; tied := false; return;
  end if;
  tied := p_threshold = 'majority' and p_yes = p_no and p_yes > 0;
  if tied then carried := p_casting = 'yes';
  elsif p_threshold = 'majority' then carried := p_yes > p_no;
  elsif p_threshold = 'two_thirds' then carried := p_yes > 0 and 3 * p_yes >= 2 * (p_yes + p_no);
  else carried := p_yes > 0 and p_yes = p_electors;
  end if;
  result := case when coalesce(carried, false) then 'carried' else 'lost' end;
end;
$$;

revoke all on function private.require_member(), private.runs_scope(uuid), private.require_scope(uuid),
  private.chair_of(uuid), private.electors_for(public.electorate, uuid), private.nec_voter_for(uuid),
  private.min_quorum(public.electorate, int),
  private.decide(public.vote_threshold, int, int, int, int, text, int) from public, anon, authenticated;

-- Meetings -----------------------------------------------------------------------------------

create or replace function public.save_meeting(
  p_id uuid, p_chapter uuid, p_kind public.meeting_kind, p_title text, p_starts_at timestamptz,
  p_location text, p_agenda jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  existing public.meetings%rowtype;
  v_agenda jsonb := coalesce(p_agenda, '[]'::jsonb);
  saved uuid;
begin
  if p_id is not null then
    select * into existing from public.meetings where id = p_id for update;
    if not found then raise exception 'No such meeting.'; end if;
    perform private.require_scope(existing.chapter_id);
  end if;
  perform private.require_scope(p_chapter);
  if existing.cancelled_at is not null then raise exception 'That meeting was cancelled.'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'Give the meeting a title.'; end if;
  if p_starts_at is null then raise exception 'Pick a date and time.'; end if;
  if (p_chapter is null and p_kind = 'board') or (p_chapter is not null and p_kind = 'nec') then
    raise exception 'That kind of meeting doesn’t fit here.';
  end if;
  if jsonb_typeof(v_agenda) <> 'array' or exists (
    select 1 from jsonb_array_elements(v_agenda) a where nullif(trim(a->>'title'), '') is null) then
    raise exception 'Each agenda item needs a title.';
  end if;
  v_agenda := coalesce((
    select jsonb_agg(jsonb_build_object('title', trim(a->>'title'), 'notes', nullif(trim(a->>'notes'), '')) order by pos)
    from jsonb_array_elements(v_agenda) with ordinality as x(a, pos)), '[]'::jsonb);

  if p_id is null then
    insert into public.meetings (chapter_id, kind, title, starts_at, location, agenda, created_by)
    values (p_chapter, p_kind, trim(p_title), p_starts_at, nullif(trim(p_location), ''), v_agenda, me)
    returning id into saved;
  else
    update public.meetings set chapter_id = p_chapter, kind = p_kind, title = trim(p_title), starts_at = p_starts_at,
      location = nullif(trim(p_location), ''), agenda = v_agenda
    where id = p_id returning id into saved;
  end if;
  return saved;
end;
$$;

-- The checks shared by every action on an existing meeting.
create or replace function private.meeting_for_action(p_id uuid)
returns public.meetings language plpgsql security definer set search_path = '' as $$
declare found_meeting public.meetings%rowtype;
begin
  perform private.require_member();
  select * into found_meeting from public.meetings where id = p_id for update;
  if not found then raise exception 'No such meeting.'; end if;
  perform private.require_scope(found_meeting.chapter_id);
  if found_meeting.cancelled_at is not null then raise exception 'That meeting was cancelled.'; end if;
  return found_meeting;
end;
$$;
revoke all on function private.meeting_for_action(uuid) from public, anon, authenticated;

create or replace function public.cancel_meeting(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.starts_at <= now() then raise exception 'That meeting has already started.'; end if;
  update public.meetings set cancelled_at = now() where id = p_id;
end;
$$;

create or replace function public.save_minutes(p_id uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.minutes_approved_at is not null then raise exception 'Those minutes are approved and locked.'; end if;
  update public.meetings set minutes = nullif(trim(p_text), '') where id = p_id;
end;
$$;

create or replace function public.approve_minutes(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.minutes_approved_at is not null then raise exception 'Those minutes are approved and locked.'; end if;
  if m.starts_at > now() then raise exception 'The meeting hasn’t happened yet.'; end if;
  if nullif(trim(m.minutes), '') is null then raise exception 'Write the minutes first.'; end if;
  update public.meetings set minutes_approved_at = now(), minutes_approved_by = auth.uid() where id = p_id;
end;
$$;

-- Action items -------------------------------------------------------------------------------

create or replace function public.save_action_item(
  p_id uuid, p_chapter uuid, p_meeting uuid, p_title text, p_owner uuid, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  existing public.action_items%rowtype;
  scope uuid := p_chapter;
  owner public.members%rowtype;
  saved uuid;
begin
  if p_id is not null then
    select * into existing from public.action_items where id = p_id for update;
    if not found then raise exception 'No such action item.'; end if;
    scope := existing.chapter_id;
  end if;
  perform private.require_scope(scope);
  if p_id is null and p_meeting is not null and not exists (
    select 1 from public.meetings where id = p_meeting and chapter_id is not distinct from p_chapter) then
    raise exception 'No such meeting.';
  end if;
  if nullif(trim(p_title), '') is null then raise exception 'Give the action item a title.'; end if;
  select * into owner from public.members where id = p_owner;
  if not found or owner.approval <> 'approved' or owner.status = 'legacy'
     or (scope is not null and owner.chapter_id <> scope) then
    raise exception 'Pick an approved member of this chapter.';
  end if;

  if p_id is null then
    insert into public.action_items (meeting_id, chapter_id, title, owner_id, due_on, created_by)
    values (p_meeting, p_chapter, trim(p_title), p_owner, p_due, me)
    returning id into saved;
  else
    update public.action_items set title = trim(p_title), owner_id = p_owner, due_on = p_due
    where id = p_id returning id into saved;
  end if;
  return saved;
end;
$$;

create or replace function public.set_action_done(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  item public.action_items%rowtype;
begin
  select * into item from public.action_items where id = p_id for update;
  if not found then raise exception 'No such action item.'; end if;
  if item.owner_id <> me and not private.runs_scope(item.chapter_id) then
    raise exception 'Only the owner or the board can tick this off.';
  end if;
  update public.action_items set done_on = case when p_done then private.club_date() end where id = p_id;
end;
$$;

-- Votes --------------------------------------------------------------------------------------

create or replace function public.open_vote(
  p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text,
  p_electorate public.electorate, p_threshold public.vote_threshold, p_secret boolean, p_quorum int,
  p_closes_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  electors int;
  subject public.members%rowtype;
  opened uuid;
begin
  perform private.require_scope(p_chapter);
  if nullif(trim(p_question), '') is null then raise exception 'Ask a question.'; end if;
  if (p_chapter is null) <> (p_electorate in ('club_patched', 'nec')) then
    raise exception 'That electorate doesn’t fit here.';
  end if;
  select count(*) into electors from private.electors_for(p_electorate, p_chapter);
  if electors = 0 then raise exception 'Nobody can vote in that electorate yet.'; end if;
  if p_quorum is null or p_quorum < private.min_quorum(p_electorate, electors) or p_quorum > electors then
    raise exception 'Quorum must be between % and %.', private.min_quorum(p_electorate, electors), electors;
  end if;
  if p_closes_at is null or p_closes_at <= now() then raise exception 'Pick a closing time in the future.'; end if;
  if p_closes_at > now() + interval '1440 hours' then raise exception 'Votes can stay open for 60 days at most.'; end if;
  if p_subject is not null then
    select * into subject from public.members where id = p_subject;
    if not found or p_chapter is null or subject.chapter_id <> p_chapter or subject.approval <> 'approved'
       or subject.status <> 'fng' then
      raise exception 'A patch vote is for an approved FNG of that chapter.';
    end if;
    if p_electorate <> 'chapter_patched' or p_threshold <> 'unanimous' or not coalesce(p_secret, false) then
      raise exception 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.';
    end if;
    -- Full Membership can't be granted before nine months (4.7).
    if subject.fng_started_on is not null and subject.fng_started_on + interval '9 months' > private.club_date() then
      raise exception 'A patch vote can open only nine months into the FNG’s trial (4.7).';
    end if;
  end if;
  if p_meeting is not null and not exists (
    select 1 from public.meetings where id = p_meeting and chapter_id is not distinct from p_chapter) then
    raise exception 'No such meeting.';
  end if;

  insert into public.votes (chapter_id, meeting_id, subject_member_id, question, details, electorate, threshold,
                            secret, quorum, closes_at, created_by)
  values (p_chapter, p_meeting, p_subject, trim(p_question), nullif(trim(p_details), ''), p_electorate, p_threshold,
          coalesce(p_secret, false), p_quorum, p_closes_at, me)
  returning id into opened;
  insert into public.vote_electors (vote_id, member_id)
  select opened, e from private.electors_for(p_electorate, p_chapter) e;
  return opened;
end;
$$;

create or replace function public.cast_ballot(p_vote uuid, p_choice public.ballot_choice)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  v public.votes%rowtype;
  elector public.vote_electors%rowtype;
begin
  -- Shares the lock close_vote takes, so a ballot can't land after the count.
  select * into v from public.votes where id = p_vote for share;
  if not found then raise exception 'No such vote.'; end if;
  select * into elector from public.vote_electors where vote_id = p_vote and member_id = me for update;
  if not found then raise exception 'You’re not on this vote.'; end if;
  if elector.voted_at is not null then raise exception 'You’ve already voted.'; end if;
  if v.closed_at is not null or v.closes_at <= now() then raise exception 'That vote has closed.'; end if;
  if p_choice is null then raise exception 'Pick an answer.'; end if;

  update public.vote_electors set voted_at = now() where vote_id = p_vote and member_id = me;
  insert into public.vote_ballots (vote_id, member_id, choice)
  values (p_vote, case when v.secret then null else me end, p_choice);
end;
$$;

create or replace function public.close_vote(p_vote uuid, p_casting text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  v public.votes%rowtype;
  n_yes int; n_no int; n_abstain int; n_electors int;
  outcome record;
  chair uuid;
begin
  select * into v from public.votes where id = p_vote for update;
  if not found then raise exception 'No such vote.'; end if;
  perform private.require_scope(v.chapter_id);
  if v.closed_at is not null then raise exception 'That vote has already closed.'; end if;
  if now() < v.closes_at and exists (select 1 from public.vote_electors where vote_id = p_vote and voted_at is null) then
    raise exception 'Wait until it closes, or until everyone has voted.';
  end if;
  select count(*) filter (where choice = 'yes'), count(*) filter (where choice = 'no'), count(*) filter (where choice = 'abstain')
  into n_yes, n_no, n_abstain from public.vote_ballots where vote_id = p_vote;
  select count(*) into n_electors from public.vote_electors where vote_id = p_vote;
  outcome := private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, null, n_electors);
  chair := private.chair_of(v.chapter_id);
  if outcome.tied and chair is not null and (p_casting is null or me <> chair) then
    raise exception 'It’s a tie. The chair closes it with the casting vote.';
  end if;
  if not outcome.tied and p_casting is not null then raise exception 'There’s no tie, so no casting vote.'; end if;
  if p_casting is not null and chair is null then
    raise exception 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';
  end if;
  if p_casting is not null and p_casting not in ('yes', 'no') then raise exception 'Pick an answer.'; end if;
  outcome := private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, p_casting, n_electors);

  -- A patch vote keeps only its result (4.9): no counts, and its ballots are blanked.
  if v.subject_member_id is not null then
    update public.vote_ballots set choice = null where vote_id = p_vote;
    n_yes := null; n_no := null; n_abstain := null;
  end if;
  update public.votes set closed_at = now(), result = outcome.result, casting_vote = p_casting,
    yes_count = n_yes, no_count = n_no, abstain_count = n_abstain
  where id = p_vote;
end;
$$;

-- Reading --------------------------------------------------------------------------------------

-- Everything the Business screen shows this person, in one piece: meetings they can see (draft
-- minutes only to whoever runs them), their action items (or all of a scope they run), and the
-- votes they're on or run, with counts and open ballots only once closed and secret ballots never.
create or replace function public.club_business()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not private.is_approved_member() then
    return jsonb_build_object('meetings', '[]'::jsonb, 'action_items', '[]'::jsonb, 'votes', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'chapter_id', m.chapter_id, 'kind', m.kind, 'title', m.title, 'starts_at', m.starts_at,
        'location', m.location, 'agenda', m.agenda,
        'minutes', case when m.minutes_approved_at is not null or private.runs_scope(m.chapter_id) then m.minutes end,
        'minutes_approved_at', m.minutes_approved_at, 'minutes_approved_by', m.minutes_approved_by,
        'cancelled_at', m.cancelled_at, 'created_by', m.created_by) order by m.starts_at, m.id)
      from public.meetings m
      where m.kind not in ('board', 'nec') or private.runs_scope(m.chapter_id)), '[]'::jsonb),
    'action_items', coalesce((
      select jsonb_agg(to_jsonb(a) - 'created_at' - 'created_by' order by a.due_on nulls last, a.created_at)
      from public.action_items a
      where a.owner_id = me or private.runs_scope(a.chapter_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'chapter_id', v.chapter_id, 'meeting_id', v.meeting_id, 'subject_member_id', v.subject_member_id,
        'question', v.question, 'details', v.details, 'electorate', v.electorate, 'threshold', v.threshold,
        'secret', v.secret, 'quorum', v.quorum, 'opened_at', v.opened_at, 'closes_at', v.closes_at,
        'closed_at', v.closed_at, 'result', v.result, 'casting_vote', v.casting_vote, 'created_by', v.created_by,
        'tally', case when v.closed_at is not null and v.yes_count is not null
                      then jsonb_build_object('yes', v.yes_count, 'no', v.no_count, 'abstain', v.abstain_count) end,
        'elector_ids', (select coalesce(jsonb_agg(e.member_id order by e.member_id), '[]'::jsonb)
                        from public.vote_electors e where e.vote_id = v.id),
        'voted_ids', (select coalesce(jsonb_agg(e.member_id order by e.member_id), '[]'::jsonb)
                      from public.vote_electors e where e.vote_id = v.id and e.voted_at is not null),
        'my_voted', exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me and e.voted_at is not null),
        'ballots', case when v.closed_at is not null and not v.secret then (
                     select coalesce(jsonb_agg(jsonb_build_object('member_id', b.member_id, 'choice', b.choice)
                                               order by b.member_id), '[]'::jsonb)
                     from public.vote_ballots b where b.vote_id = v.id)
                   else '[]'::jsonb end
        ) order by v.opened_at desc, v.id)
      from public.votes v
      where private.runs_scope(v.chapter_id)
         or exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me)), '[]'::jsonb)
  );
end;
$$;

revoke all on function
  public.save_meeting(uuid, uuid, public.meeting_kind, text, timestamptz, text, jsonb),
  public.cancel_meeting(uuid), public.save_minutes(uuid, text), public.approve_minutes(uuid),
  public.save_action_item(uuid, uuid, uuid, text, uuid, date), public.set_action_done(uuid, boolean),
  public.open_vote(uuid, uuid, uuid, text, text, public.electorate, public.vote_threshold, boolean, int, timestamptz),
  public.cast_ballot(uuid, public.ballot_choice), public.close_vote(uuid, text), public.club_business()
  from public, anon;
grant execute on function
  public.save_meeting(uuid, uuid, public.meeting_kind, text, timestamptz, text, jsonb),
  public.cancel_meeting(uuid), public.save_minutes(uuid, text), public.approve_minutes(uuid),
  public.save_action_item(uuid, uuid, uuid, text, uuid, date), public.set_action_done(uuid, boolean),
  public.open_vote(uuid, uuid, uuid, text, text, public.electorate, public.vote_threshold, boolean, int, timestamptz),
  public.cast_ballot(uuid, public.ballot_choice), public.close_vote(uuid, text), public.club_business()
  to authenticated;
