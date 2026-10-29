-- Family view. See docs/superpowers/specs/2026-10-29-family-view-design.md.
-- Family is an app-only status with no Club rights (constitution v4 5.8). An approved Family person
-- gets the ride calendar and their own record, and nothing members-only. The app mirrors this in
-- src/domain/access.ts (isFamily, isApprovedMember) and src/data/familyData.ts.

-- Every policy and action built on this helper (and every one added later) now leaves Family out.
-- Their own profile, private details, bikes and emergency contacts come from the own-row policies,
-- which never used it.
create or replace function private.is_approved_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'family');
$$;

-- The old public copy isn't used by any policy any more, but keep it saying the same thing.
create or replace function public.is_approved_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'family');
$$;

create or replace function private.is_family()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved' and status = 'family');
$$;
revoke all on function private.is_family() from public, anon;
grant execute on function private.is_family() to authenticated;

-- The ride calendar from today on, for Family: the ride itself (what the club website shows), with
-- no answers, crew, routes or briefings. Empty for anyone else, who use ride_calendar().
create or replace function public.family_rides()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
begin
  if not private.is_family() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'all_day', r.all_day, 'title', r.title,
      'location', r.location, 'notes', r.notes, 'category', r.category, 'cancelled_at', r.cancelled_at)
      order by r.starts_at, r.id)
    from public.rides r
    where r.starts_at >= today_start or r.ends_at > today_start), '[]'::jsonb);
end;
$$;
revoke all on function public.family_rides() from public, anon;
grant execute on function public.family_rides() to authenticated;

-- Presented Treasurer's Reports went to anyone approved who hadn't left, Family included. Now
-- approved members who haven't left (13.8). Otherwise as in 20270430000000_meeting_reports.sql.
create or replace function public.meeting_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  keeper boolean := private.keeps_books(null);
  reader boolean := private.is_approved_member() and exists (
    select 1 from public.members where id = auth.uid() and status <> 'legacy');
begin
  if not (keeper or reader) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'from_on', r.from_on, 'to_on', r.to_on, 'notes', r.notes, 'saved_by', r.saved_by, 'saved_at', r.saved_at,
      'presented_by', r.presented_by, 'presented_at', r.presented_at,
      'figures', private.meeting_report(r.from_on, r.to_on)) order by r.to_on desc, r.saved_at desc)
    from public.treasurer_meeting_reports r
    where r.presented_at is not null or keeper), '[]'::jsonb);
end;
$$;

-- Family don't use the chats, so nobody opens a private chat with them. Otherwise as in
-- 20261101000100_chat.sql. Mirrors directProblem in src/domain/chat.ts.
create or replace function public.open_direct_chat(p_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  pair text;
  chat uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if p_member = me then raise exception 'You can’t message yourself.'; end if;
  if target.approval <> 'approved' then raise exception 'They’re not an approved member.'; end if;
  if target.status = 'family' then raise exception 'Family don’t use the club chats.'; end if;
  if (select status from public.members where id = me) = 'introduced' then
    raise exception 'Private chats open up once you’re an FNG.';
  end if;
  if target.status = 'introduced' then raise exception 'They can’t get private messages until they’re an FNG.'; end if;
  if private.blocked_between(me, p_member) then raise exception 'You can’t message them.'; end if;

  pair := least(me::text, p_member::text) || ':' || greatest(me::text, p_member::text);
  select id into chat from public.conversations where direct_key = pair;
  if chat is null then
    insert into public.conversations (kind, direct_key) values ('direct', pair)
    on conflict (direct_key) do nothing
    returning id into chat;
    if chat is null then
      select id into chat from public.conversations where direct_key = pair;
    else
      insert into public.conversation_members (conversation_id, member_id) values (chat, me), (chat, p_member);
    end if;
  end if;
  return chat;
end;
$$;
