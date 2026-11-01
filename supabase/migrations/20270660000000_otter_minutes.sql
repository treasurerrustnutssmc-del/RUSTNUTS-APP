-- Draft from Otter: whoever runs a meeting turns its Otter transcript into draft minutes with the
-- club's AI. The ask-club Edge Function calls minutes_draft_start() as the member before drafting
-- and assistant_spent() with the service role after, so drafts come out of the Ask the club month.
-- Nothing about the transcript or the draft is kept here: only how many times each meeting has been
-- drafted (at most 5), so nobody can run the bill up.
-- Spec: docs/superpowers/specs/2026-11-01-otter-minutes-design.md

create table if not exists private.minutes_drafts (
  meeting_id uuid primary key references public.meetings (id) on delete cascade,
  drafts int not null default 0 check (drafts >= 0)
);
revoke all on private.minutes_drafts from public, anon, authenticated;
alter table private.minutes_drafts enable row level security;

-- Before each draft, as the member: refuses with the words the app shows, counts the draft, and
-- hands back the meeting, the people who could have been there and the scope's seated positions.
create or replace function public.minutes_draft_start(p_meeting uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  this_month constant date := date_trunc('month', private.club_date())::date;
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  max_drafts constant int := 5;
  m public.meetings%rowtype;
  done int;
  spent bigint;
  meeting jsonb;
  people jsonb;
  board jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  select * into m from public.meetings where id = p_meeting;
  if not found then
    raise exception 'No such meeting.';
  end if;
  perform private.require_scope(m.chapter_id);
  if m.cancelled_at is not null then
    raise exception 'That meeting was cancelled.';
  end if;
  if m.minutes_approved_at is not null then
    raise exception 'Those minutes are approved and locked.';
  end if;
  if m.starts_at > now() then
    raise exception 'The meeting hasn’t happened yet.';
  end if;
  if not private.assistant_on() then
    raise exception 'Ask the club isn’t switched on yet.';
  end if;

  select drafts into done from private.minutes_drafts where meeting_id = p_meeting for update;
  if coalesce(done, 0) >= max_drafts then
    raise exception 'This meeting has been drafted % times. Finish it by hand.', max_drafts;
  end if;
  select spent_microusd into spent from private.assistant_months where month = this_month for update;
  if coalesce(spent, 0) >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(private.club_date()), 'DD/MM/YYYY');
  end if;

  insert into private.minutes_drafts as d (meeting_id, drafts) values (p_meeting, 1)
  on conflict (meeting_id) do update set drafts = d.drafts + 1;
  insert into private.assistant_months as mo (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = mo.questions + 1;

  select jsonb_build_object(
    'id', m.id, 'title', m.title, 'kind', m.kind, 'startsAt', m.starts_at, 'location', m.location,
    'chapter', (select c.name from public.chapters c where c.id = m.chapter_id),
    'agenda', coalesce(m.agenda, '[]'::jsonb))
  into meeting;

  -- Approved members other than Family (visitors from the other chapter count), and for a chapter
  -- meeting its applicants in their introduction phase. Mirrors minutesPeople in src/domain/otterMinutes.ts.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'name', x.full_name, 'roadName', x.road_name, 'chapter', c.name, 'status', x.status)
    order by x.full_name), '[]'::jsonb)
  into people
  from public.members x left join public.chapters c on c.id = x.chapter_id
  where (x.approval = 'approved' and x.status <> 'family')
     or (m.chapter_id is not null and x.approval = 'pending' and x.status = 'introduced' and x.chapter_id = m.chapter_id);

  select coalesce(jsonb_agg(jsonb_build_object('role', p.role, 'name', x.full_name) order by p.role), '[]'::jsonb)
  into board
  from public.positions p join public.members x on x.id = p.member_id
  where p.ended_on is null and p.started_on <= private.club_date()
    and p.chapter_id is not distinct from m.chapter_id;

  return jsonb_build_object('meeting', meeting, 'people', people, 'board', board);
end;
$$;

revoke all on function public.minutes_draft_start(uuid) from public, anon, authenticated;
grant execute on function public.minutes_draft_start(uuid) to authenticated;
