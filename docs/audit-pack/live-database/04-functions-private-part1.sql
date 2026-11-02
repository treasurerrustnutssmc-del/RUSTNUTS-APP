-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the private schema (helpers used by policies and public functions; not exposed through the API).
-- Part 1 of 2.

CREATE OR REPLACE FUNCTION private.add_roster_position(p_member uuid, p_seat uuid, p_role position_role)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  insert into public.positions (member_id, chapter_id, role, started_on)
  values (p_member, p_seat, p_role,
          case when p_role = 'founder' then private.club_date() else least(private.club_date(), date '2026-08-01') end);
  return true;
exception when unique_violation then
  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.address_problem(p_street text, p_suburb text, p_state text, p_postcode text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_street = '' or char_length(p_street) > 120 or p_suburb = '' or char_length(p_suburb) > 60 then 'Fill in the delivery address.'
    when p_state not in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA') then 'Pick a state.'
    when p_postcode !~ '^\d{4}$' then 'Postcode is four digits.'
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.agm_on(p_year integer)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select held_on from public.agms where year = p_year), make_date(p_year, 8, 1));
$function$
;

CREATE OR REPLACE FUNCTION private.approves_for(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and (role in ('nec_chair', 'nec_secretary')
        or (p_chapter is null and role = 'president')
        or (p_chapter is not null and chapter_id = p_chapter
            and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))));
$function$
;

CREATE OR REPLACE FUNCTION private.assistant_next_month(p_day date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select (date_trunc('month', p_day) + interval '1 month')::date;
$function$
;

CREATE OR REPLACE FUNCTION private.assistant_on()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select value = 'true' from private.app_settings where key = 'assistant_on'), false);
$function$
;

CREATE OR REPLACE FUNCTION private.assistant_setting(p_key text, p_default bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- A value that isn't a whole number is ignored, so a typo in a setting can't break every question.
  select coalesce((select trim(value)::bigint from private.app_settings where key = p_key and trim(value) ~ '^[0-9]{1,15}$'), p_default);
$function$
;

CREATE OR REPLACE FUNCTION private.audit_draft(p_id uuid)
 RETURNS audit_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.audit_reports;
begin
  perform private.require_auditor();
  select * into r from public.audit_reports where id = p_id for update;
  if not found then raise exception 'That report isn’t there any more.'; end if;
  if r.issued_at is not null then raise exception 'That report has been issued, so it can’t change.'; end if;
  return r;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.audit_text(p_text text, p_empty text, p_max integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if nullif(trim(p_text), '') is null then raise exception '%', p_empty; end if;
  if char_length(trim(p_text)) > p_max then raise exception 'Keep it to % characters at most.', p_max; end if;
  return trim(p_text);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.award_phase(p_nominations_close date, p_voting_close date)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when private.club_date() <= p_nominations_close then 'nominating'
    when private.club_date() <= p_voting_close then 'voting'
    else 'closed'
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.balance_before(p_chapter uuid, p_month date)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select amount_cents::bigint from public.fund_openings
     where extract(month from p_month) = 7 and chapter_id is not distinct from p_chapter and fy = private.fy_of(p_month)),
    private.fund_balance(p_chapter, p_month - 1));
$function$
;

CREATE OR REPLACE FUNCTION private.big4_problem(p_member uuid, p_ride uuid, p_crew boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.members%rowtype;
  ride_day date;
  came int;
  held int;
  needed int;
  phrase text;
begin
  if not exists (select 1 from public.big4_rides where ride_id = p_ride) then return null; end if;
  select * into m from public.members where id = p_member;
  if not found then return null; end if;
  if not p_crew then
    if m.status = 'supporter' then return 'Supporters can’t join Big 4 Club-only rides (5.8).'; end if;
    if m.status not in ('fng', 'full', 'nomad') then return 'Big 4 rides are for FNGs, Full Members and Nomads (5.4).'; end if;
  end if;
  if exists (select 1 from public.big4_waivers where ride_id = p_ride and member_id = p_member) then return null; end if;
  select private.club_date(r.starts_at) into ride_day from public.rides r where r.id = p_ride;

  select count(*) filter (where recent.came), count(*) into came, held
  from (
    select exists (select 1 from public.attendance a where a.session_id = s.id and a.member_id = p_member) as came
    from public.checkin_sessions s
    where s.kind = 'meeting' and s.chapter_id = m.chapter_id and coalesce(s.meeting_type, 'ordinary') <> 'event'
      and s.held_on < ride_day and s.held_on <= private.club_date()
      and not (
        exists (select 1 from public.attendance_exemptions e where e.session_id = s.id and e.member_id = p_member)
        and not exists (select 1 from public.attendance a where a.session_id = s.id and a.member_id = p_member)
      )
    order by s.held_on desc, 1 desc
    limit 3
  ) recent;
  needed := least(2, held);
  if came >= needed then return null; end if;
  phrase := case when held = 1 then 'the last meeting' else needed || ' of the last ' || held || ' meetings' end;
  if p_crew then return 'They need ' || phrase || ' to ride this Big 4 (5.4).'; end if;
  return 'You need ' || phrase || ' to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.blocked_between(a uuid, b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.member_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$function$
;

CREATE OR REPLACE FUNCTION private.brag_file_in_use(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.brag_nominations n where n.photo->>'path' = p_name);
$function$
;

CREATE OR REPLACE FUNCTION private.build_file_in_use(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.build_updates u where u.photos @> jsonb_build_array(jsonb_build_object('path', p_name)));
$function$
;

CREATE OR REPLACE FUNCTION private.bus_clashes(p_first date, p_last date, p_except uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.bus_bookings
    where status = 'approved' and id is distinct from p_except
      and daterange(first_day, last_day, '[]') && daterange(p_first, p_last, '[]')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.bus_hand()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.manages_bus()
    or exists (select 1 from public.members where id = auth.uid() and status in ('full', 'nomad'))
    or private.bus_key_holder() is not distinct from auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION private.bus_key_holder()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select to_id from public.bus_key_handovers order by logged_at desc, id desc limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.can_act_on_content_report(p_report uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select case when r.kind = 'profile' then r.author_id is not null and private.is_board_of(private.chapter_of(r.author_id))
                else private.is_any_board() end
    from public.content_reports r
    where r.id = p_report
  ), false);
$function$
;

CREATE OR REPLACE FUNCTION private.can_act_on_report(p_report uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select case when c.kind = 'direct' then private.is_board_of(private.chapter_of(r.reporter_id))
                else private.can_moderate(c.id) end
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.id = p_report
  ), false);
$function$
;

CREATE OR REPLACE FUNCTION private.can_change_invite(i club_invites)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    coalesce(i.direction = 'in' and i.answer = 'waiting' and i.added_by = auth.uid(), false) or private.manages_invite(i)
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_check_in()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() or exists (
    select 1 from public.members where id = auth.uid() and approval = 'pending' and status = 'introduced'
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_designate_big4()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null and role in ('nec_chair', 'nec_secretary', 'president')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_edit_mechanic(p_added_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (p_added_by = auth.uid() or private.is_any_board());
$function$
;

CREATE OR REPLACE FUNCTION private.can_edit_other_club(p_added_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member()
    and (coalesce(p_added_by = auth.uid(), false) or private.manages_chapter_rides(null));
$function$
;

CREATE OR REPLACE FUNCTION private.can_manage_fees(target_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and ((role = 'treasurer' and chapter_id = target_chapter) or role in ('nec_chair', 'nec_secretary'))
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_moderate(p_chat uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_chat;
  if not found or not private.is_approved_member() then return false; end if;
  if c.kind in ('chapter', 'board') then return private.is_board_of(c.chapter_id); end if;
  if c.kind = 'nec' then return private.is_national(); end if;
  if c.kind = 'direct' then return false; end if;
  if c.kind = 'committee' and not private.can_read_chat(p_chat) then return false; end if;
  return private.is_any_board();
end;
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_brag_file(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.brag_nominations n join public.brag_awards a on a.id = n.award_id
      where n.withdrawn_at is null and a.archived_at is null and n.photo->>'path' = p_name
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_build_file(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.build_updates u
      where u.taken_down_at is null and private.is_approved(u.author_id)
        and u.photos @> jsonb_build_array(jsonb_build_object('path', p_name))
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_bus_cost(p_logged_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.manages_bus() or (private.is_approved_member() and p_logged_by = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_chat(p_chat uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.chat_problem(p_chat) is null;
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_chat_file(p_name text, p_owner text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    exists (
      select 1 from public.message_media mm join public.messages m on m.id = mm.message_id
      where (mm.path = p_name or mm.poster_path = p_name) and m.removed_at is null
        and private.can_read_chat(mm.conversation_id)
    )
    or exists (
      select 1 from public.message_media mm join public.message_reports r on r.message_id = mm.message_id
      where (mm.path = p_name or mm.poster_path = p_name) and r.resolved_at is null
        and private.can_act_on_report(r.id)
    )
    or (
      p_owner = auth.uid()::text
      and not exists (select 1 from public.message_media mm where mm.path = p_name or mm.poster_path = p_name)
    );
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_sponsor_logo(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_any_board() or exists (
    select 1 from public.sponsors where logo_path = p_name and archived_at is null
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_swap_file(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.listings l join public.members m on m.id = l.seller_id
      where l.taken_down_at is null and m.approval = 'approved'
        and l.photos @> jsonb_build_array(jsonb_build_object('path', p_name))
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.can_run_checkin(target_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when target_chapter is not null then private.is_board_of(target_chapter)
              else private.is_approved_member() and (private.is_national() or exists (
                select 1 from public.positions where member_id = auth.uid() and ended_on is null
                  and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')))
         end;
$function$
;

CREATE OR REPLACE FUNCTION private.can_see_fees(target_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.can_manage_fees(target_chapter) or private.reviews_chapter(target_chapter);
$function$
;

CREATE OR REPLACE FUNCTION private.can_set_fees(target_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.can_manage_fees(target_chapter) or (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
  ));
$function$
;

CREATE OR REPLACE FUNCTION private.can_upload_chat_file(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return private.can_read_chat(folder::uuid);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.can_upload_sponsor_logo(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select split_part(p_name, '/', 1) = auth.uid()::text and private.is_any_board();
$function$
;

CREATE OR REPLACE FUNCTION private.chair_of(p_chapter uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- The chapter President, then the Vice President (constitution 10.9); the National Chairperson
  -- for the whole club (11.2).
  select member_id from public.positions
  where ended_on is null and chapter_id is not distinct from p_chapter
    and role in (case when p_chapter is null then 'nec_chair' else 'president' end::public.position_role,
                 case when p_chapter is null then 'nec_chair' else 'vice_president' end::public.position_role)
  order by role = 'vice_president', started_on desc limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.chapter_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.conversations (kind, chapter_id) values ('chapter', new.id), ('board', new.id) on conflict do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.chapter_name_taken(p_name text, p_except uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.chapters c
                 where lower(private.trim_like_app(c.name)) = lower(private.trim_like_app(p_name)) or c.slug = private.slug_of(p_name))
      or exists (select 1 from public.chapter_proposals p
                 where p.id is distinct from p_except and p.status = 'proposed'
                   and (lower(private.trim_like_app(p.name)) = lower(private.trim_like_app(p_name)) or private.slug_of(p.name) = private.slug_of(p_name)));
$function$
;

CREATE OR REPLACE FUNCTION private.chapter_of(target_member uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select chapter_id from public.members where id = target_member;
$function$
;

CREATE OR REPLACE FUNCTION private.chapters_represented(p_vote uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with chapter as (
    select m.chapter_id, bool_or(e.voted_at is not null) as voted
    from public.vote_electors e join public.members m on m.id = e.member_id
    where e.vote_id = p_vote
    group by m.chapter_id)
  select count(*) filter (where voted) >= greatest(1, ceil(count(*) * 51 / 100.0)::int) from chapter;
$function$
;

CREATE OR REPLACE FUNCTION private.chat_problem(p_chat uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if not private.is_approved_member() then return 'Only approved members can do that.'; end if;
  select * into c from public.conversations where id = p_chat;
  if not found then return 'No such chat.'; end if;
  -- Someone who might join gets the whole-club and ride chats only, until they're an FNG.
  if c.kind not in ('club', 'ride')
     and (select status from public.members where id = auth.uid()) = 'introduced' then
    if c.kind = 'direct' then return 'Private chats open up once you’re an FNG.'; end if;
    if c.kind = 'chapter' then return 'Chapter chats open up once you’re an FNG.'; end if;
    return 'That chat opens up once you’re an FNG.';
  end if;
  if c.kind = 'chapter' then
    if private.chapter_of(auth.uid()) = c.chapter_id or private.is_national() then return null; end if;
    return format('That chat is for %s chapter members.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'board' then
    if private.sees_board_of(c.chapter_id) then return null; end if;
    return format('That chat is for the %s board.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'nec' then
    if private.is_national() then return null; end if;
    return 'That chat is for the NEC.';
  elsif c.kind = 'committee' then
    if private.is_on_committee(c.committee) or private.is_national() then return null; end if;
    return format('That chat is for the %s committee.', c.committee);
  elsif c.kind = 'direct' then
    if exists (select 1 from public.conversation_members where conversation_id = p_chat and member_id = auth.uid()) then
      return null;
    end if;
    return 'That’s a private chat.';
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.chat_push_body(m messages, c conversations, sender members)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  words text := btrim(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'));
  who text := private.short_name(sender);
  photos int;
  videos int;
  gifs int;
  voice int;
  sent text;
  out text;
begin
  if words <> '' then
    out := case when c.kind = 'direct' then words else who || ': ' || words end;
  else
    -- As text: voice notes (20270415000700_voice_notes.sql) add their kind after this file.
    select count(*) filter (where kind::text = 'photo'), count(*) filter (where kind::text = 'video'),
           count(*) filter (where kind::text = 'gif'), count(*) filter (where kind::text = 'voice')
    into photos, videos, gifs, voice
    from public.message_media where message_id = m.id;
    sent := case
      when voice > 0 then 'a voice note'
      when photos + videos = 0 and gifs > 0 then 'a GIF'
      when photos = 1 and videos = 0 then 'a photo'
      when videos = 1 and photos = 0 then 'a video'
      when videos = 0 then photos || ' photos'
      when photos = 0 then videos || ' videos'
      when photos + videos > 0 then (photos + videos) || ' photos and videos'
      else 'a message'
    end;
    out := case when c.kind = 'direct' then 'Sent ' || sent else who || ' sent ' || sent end;
  end if;
  if char_length(out) > 140 then out := left(out, 139) || '…'; end if;
  return out;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.chat_push_title(c conversations, sender members)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case c.kind
    when 'club' then 'Whole club'
    when 'chapter' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' chapter'
    when 'board' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' big table'
    when 'nec' then 'NEC'
    when 'committee' then case when c.committee = 'charity' then 'Charity committee' else 'Ride committee' end
    when 'ride' then coalesce((select title from public.rides where id = c.ride_id), 'Ride chat')
    else private.short_name(sender)
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_bike()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if nullif(trim(new.make), '') is null or nullif(trim(new.model), '') is null then
    raise exception 'Add the make and model.';
  end if;
  perform private.check_bike_year(new.year);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_bike_year(p_year integer)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  latest int := extract(year from private.club_date())::int + 1;
begin
  if p_year is not null and (p_year < 1885 or p_year > latest) then
    raise exception 'Check the year: 1885 to %.', latest;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_club_on_list(p_club uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.other_clubs%rowtype;
begin
  select * into c from public.other_clubs where id = p_club;
  if not found then raise exception 'No such club.'; end if;
  if c.archived_at is not null then raise exception 'That club is off the list.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if nullif(trim(new.name), '') is null or nullif(trim(new.phone), '') is null then
    raise exception 'Add their name and number.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_document_approval(p_body text, p_approved_on date, p_commences_on date)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_body is null and p_approved_on is null and p_commences_on is null then return; end if;
  if p_body is null or p_approved_on is null or p_commences_on is null then
    raise exception 'Give the approving body, the approval date and the commencement date together.';
  end if;
  if p_body not in ('association_general_meeting', 'association_committee', 'full_members', 'nec', 'chapter_board') then
    raise exception 'Pick who approved it.';
  end if;
  if p_approved_on > private.club_date() then raise exception 'The approval date can’t be in the future.'; end if;
  if p_commences_on < p_approved_on then raise exception 'It can’t commence before it was approved.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_history_keeper()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can keep the club’s history.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_payment(c charges, p_amount_cents integer, p_paid_on date, p_method text, too_much text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare left_to_pay int := private.owing(c.id);
begin
  if c.waived_at is not null then raise exception 'That charge was waived.'; end if;
  if left_to_pay = 0 then raise exception 'That’s already paid.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_amount_cents > left_to_pay then raise exception '%', too_much; end if;
  if p_paid_on is null or p_paid_on > private.club_date() then raise exception 'The payment date can’t be in the future.'; end if;
  if p_method = 'card' then raise exception 'Card payments aren’t set up yet.'; end if;
  if p_method is null or p_method not in ('payid', 'bank', 'cash') then raise exception 'Pick how it was paid.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_sponsor_keeper()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can look after the club’s sponsors.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.check_votes(p_for integer, p_against integer, p_abstained integer)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if coalesce(p_for, 0) < 0 or coalesce(p_against, 0) < 0 or coalesce(p_abstained, 0) < 0 then
    raise exception 'Vote counts can’t be negative.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.club_date(at_time timestamp with time zone DEFAULT now())
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (at_time at time zone 'Australia/Melbourne')::date;
$function$
;

CREATE OR REPLACE FUNCTION private.club_day(t timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select to_char(t at time zone 'Australia/Melbourne', 'Dy DD/MM/YYYY');
$function$
;

CREATE OR REPLACE FUNCTION private.club_time(t timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select ltrim(to_char(t at time zone 'Australia/Melbourne', 'HH12:MI am'), '0');
$function$
;

CREATE OR REPLACE FUNCTION private.club_year_of(d date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when d >= private.agm_on(extract(year from d)::int) then extract(year from d)::int
              else extract(year from d)::int - 1 end;
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_board_record(p_id uuid)
 RETURNS conduct_records
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.conduct_records := private.conduct_record(p_id);
begin
  if not private.is_board_of(private.conduct_chapter(r)) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if r.member_id = auth.uid() then raise exception 'You can’t record one about yourself.'; end if;
  return r;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_chapter(r conduct_records)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select m.chapter_id from public.members m where m.id = r.member_id), r.chapter_id);
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_delete_on(p_decided date, p_suspended date, p_hold date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select greatest((greatest(p_decided, coalesce(p_suspended, p_decided)) + interval '12 months')::date, p_hold + 1);
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_formal(p_kind text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_kind in ('reprimand', 'suspension', 'expulsion');
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_kept(r conduct_records)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.club_date() < private.conduct_delete_on(r.decided_on, r.suspended_until, r.hold_until)
    or exists (select 1 from public.conduct_appeals a where a.record_id = r.id and a.outcome is null and a.withdrawn_on is null);
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_open_appeal(p_id uuid)
 RETURNS conduct_appeals
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.conduct_records := private.conduct_record(p_id); a public.conduct_appeals;
begin
  select * into a from public.conduct_appeals where record_id = r.id;
  if not found then raise exception 'No review or appeal is lodged.'; end if;
  if a.outcome is not null or a.withdrawn_on is not null then raise exception 'That one is settled.'; end if;
  return a;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.conduct_record(p_id uuid)
 RETURNS conduct_records
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.conduct_records;
begin
  select * into r from public.conduct_records where id = p_id;
  if not found or not private.sees_conduct(r) then raise exception 'No such record.'; end if;
  return r;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.content_report_target(p_kind text, p_target uuid, OUT present boolean, OUT author uuid, OUT gone boolean, OUT snapshot text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  present := false; gone := false; snapshot := '';
  if p_kind = 'listing' then
    select true, l.seller_id, l.taken_down_at is not null, l.title || coalesce(E'\n' || l.details, '')
      into present, author, gone, snapshot from public.listings l where l.id = p_target;
  elsif p_kind = 'build_update' then
    select true, u.author_id, u.taken_down_at is not null, coalesce(u.body, '')
      into present, author, gone, snapshot from public.build_updates u where u.id = p_target;
  elsif p_kind = 'nomination' then
    select true, n.nominated_by, n.withdrawn_at is not null,
           concat_ws(E'\n', n.title, n.story, case when n.reason is not null then '“' || n.reason || '”' end)
      into present, author, gone, snapshot from public.brag_nominations n where n.id = p_target;
  elsif p_kind = 'mechanic' then
    select true, m.added_by, m.archived_at is not null, concat_ws(E'\n', m.name, m.speciality, m.notes)
      into present, author, gone, snapshot from public.mechanics m where m.id = p_target;
  elsif p_kind = 'profile' then
    select true, m.id, m.approval <> 'approved', concat_ws(E'\n', m.full_name, m.road_name, m.bio)
      into present, author, gone, snapshot from public.members m where m.id = p_target;
  end if;
  present := coalesce(present, false);
  gone := coalesce(gone, false);
  snapshot := coalesce(snapshot, '');
end;
$function$
;

CREATE OR REPLACE FUNCTION private.contribution_shares(p_total integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (
    select ch.id, ch.slug, (select count(*) from public.members m
                            where m.chapter_id = ch.id and m.approval = 'approved' and m.status in ('full', 'nomad')) as n
    from public.chapters ch
  ), t as (select coalesce(sum(n), 0)::bigint as s from c),
  p as (
    select c.id, c.slug, c.n,
           case when t.s = 0 then 0 else (p_total::bigint * c.n) / t.s end as whole,
           case when t.s = 0 then 0 else (p_total::bigint * c.n) % t.s end as rest
    from c, t
  ), r as (
    select p.*, row_number() over (order by p.rest desc, p.slug collate "C") as rn,
           p_total - sum(p.whole) over () as spare
    from p
  )
  select coalesce(jsonb_agg(jsonb_build_object('chapter_id', id, 'voting_members', n,
                                               'cents', whole + case when rn <= spare then 1 else 0 end)
                            order by slug collate "C"), '[]'::jsonb)
  from r;
$function$
;

CREATE OR REPLACE FUNCTION private.crew_eligibility(p_member uuid, p_role crew_role, ride_day date)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.members%rowtype;
  first_aid date;
begin
  select * into m from public.members where id = p_member;
  if m.approval <> 'approved' or m.status not in ('full', 'nomad') then return 'Only Full and Nomad members can crew a ride.'; end if;
  if m.on_hiatus then return 'Members on hiatus can’t crew a ride.'; end if;
  if p_role in ('tail_gunner', 'assistant_tail_gunner') then
    select mp.first_aid_expiry into first_aid from public.member_private mp where mp.member_id = p_member;
    if first_aid is null or first_aid < ride_day then return 'Tail Gunners need a current first aid certificate on file.'; end if;
  end if;
  if exists (select 1 from public.road_rules_versions) and not private.road_rules_signed(p_member) then
    return 'They haven’t signed the Road Rules yet.';
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.cron_headers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('Content-Type', 'application/json')
    || coalesce((select jsonb_build_object('x-cron-secret', s.value) from private.app_settings s where s.key = 'cron_secret' and s.value <> ''), '{}'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION private.cron_secret()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select value from private.app_settings where key = 'cron_secret';
$function$
;

CREATE OR REPLACE FUNCTION private.decide(p_threshold vote_threshold, p_quorum integer, p_yes integer, p_no integer, p_abstain integer, p_casting text, p_electors integer, OUT result vote_result, OUT tied boolean)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.design_problem(d shop_designs)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare my_status text;
begin
  select status::text into my_status from public.members where id = auth.uid();
  if my_status = 'legacy' then return 'Legacy members can’t order merch.'; end if;
  if not d.on_sale then return 'That isn’t on sale.'; end if;
  if d.eligibility = 'patched' and my_status not in ('full', 'nomad') then return 'That design is for Full and Nomad members.'; end if;
  if d.eligibility = 'family' and my_status not in ('full', 'nomad', 'family') then
    return 'That design is for Family members and patched members.';
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.document_in_force(p_document uuid, p_today date)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id from public.document_versions
  where document_id = p_document and approved_on is not null and commences_on <= p_today
  order by number desc limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.electors_for(p_electorate electorate, p_chapter uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.feedback_file_in_use(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.app_feedback where screenshot_path = p_name);
$function$
;

CREATE OR REPLACE FUNCTION private.fix_problem(p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_lat is null and p_lng is null then null
    when p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
      or p_lat = 'NaN'::float8 or p_lng = 'NaN'::float8
      then 'That location doesn’t look right.'
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.fng_due(p_member uuid, OUT at_months integer, OUT due_on date)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  started date;
  today date := private.club_date();
  last_done int;
begin
  select fng_started_on into started from public.members where id = p_member and status = 'fng';
  if started is null then return; end if;
  select coalesce(max(d.at_months), 0) into last_done from public.member_decisions d
  where d.member_id = p_member and d.kind = 'fng_review';
  at_months := greatest(6, last_done + 3);
  while (started + make_interval(months => at_months + 3))::date <= today loop
    at_months := at_months + 3;
  end loop;
  due_on := (started + make_interval(months => at_months))::date;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.forget_deleted_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.forget_member(old.id, old.email);
  return old;
end $function$
;

CREATE OR REPLACE FUNCTION private.forget_feedback()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.account_deleted_on is not null and old.account_deleted_on is null then
    insert into private.storage_purge (bucket, path, member_id)
    select o.bucket_id, o.name, new.id from storage.objects o
    where o.bucket_id = 'feedback-media' and split_part(o.name, '/', 1) = new.id::text;
    delete from public.app_feedback where member_id = new.id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.forget_member(p_member uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today constant date := private.club_date();
begin
  delete from public.member_private where member_id = p_member;
  delete from public.bikes where member_id = p_member; -- regos go with them
  delete from public.emergency_contacts where member_id = p_member;
  delete from public.notification_prefs where member_id = p_member;
  delete from public.push_devices where member_id = p_member;
  delete from private.push_outbox where member_id = p_member;
  -- Chat
  -- Their messages go, with photos and reactions, apart from any someone has reported: those stay
  -- for the board to deal with.
  delete from public.messages m where m.author_id = p_member
    and not exists (select 1 from public.message_reports r where r.message_id = m.id);
  delete from public.message_reactions where member_id = p_member;
  delete from public.message_reports where reporter_id = p_member;
  delete from public.chat_reads where member_id = p_member;
  delete from public.conversation_members where member_id = p_member;
  delete from public.member_blocks where blocker_id = p_member or blocked_id = p_member;
  -- Rides
  delete from public.rsvps where member_id = p_member;
  delete from public.ride_crew where member_id = p_member;
  delete from public.crew_swaps where asked_by = p_member or asked_to = p_member;
  delete from public.ride_briefing_reads where member_id = p_member;
  delete from public.road_rules_signoffs where member_id = p_member;
  delete from public.live_riders where member_id = p_member;
  delete from public.ride_alerts where member_id = p_member;
  delete from public.route_ratings where member_id = p_member;
  delete from public.hub_registrations where member_id = p_member;
  delete from public.charity_signups where member_id = p_member;
  delete from public.document_signoffs where member_id = p_member;
  -- Social
  delete from public.member_birthdays where member_id = p_member;
  delete from public.member_skills where member_id = p_member;
  delete from public.mechanic_vouches where member_id = p_member;
  delete from public.listings where seller_id = p_member;
  delete from public.build_updates where author_id = p_member;
  delete from public.brag_nominations where nominated_by = p_member; -- with the votes on them
  delete from public.brag_votes where member_id = p_member;
  -- The club shop: the orders stay for the books, without the name, email, address and phone.
  delete from public.shop_runners where member_id = p_member;
  update public.shop_orders set buyer_name = 'Former member', road_name = null, email = '', phone = null,
         street = null, suburb = null, state = null, postcode = null where member_id = p_member;
  update private.roster
     set phone = null, emergency_name = null, emergency_relationship = null, emergency_phone = null,
         bike_make = null, bike_model = null, bike_rego = null, roles = '{}'
   where claimed_by = p_member or (p_email is not null and lower(trim(email)) = lower(trim(p_email)));

  -- Their files (deep audit F1): everything they uploaded to the personal buckets that no surviving
  -- row still names. A file on a reported message stays with the message, for the board. The
  -- purge-files Edge Function deletes what's queued; the database can't reach Storage itself.
  insert into private.storage_purge (bucket, path, member_id)
  select o.bucket_id, o.name, p_member
  from storage.objects o
  where o.owner_id = p_member::text
    and o.bucket_id in ('chat-media', 'swap-media', 'build-media', 'brag-media')
    and not exists (select 1 from public.message_media mm where mm.path = o.name or mm.poster_path = o.name)
    and not exists (select 1 from public.listings l where l.photos @> jsonb_build_array(jsonb_build_object('path', o.name)))
    and not exists (select 1 from public.build_updates u where u.photos @> jsonb_build_array(jsonb_build_object('path', o.name)))
    and not exists (select 1 from public.brag_nominations n where n.photo->>'path' = o.name);

  delete from public.positions where member_id = p_member and ended_on is null and started_on > today;
  update public.positions set ended_on = today where member_id = p_member and ended_on is null;
  update public.members
     set full_name = 'Former member', road_name = null, bio = null, share_phone = false, on_hiatus = false,
         approval = 'declined', account_deleted_on = today, updated_at = now()
   where id = p_member;
end $function$
;

CREATE OR REPLACE FUNCTION private.forget_site_photos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Every file in their site-media folder, listed or not (an upload whose listing failed is still theirs).
  insert into private.storage_purge (bucket, path, member_id)
  select 'site-media', o.name, old.member_id from storage.objects o
  where o.bucket_id = 'site-media' and split_part(o.name, '/', 1) = old.member_id::text;
  delete from public.site_photos where posted_by = old.member_id;
  update public.site_photos set picked_by = null where picked_by = old.member_id;
  delete from public.site_photo_crew where member_id = old.member_id;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.founders_problem(p_founders uuid[], p_president uuid, p_saa uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when (select count(distinct f) from unnest(p_founders) f) <> cardinality(p_founders) or cardinality(p_founders) < 5
      or exists (select 1 from unnest(p_founders) f where f is null)
      then 'A new chapter needs at least five founders (12.1).'
    when (select count(*) from public.members where id = any (p_founders) and approval = 'approved' and status in ('full', 'nomad'))
         <> cardinality(p_founders)
      then 'Founders must be approved Full or Nomad members (12.1).'
    when p_president is null or p_saa is null or not (p_president = any (p_founders)) or not (p_saa = any (p_founders)) or p_president = p_saa
      then 'Pick a founding President and Sergeant-at-Arms from the founders (12.1).'
    when exists (select 1 from public.members where id in (p_president, p_saa) and status = 'nomad')
      then 'Nomads can’t hold a board seat (9.1).'
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.fund_balance(p_chapter uuid, p_upto date)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with o as (
    select fy, amount_cents from public.fund_openings
    where chapter_id is not distinct from p_chapter and fy <= private.fy_of(p_upto)
    order by fy desc limit 1
  )
  select coalesce((select amount_cents from o), 0) + coalesce((
    select sum(case when c.direction = 'credit' then e.amount_cents else -e.amount_cents end)
    from public.ledger_entries e join public.ledger_codes c on c.code = e.code
    where e.state = 'paid' and e.chapter_id is not distinct from p_chapter and e.entry_on <= p_upto
      and (not exists (select 1 from o) or e.entry_on >= make_date((select fy from o), 7, 1))), 0);
$function$
;

CREATE OR REPLACE FUNCTION private.fy_of(d date)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when extract(month from d) >= 7 then extract(year from d)::int else extract(year from d)::int - 1 end;
$function$
;

CREATE OR REPLACE FUNCTION private.has_carried_auditor_vote(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_carried_nec_vote(p_member, 'nec_auditor');
$function$
;

CREATE OR REPLACE FUNCTION private.has_carried_nec_vote(p_member uuid, p_role position_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and subject_role = p_role and chapter_id is null
      and electorate = 'nec' and threshold = 'two_thirds'
      and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
      and private.club_date(closed_at) > coalesce(
        (select max(started_on) from public.positions where member_id = p_member and role = p_role), '-infinity'::date)
  );
$function$
;

CREATE OR REPLACE FUNCTION private.has_carried_patch_vote(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.votes v join public.members m on m.id = v.subject_member_id
    where v.subject_member_id = p_member and v.subject_role is null and v.electorate = 'chapter_patched'
      and v.closed_at is not null and v.result = 'carried'
      and (m.fng_started_on is null or private.club_date(v.opened_at) >= m.fng_started_on)
  );
$function$
;

CREATE OR REPLACE FUNCTION private.has_carried_reinstate_vote(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and subject_role is null and electorate = 'nec' and threshold = 'majority'
      and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
  );
$function$
;

CREATE OR REPLACE FUNCTION private.has_carried_removal_vote(p_position uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.positions p
    join public.votes v on v.subject_member_id = p.member_id and v.subject_role = p.role and v.chapter_id = p.chapter_id
    where p.id = p_position
      and v.electorate = case
        when p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
          then 'chapter_patched' else 'chapter_board' end::public.electorate
      and v.threshold = case
        when p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
          then 'two_thirds' else 'majority' end::public.vote_threshold
      and v.closed_at is not null and v.result = 'carried'
      and private.club_date(v.closed_at) >= private.club_date() - 90
      and private.club_date(v.closed_at) >= p.started_on
  );
$function$
;

CREATE OR REPLACE FUNCTION private.hazards_ok(p_hazards text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(bool_and(h is not null and private.trim_like_app(h) <> '' and char_length(h) <= 120), true)
  from unnest(p_hazards) h;
$function$
;

CREATE OR REPLACE FUNCTION private.hold_problem(p_member uuid, p_role position_role)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.members%rowtype;
begin
  select * into target from public.members where id = p_member;
  if target.status not in ('full', 'nomad') then
    return 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
  end if;
  if target.status = 'nomad' and p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms',
                                            'road_captain', 'nec_chair', 'nec_secretary', 'nec_auditor') then
    return 'Nomads can’t hold a board or national seat (9.1).';
  end if;
  if (p_role = 'nec_auditor' and exists (
        select 1 from public.positions where member_id = p_member and ended_on is null and role in ('president', 'treasurer')))
     or (p_role in ('president', 'treasurer') and exists (
        select 1 from public.positions where member_id = p_member and ended_on is null and role = 'nec_auditor')) then
    return 'The National Auditor can’t also be a President or Treasurer (11.8).';
  end if;
  if (p_role = 'nec_auditor' and exists (
        select 1 from public.positions where member_id = p_member and ended_on is null and role in ('nec_chair', 'nec_secretary')))
     or (p_role in ('nec_chair', 'nec_secretary') and exists (
        select 1 from public.positions where member_id = p_member and ended_on is null and role = 'nec_auditor')) then
    return 'The National Auditor isn’t on the NEC, so can’t also be National Chairman or Secretary (11.8).';
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.holds_board_seat(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and chapter_id = p_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'));
$function$
;

CREATE OR REPLACE FUNCTION private.is_any_board()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_approved(target_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.members where id = target_member and approval = 'approved');
$function$
;

CREATE OR REPLACE FUNCTION private.is_approved_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'family');
$function$
;

CREATE OR REPLACE FUNCTION private.is_auditor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role = 'nec_auditor'
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_board_of(target_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_chairman()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null and role = 'nec_chair'
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_family()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved' and status = 'family');
$function$
;

CREATE OR REPLACE FUNCTION private.is_feedback_keeper()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('treasurer', 'nec_chair', 'nec_secretary')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_learner(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.member_private where member_id = p_member and licence_class = 'learner');
$function$
;

CREATE OR REPLACE FUNCTION private.is_national()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'president')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_nec_officer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_on_committee(p_committee chat_committee)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and case p_committee when 'ride' then role in ('ride_committee', 'road_captain')
                           else role = 'charity_committee' end
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_on_this_day(p_day date, p_today date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_day < date_trunc('year', p_today)::date and (
    to_char(p_day, 'MM-DD') = to_char(p_today, 'MM-DD')
    or (
      to_char(p_today, 'MM-DD') = '02-28' and to_char(p_day, 'MM-DD') = '02-29'
      and extract(day from (date_trunc('year', p_today) + interval '1 month 28 days')) <> 29
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_ride_leader(who uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.positions p join public.members m on m.id = p.member_id
    where p.member_id = who and p.ended_on is null and m.approval = 'approved'
      and p.role in ('road_captain', 'tail_gunner', 'assistant_tail_gunner', 'president', 'vice_president',
                     'secretary', 'treasurer', 'sergeant_at_arms', 'nec_chair', 'nec_secretary')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_sharing(p_ride uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.live_riders lr join public.rides r on r.id = lr.ride_id
    where lr.ride_id = p_ride and lr.member_id = auth.uid() and lr.stops_at > now() and r.cancelled_at is null
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_site_photo_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.manages_site_photo_crew()
    or (private.is_approved_member() and exists (select 1 from public.site_photo_crew where member_id = auth.uid()));
$function$
;

CREATE OR REPLACE FUNCTION private.is_sponsor_keeper()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_any_board();
$function$
;

CREATE OR REPLACE FUNCTION private.keeps_books(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and (role in ('nec_chair', 'nec_secretary') or (role = 'treasurer' and (p_chapter is null or chapter_id = p_chapter))));
$function$
;

CREATE OR REPLACE FUNCTION private.live_problem(p_ride uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ride public.rides%rowtype;
  w record;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if not private.is_approved_member() then return 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride;
  if not found then return 'No such ride.'; end if;
  if ride.cancelled_at is not null then return 'That ride was cancelled.'; end if;
  select * into w from private.live_window(ride);
  if now() < w.opens then return 'Live ride opens 2 hours before the start.'; end if;
  if now() >= w.closes then return 'This ride’s finished.'; end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.live_ride_cleanup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.live_riders where stops_at <= now();
  delete from public.live_riders lr using public.rides r
  where r.id = lr.ride_id
    and not exists (select 1 from private.live_window(r) w where w.closes > now());
  delete from public.ride_alerts a using public.rides r
  where r.id = a.ride_id
    and not exists (select 1 from private.live_window(r) w where w.closes > now());
end;
$function$
;

CREATE OR REPLACE FUNCTION private.live_window(r rides)
 RETURNS TABLE(opens timestamp with time zone, closes timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    case when r.all_day then r.starts_at else r.starts_at - interval '2 hours' end,
    case
      when r.all_day then
        ((case when r.ends_at is null then (r.starts_at at time zone 'Australia/Melbourne')::date
               else ((r.ends_at - interval '1 millisecond') at time zone 'Australia/Melbourne')::date end) + 1)::timestamp
          at time zone 'Australia/Melbourne'
      when r.ends_at is not null then r.ends_at + interval '2 hours'
      else (((r.starts_at at time zone 'Australia/Melbourne')::date) + 1)::timestamp at time zone 'Australia/Melbourne'
    end
  where r.cancelled_at is null;
$function$
;

CREATE OR REPLACE FUNCTION private.manages_bus()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and chapter_id is not null
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.manages_chapter_rides(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.positions p
      where p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'ride_committee')
        and (p_chapter is null or p.chapter_id = p_chapter)
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.manages_invite(i club_invites)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.manages_chapter_rides(i.chapter_id);
$function$
;

CREATE OR REPLACE FUNCTION private.manages_ride(p_ride uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.rides r
      join public.positions p on p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'ride_committee')
      left join public.chapters c on c.slug = r.category::text
      where r.id = p_ride
        and (r.category not in ('north', 'west') or p.chapter_id = c.id)
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.manages_ride_category(p_category ride_category)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.positions p
      left join public.chapters c on c.slug = p_category::text
      where p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'ride_committee')
        and (p_category not in ('north', 'west') or p.chapter_id = c.id)
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.manages_site_photo_crew()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and role = 'social_media_officer'
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.media_json(mm message_media, m messages)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id', mm.id, 'message_id', mm.message_id, 'conversation_id', mm.conversation_id,
                            'kind', mm.kind, 'path', mm.path, 'poster_path', mm.poster_path, 'width', mm.width,
                            'height', mm.height, 'duration_ms', mm.duration_ms, 'position', mm.position,
                            'author_id', m.author_id, 'created_at', m.created_at);
$function$
;

CREATE OR REPLACE FUNCTION private.meeting_for_action(p_id uuid)
 RETURNS meetings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare found_meeting public.meetings%rowtype;
begin
  perform private.require_member();
  select * into found_meeting from public.meetings where id = p_id for update;
  if not found then raise exception 'No such meeting.'; end if;
  perform private.require_scope(found_meeting.chapter_id);
  if found_meeting.cancelled_at is not null then raise exception 'That meeting was cancelled.'; end if;
  return found_meeting;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.meeting_report(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lines as (
    select e.chapter_id, e.code, e.amount_cents, e.entry_on, c.direction
    from public.ledger_entries e join public.ledger_codes c on c.code = e.code
    where e.state = 'paid' and e.entry_on between p_from and p_to
  ),
  f as (
    select null::uuid as id
    union all select id from public.chapters
  ),
  fm as (
    select coalesce(f.id::text, 'club') as k,
      private.opening_on(f.id, p_from) as opening,
      coalesce((select sum(amount_cents) from lines where chapter_id is not distinct from f.id and direction = 'credit'), 0) as receipts,
      coalesce((select sum(amount_cents) from lines where chapter_id is not distinct from f.id and direction = 'debit'), 0) as payments,
      private.fund_balance(f.id, p_to) as closing
    from f
  ),
  months as (
    select m::date as month, greatest(m::date, p_from) as a,
      least((m + interval '1 month' - interval '1 day')::date, p_to) as b
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'funds', (select jsonb_object_agg(k, jsonb_build_object(
        'opening_cents', opening, 'receipts_cents', receipts, 'payments_cents', payments, 'closing_cents', closing)) from fm),
    'credits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents',
        coalesce((select sum(amount_cents) from lines where code = c.code), 0)) order by c.code)
      from public.ledger_codes c where c.direction = 'credit'),
    'debits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents',
        coalesce((select sum(amount_cents) from lines where code = c.code), 0)) order by c.code)
      from public.ledger_codes c where c.direction = 'debit'),
    'receipts_cents', coalesce((select sum(amount_cents) from lines where direction = 'credit'), 0),
    'payments_cents', coalesce((select sum(amount_cents) from lines where direction = 'debit'), 0),
    'opening_cents', (select sum(opening) from fm),
    'closing_cents', (select sum(closing) from fm),
    'float_cents', coalesce((select amount_cents from public.cash_floats where fy <= private.fy_of(p_to) order by fy desc limit 1), 0),
    'months', (select jsonb_agg(jsonb_build_object('month', month, 'from', a, 'to', b,
        'receipts_cents', coalesce((select sum(amount_cents) from lines where direction = 'credit' and entry_on between a and b), 0),
        'payments_cents', coalesce((select sum(amount_cents) from lines where direction = 'debit' and entry_on between a and b), 0))
        order by month) from months),
    'line_count', (select count(*) from lines),
    'last_change_at', (select max(updated_at) from public.ledger_entries where entry_on between p_from and p_to));
$function$
;

CREATE OR REPLACE FUNCTION private.member_can_read_chat(p_member uuid, p_chat uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  was text := current_setting('request.jwt.claim.sub', true);
  ok boolean;
begin
  perform set_config('request.jwt.claim.sub', p_member::text, true);
  begin
    ok := private.chat_problem(p_chat) is null;
  exception when others then
    ok := false;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(was, ''), true);
  return ok;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.merch_item_run(p_item uuid)
 RETURNS merch_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.merch_items;
begin
  select * into i from public.merch_items where id = p_item for update;
  if not found or not private.sees_merch_item(i) then raise exception 'No such item.'; end if;
  perform private.require_scope(i.chapter_id);
  return i;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.merch_order(p_order uuid, OUT o merch_orders, OUT chapter uuid)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  select * into o from public.merch_orders where id = p_order for update;
  if not found or not private.sees_merch_order(o) then raise exception 'No such order.'; end if;
  select chapter_id into chapter from public.merch_items where id = o.item_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.min_quorum(p_electorate electorate, p_electors integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_electorate
    when 'chapter_board' then greatest(3, p_electors / 2 + 1)
    when 'nec' then greatest(1, ceil(p_electors * 51 / 100.0)::int)
    else greatest(1, ceil(p_electors / 3.0)::int)
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.month_report(p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  last_day date := (p_month + interval '1 month' - interval '1 day')::date;
  funds jsonb;
  total bigint;
  fl int := coalesce((select amount_cents from public.cash_floats where fy <= private.fy_of(p_month) order by fy desc limit 1), 0);
begin
  select jsonb_object_agg(coalesce(f.id::text, 'club'), private.fund_balance(f.id, last_day)),
         sum(private.fund_balance(f.id, last_day))
    into funds, total
  from (select null::uuid as id union all select id from public.chapters) f;
  return jsonb_build_object(
    'month', p_month,
    'opening_cents', (select sum(private.balance_before(f.id, p_month))
                      from (select null::uuid as id union all select id from public.chapters) f),
    'credits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents', coalesce(t.cents, 0)) order by c.code)
                from public.ledger_codes c left join (
                  select code, sum(amount_cents) as cents from public.ledger_entries
                  where state = 'paid' and entry_on between p_month and last_day group by code) t on t.code = c.code
                where c.direction = 'credit'),
    'credit_total', coalesce((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_codes c on c.code = e.code
                     where e.state = 'paid' and c.direction = 'credit' and e.entry_on between p_month and last_day), 0),
    'debits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents', coalesce(t.cents, 0)) order by c.code)
               from public.ledger_codes c left join (
                 select code, sum(amount_cents) as cents from public.ledger_entries
                 where state = 'paid' and entry_on between p_month and last_day group by code) t on t.code = c.code
               where c.direction = 'debit'),
    'debit_total', coalesce((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_codes c on c.code = e.code
                    where e.state = 'paid' and c.direction = 'debit' and e.entry_on between p_month and last_day), 0),
    'funds', funds,
    'total_cents', total,
    'float_cents', fl,
    'bank_cents', total - fl,
    'last_change_at', (select max(updated_at) from public.ledger_entries where entry_on between p_month and last_day));
end;
$function$
;

CREATE OR REPLACE FUNCTION private.nec_voter_for(p_chapter uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select member_id from public.positions p
  where p.ended_on is null and p.chapter_id = p_chapter and p.role in ('president', 'vice_president')
    and not (p.role = 'president' and p.member_id in (
      select member_id from public.positions where ended_on is null and role = 'nec_chair'))
  order by p.role = 'vice_president', p.started_on desc limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.new_checkin_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  candidate text;
begin
  loop
    bytes := decode(md5(gen_random_uuid()::text), 'hex');
    candidate := '';
    for i in 0..5 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.checkin_sessions s where s.code = candidate);
  end loop;
  return candidate;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.next_receipt(p_chapter uuid, p_fy integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n int;
  prefix text;
begin
  -- After the highest number already in this book (receipts are never renumbered or reused).
  prefix := (select upper(left(slug, 1)) from public.chapters where id = p_chapter) || lpad((p_fy % 100)::text, 2, '0') || '-';
  perform pg_advisory_xact_lock(hashtext('receipt:' || prefix));
  select coalesce(max(substr(receipt_no, length(prefix) + 1)::int), 0) + 1 into n
  from public.payments where receipt_no like prefix || '%';
  return prefix || lpad(n::text, 4, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION private.open_chapter_proposal(p_id uuid)
 RETURNS chapter_proposals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.chapter_proposals;
begin
  select * into p from public.chapter_proposals where id = p_id for update;
  if not found then raise exception 'No such proposal.'; end if;
  if p.status <> 'proposed' then raise exception 'That proposal is settled.'; end if;
  return p;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.open_contribution(p_id uuid)
 RETURNS national_contributions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k public.national_contributions;
begin
  select * into k from public.national_contributions where id = p_id for update;
  if not found then raise exception 'No such contribution.'; end if;
  if k.status <> 'proposed' then raise exception 'That contribution is settled.'; end if;
  return k;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.opening_on(p_chapter uuid, p_from date)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select amount_cents::bigint from public.fund_openings
     where extract(month from p_from) = 7 and extract(day from p_from) = 1
       and chapter_id is not distinct from p_chapter and fy = private.fy_of(p_from)),
    private.fund_balance(p_chapter, p_from - 1));
$function$
;

CREATE OR REPLACE FUNCTION private.owing(p_charge uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when c.waived_at is not null then 0
              else greatest(0, c.amount_cents - coalesce((
                select sum(amount_cents) from public.payments where charge_id = c.id and state = 'confirmed'), 0))::int
         end
  from public.charges c where c.id = p_charge;
$function$
;

CREATE OR REPLACE FUNCTION private.patch_in_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := private.club_date();
  yr int := private.club_year_of(today);
  r public.fee_rates%rowtype;
  months int;
begin
  if old.status in ('full', 'nomad') or new.approval <> 'approved' or new.on_hiatus then return new; end if;
  select * into r from public.fee_rates where chapter_id = new.chapter_id and fy = yr and status = 'full';
  if not found then return new; end if;
  -- From today: a reinstated member keeps their old patched_on.
  months := private.pro_rata_months(today, yr);
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  values (new.id, new.chapter_id, yr, 'annual', private.pro_rata_note(months), private.pro_rata_cents(r.amount_cents, months),
          greatest(r.due_on, today + 30), auth.uid())
  on conflict (member_id, fy, kind) where kind in ('annual', 'continuation') do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.posting_rules_agreed(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.members where id = p_member and posting_rules_accepted_on is not null);
$function$
;

CREATE OR REPLACE FUNCTION private.pro_rata_cents(p_amount integer, p_months integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_months >= 12 then p_amount else (round(p_amount::numeric * p_months / 12 / 100) * 100)::int end;
$function$
;

CREATE OR REPLACE FUNCTION private.pro_rata_months(p_patched date, p_year integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_patched is null or p_patched <= private.agm_on(p_year)
                   or date_trunc('month', p_patched) = date_trunc('month', private.agm_on(p_year)) then 12
              when p_patched >= private.agm_on(p_year + 1) then 0
              else least(12, greatest(1,
                (extract(year from private.agm_on(p_year + 1))::int * 12 + extract(month from private.agm_on(p_year + 1))::int)
                - (extract(year from p_patched)::int * 12 + extract(month from p_patched)::int)))
         end;
$function$
;

CREATE OR REPLACE FUNCTION private.pro_rata_note(p_months integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_months < 12 then format('Pro rata, %s of 12 months', p_months) end;
$function$
;

CREATE OR REPLACE FUNCTION private.purge_conduct()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from public.conduct_records r where not private.conduct_kept(r);
$function$
;

CREATE OR REPLACE FUNCTION private.purge_url()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select value from private.app_settings where key = 'purge_url';
$function$
;

CREATE OR REPLACE FUNCTION private.push_applicant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.approval <> 'pending' then return new; end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select distinct pos.member_id, 'applicant:' || new.id, 'Waiting for approval',
    new.full_name || ' asked to join ' || c.name, jsonb_build_object('kind', 'applicant', 'memberId', new.id)
  from public.positions pos
  join public.members b on b.id = pos.member_id
  join public.chapters c on c.id = new.chapter_id
  left join public.notification_prefs p on p.member_id = pos.member_id
  where pos.chapter_id = new.chapter_id and pos.ended_on is null and b.approval = 'approved'
    and pos.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    and coalesce(p.approvals, true)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.conversations%rowtype;
  sender public.members%rowtype;
  t text;
  b text;
  who uuid;
begin
  begin
    if new.removed_at is not null then return null; end if;
    select * into c from public.conversations where id = new.conversation_id;
    select * into sender from public.members where id = new.author_id;
    t := private.chat_push_title(c, sender);
    b := private.chat_push_body(new, c, sender);
    for who in
      select distinct d.member_id from public.push_devices d
      where d.member_id <> new.author_id
        and (c.kind <> 'direct' or exists (
          select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.member_id = d.member_id))
        and not private.blocked_between(new.author_id, d.member_id)
        and coalesce((select p.chat_messages from public.notification_prefs p where p.member_id = d.member_id), true)
        -- In the chat just now: they'll see it there.
        and not exists (
          select 1 from public.chat_reads r
          where r.conversation_id = c.id and r.member_id = d.member_id and r.read_at > now() - interval '1 minute')
    loop
      begin
        if private.member_can_read_chat(who, c.id) then
          insert into private.push_outbox (member_id, dedupe_key, title, body, data)
          values (who, 'chat:' || new.id, t, b, jsonb_build_object('kind', 'chat', 'chatId', c.id))
          on conflict (member_id, dedupe_key) do nothing;
        end if;
      exception when others then
        -- One member's problem doesn't cost everyone else the notification.
        raise warning 'chat notification for message % to % not written: %', new.id, who, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'chat notification for message % not written: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select value = 'true' from private.app_settings where key = 'push_enabled'), false);
$function$
;

CREATE OR REPLACE FUNCTION private.push_feedback_answered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.reply_count > old.reply_count and new.reply is not null then
    insert into private.push_outbox (member_id, dedupe_key, title, body, data)
    values (new.member_id, 'feedback-reply:' || new.id || ':' || new.reply_count, 'Reply to your feedback',
            left(new.reply, 80), jsonb_build_object('kind', 'feedback', 'feedbackId', new.id))
    on conflict (member_id, dedupe_key) do nothing;
  elsif new.status = 'done' and old.status <> 'done' then
    insert into private.push_outbox (member_id, dedupe_key, title, body, data)
    values (new.member_id, 'feedback-done:' || new.id, 'Your feedback is marked done',
            left(new.body, 80), jsonb_build_object('kind', 'feedback', 'feedbackId', new.id))
    on conflict (member_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_feedback_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select distinct pos.member_id, 'feedback:' || new.id, 'App feedback',
    who || ': ' || left(new.body, 80), jsonb_build_object('kind', 'feedback-sent', 'feedbackId', new.id)
  from public.positions pos
  join public.members k on k.id = pos.member_id
  left join public.notification_prefs p on p.member_id = pos.member_id
  where pos.ended_on is null and pos.role in ('treasurer', 'nec_chair', 'nec_secretary')
    and k.approval = 'approved' and k.status <> 'family' and pos.member_id <> new.member_id
    and coalesce(p.approvals, true)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_hold_when_off()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.push_enabled() then new.status := 'held'; end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_ride_added()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.cancelled_at is not null or new.starts_at <= now() or new.starts_at > now() + interval '60 days' then
    return new;
  end if;
  -- A calendar event at a new time (or the next of a repeating one) isn't a new ride.
  if new.feed_id is not null and exists (
    select 1 from public.rides x
    where x.feed_id = new.feed_id and x.external_uid = new.external_uid and x.id <> new.id and x.cancelled_at is null
  ) then
    return new;
  end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select m.id, 'ride-new:' || new.id, 'New ride',
    new.title || ' · ' || private.club_day(new.starts_at) ||
      case when new.all_day then '' else ' ' || private.club_time(new.starts_at) end,
    jsonb_build_object('kind', 'ride', 'rideId', new.id)
  from public.members m
  join public.chapters c on c.id = m.chapter_id
  left join public.notification_prefs p on p.member_id = m.id
  where m.approval = 'approved' and coalesce(p.new_rides, false) and m.id is distinct from auth.uid()
    and (new.category in ('club', 'supported') or c.slug = new.category::text)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_ride_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select lr.member_id, 'alert:' || new.id,
    case new.kind
      when 'emergency' then 'EMERGENCY: ' || who || ' needs help'
      when 'out' then who || ' is out of the ride'
      else 'Regroup pin set'
    end,
    'Open live ride', jsonb_build_object('kind', 'live-alert', 'rideId', new.ride_id)
  from public.live_riders lr
  where lr.ride_id = new.ride_id and lr.member_id <> new.member_id and lr.stops_at > now()
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$function$
;

