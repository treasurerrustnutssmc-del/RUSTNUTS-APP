-- Personal ride calendar (Jeff, 28 Nov 2026: "any rides I click going to be added to a personal
-- calendar, either Gmail or Outlook or any other calendar"). Each approved member gets a private link
-- that Google, Outlook or Apple Calendar subscribes to; it lists the rides they marked Going and keeps
-- up as rides change, are called off, or they pull out. The calendar-feed server function (JWT off,
-- since calendar apps can't sign in) turns calendar_feed's rows into the calendar file
-- (supabase/functions/_shared/rideCalendarFeed.ts). Checked by supabase/tests/calendar_feed_test.sql.
-- Spec: docs/superpowers/specs/2026-11-28-personal-ride-calendar-design.md.

create table if not exists private.calendar_links (
  member_id uuid primary key references public.members (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  made_at timestamptz not null default now()
);
alter table private.calendar_links enable row level security;
revoke all on private.calendar_links from public, anon, authenticated;

-- 64 hex characters from two random UUIDs (244 random bits).
create or replace function private.new_calendar_token()
returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;
revoke all on function private.new_calendar_token() from public, anon, authenticated;

-- The signed-in member's link token, made the first time they ask.
create or replace function public.my_calendar_link()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  me constant uuid := auth.uid();
  t text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select token into t from private.calendar_links where member_id = me;
  if t is null then
    insert into private.calendar_links (member_id, token) values (me, private.new_calendar_token())
    on conflict (member_id) do nothing;
    select token into t from private.calendar_links where member_id = me;
  end if;
  return t;
end $$;
revoke all on function public.my_calendar_link() from public, anon;
grant execute on function public.my_calendar_link() to authenticated;

-- A fresh token for the signed-in member; the old link stops working.
create or replace function public.new_calendar_link()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  me constant uuid := auth.uid();
  t text := private.new_calendar_token();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into private.calendar_links (member_id, token) values (me, t)
  on conflict (member_id) do update set token = excluded.token, made_at = now();
  return t;
end $$;
revoke all on function public.new_calendar_link() from public, anon;
grant execute on function public.new_calendar_link() to authenticated;

-- For the calendar-feed server function only: the rides the token's member answered Going, from 60
-- days back, called-off ones included (so the calendar shows them called off), with each leg's number
-- and the trip's leg count. Null for a token nobody has; an empty list once the member is no longer
-- approved, so their subscription empties instead of erroring.
create or replace function public.calendar_feed(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  who uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select member_id into who from private.calendar_links where token = p_token;
  if who is null then return null; end if;
  if not exists (select 1 from public.members where id = who and approval = 'approved') then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'all_day', r.all_day,
        'location', r.location, 'notes', r.notes, 'cancelled_at', r.cancelled_at,
        'leg_no', l.leg_no,
        'leg_count', case when l.trip_id is null then null
                          else (select count(*) from public.ride_legs x where x.trip_id = l.trip_id) end
      ) order by r.starts_at)
    from public.rsvps v
    join public.rides r on r.id = v.ride_id
    left join public.ride_legs l on l.ride_id = r.id
    where v.member_id = who and v.answer = 'going'
      and coalesce(r.ends_at, r.starts_at) >= now() - interval '60 days'
  ), '[]'::jsonb);
end $$;
revoke all on function public.calendar_feed(text) from public, anon, authenticated;
grant execute on function public.calendar_feed(text) to service_role;
