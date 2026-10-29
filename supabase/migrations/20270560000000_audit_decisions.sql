-- Three of Jeff's decisions from the 29 Oct 2026 launch audit (the report lists them as M3, M6
-- and L5). See docs/superpowers/specs/2026-10-29-audit-decisions-design.md.
--
-- 1. National roles see every chapter's board records but act only where they hold a seat. The
--    board helper splits in two: private.sees_board_of(chapter) is today's meaning (a seated board
--    member of that chapter, or anyone national) and keeps the reads; private.is_board_of(chapter)
--    is the seated board only and keeps the acts. Every policy and helper below says which it is.
-- 2. Open chapter proposals and national contributions are board and NEC business until decided
--    (12.1, 13.6): club_admin() shows an open proposal to chapter boards, national roles, whoever
--    put it forward and the named founders, and an open contribution to boards and national roles.
--    Once decided or withdrawn, everyone sees them.
-- 3. Meeting check-ins are the member's, their chapter board's and the Auditor's (5.5); ride
--    check-ins stay every approved member's, because badges and ride walls are built on them.
--    Hub and charity sign-ups are the member's, the ride's organisers' and the boards'; the numbers
--    stay everyone's through signup_counts().
-- Every rule mirrors src/domain/access.ts, meetings.ts, conduct.ts, national.ts, attendance.ts,
-- hubs.ts and charity.ts, with the same words. Policies are recreated in place; no table changes, no data deleted.
-- Safe to run once; a second Run changes nothing.

-- 1. The board helper, split in two --------------------------------------------------------------

-- Sees a chapter's board records: a seated board member of that chapter, or anyone national.
create or replace function private.sees_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;
revoke all on function private.sees_board_of(uuid) from public, anon;
grant execute on function private.sees_board_of(uuid) to authenticated;

-- Acts as a chapter's board: a seated board member of that chapter (8.2, 12.3).
create or replace function private.is_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
  );
$$;

-- 2. Reads keep the wider reach ------------------------------------------------------------------

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (
  id = (select auth.uid())
  or (approval = 'approved' and private.is_approved_member())
  or private.sees_board_of(chapter_id)
);

drop policy if exists private_read on public.member_private;
create policy private_read on public.member_private for select to authenticated using (
  member_id = (select auth.uid()) or private.sees_board_of(private.chapter_of(member_id))
);

drop policy if exists emergency_read on public.emergency_contacts;
create policy emergency_read on public.emergency_contacts for select to authenticated using (
  member_id = (select auth.uid()) or private.sees_board_of(private.chapter_of(member_id))
);

drop policy if exists bikes_read on public.bikes;
create policy bikes_read on public.bikes for select to authenticated using (
  member_id = (select auth.uid())
  or (private.is_approved(member_id) and private.is_approved_member())
  or private.sees_board_of(private.chapter_of(member_id))
);

drop policy if exists regos_read on public.bike_registrations;
create policy regos_read on public.bike_registrations for select to authenticated using (
  exists (
    select 1 from public.bikes b
    where b.id = bike_id
      and (b.member_id = (select auth.uid()) or private.sees_board_of(private.chapter_of(b.member_id)))
  )
);

drop policy if exists attendance_exemptions_read on public.attendance_exemptions;
create policy attendance_exemptions_read on public.attendance_exemptions for select to authenticated using (
  member_id = auth.uid() or private.sees_board_of(private.chapter_of(member_id))
);

drop policy if exists big4_waivers_read on public.big4_waivers;
create policy big4_waivers_read on public.big4_waivers for select to authenticated using (
  member_id = auth.uid() or private.sees_board_of(private.chapter_of(member_id))
);

drop policy if exists member_decisions_read on public.member_decisions;
create policy member_decisions_read on public.member_decisions for select to authenticated using (
  private.sees_board_of(private.chapter_of(member_id))
);

drop policy if exists status_notices_read on public.status_notices;
create policy status_notices_read on public.status_notices for select to authenticated using (
  member_id = auth.uid() or private.sees_board_of(chapter_id)
);

create or replace function private.sees_conduct(r public.conduct_records)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    r.member_id = auth.uid() or private.sees_board_of(private.conduct_chapter(r))
    or exists (select 1 from public.conduct_appeals a where a.record_id = r.id and auth.uid() = any (a.panel)));
$$;

-- Reads a chapter's membership and attendance records: its board, the national roles, or the Auditor (11.8).
create or replace function private.reviews_chapter(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.sees_board_of(p_chapter) or private.is_auditor();
$$;

create or replace function public.shared_phones()
returns table (member_id uuid, phone text)
language sql stable security definer set search_path = '' as $$
  select mp.member_id, mp.phone
  from public.member_private mp
  join public.members m on m.id = mp.member_id
  where mp.phone is not null
    and (
      mp.member_id = auth.uid()
      or private.sees_board_of(m.chapter_id)
      or (m.share_phone and m.approval = 'approved' and private.is_approved_member())
    );
$$;

-- A board chat is read, and written in, by that board and the national roles, as before.
create or replace function private.chat_problem(p_chat uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
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
$$;

-- A scope's private business (board and NEC meetings, draft minutes, votes, draft merch and its
-- orders) is seen the same way: a chapter's by its board or anyone national, the club's by the NEC.
-- Running a scope (private.runs_scope) stays with the seated board, so it narrows with is_board_of.
create or replace function private.sees_scope(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_chapter is null then private.is_national() else private.sees_board_of(p_chapter) end;
$$;
revoke all on function private.sees_scope(uuid) from public, anon;

create or replace function private.reviews_scope(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.sees_scope(p_chapter) or private.is_auditor();
$$;

create or replace function private.sees_merch_item(i public.merch_items)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (i.status in ('on_sale', 'closed') or private.sees_scope(i.chapter_id));
$$;

create or replace function private.sees_merch_order(o public.merch_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.merch_items i where i.id = o.item_id
      and (o.member_id = auth.uid() or private.sees_scope(i.chapter_id) or private.keeps_books(i.chapter_id)));
$$;

-- 3. Acts say so ---------------------------------------------------------------------------------

-- Bringing someone back to Full or Nomad is a national power (5.6), so the NEC isn't stopped at a
-- board gate it no longer passes; every other status change is the chapter board's.
create or replace function public.set_member_status(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
begin
  if p_member = auth.uid() then raise exception 'You can’t change your own status.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such member.'; end if;
  -- Bringing an approved Supporter, Family or Legacy member back to Full or Nomad is the NEC's (5.6);
  -- every other change, an applicant's approval first of all, is their chapter board's (8.2).
  if p_status in ('full', 'nomad') and target.status not in ('full', 'nomad', 'fng') and target.approval = 'approved' then
    if not private.is_national() then raise exception 'Only the NEC can bring someone back to Full or Nomad (5.6).'; end if;
    if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
    if not private.has_carried_reinstate_vote(p_member) then
      raise exception 'Coming back to Full or Nomad needs a carried NEC vote (5.6).';
    end if;
  else
    if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can change this member’s status.'; end if;
    if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
    if p_status in ('full', 'nomad') and target.status = 'fng' and not private.has_carried_patch_vote(p_member) then
      raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
    end if;
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  if p_status not in ('full', 'nomad') and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null and role <> 'founder'
  ) then
    raise exception 'End their positions first.';
  end if;
  if p_status = 'nomad' and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                   'nec_chair', 'nec_secretary', 'nec_auditor')
  ) then
    raise exception 'End their board and national seats first (9.1).';
  end if;

  update public.members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    on_hiatus = case when p_status = 'legacy' then false else on_hiatus end,
    updated_at = now()
  where id = p_member;
end;
$$;


create or replace function private.conduct_board_record(p_id uuid)
returns public.conduct_records language plpgsql stable security definer set search_path = '' as $$
declare r public.conduct_records := private.conduct_record(p_id);
begin
  if not private.is_board_of(private.conduct_chapter(r)) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if r.member_id = auth.uid() then raise exception 'You can’t record one about yourself.'; end if;
  return r;
end;
$$;

create or replace function public.record_conduct(
  p_member uuid, p_kind text, p_summary text, p_rule text, p_decided date, p_notice date, p_suspended date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  m public.members;
  s text := private.trim_like_app(coalesce(p_summary, ''));
  ru text := private.trim_like_app(coalesce(p_rule, ''));
  susp date := case when p_kind = 'suspension' then p_suspended end;
  today date := private.club_date();
  new_id uuid;
begin
  perform private.purge_conduct();
  select * into m from public.members where id = p_member;
  if not found or m.approval <> 'approved' then raise exception 'Pick an approved member.'; end if;
  if m.id = me then raise exception 'You can’t record one about yourself.'; end if;
  if not private.is_board_of(m.chapter_id) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if p_kind is null or p_kind not in ('vest', 'ride_safety', 'attendance', 'other', 'reprimand', 'suspension', 'expulsion') then
    raise exception 'Pick what kind of record it is.';
  end if;
  if s = '' then raise exception 'Say what happened.'; end if;
  if char_length(s) > 1000 then raise exception 'Keep what happened to 1000 characters at most.'; end if;
  if char_length(ru) > 200 then raise exception 'Keep the rule to 200 characters at most.'; end if;
  if p_decided is null then raise exception 'Pick the date of the decision.'; end if;
  if p_decided > today then raise exception 'The decision can’t be in the future.'; end if;
  if p_kind = 'suspension' and (susp is null or susp <= p_decided) then raise exception 'Pick when the suspension ends.'; end if;
  if today >= private.conduct_delete_on(p_decided, susp, null) then
    raise exception 'That decision is more than 12 months old, so it isn’t kept.';
  end if;
  if not private.conduct_formal(p_kind) then
    if p_notice is null then raise exception 'Pick when written notice was given.'; end if;
    if p_notice < p_decided then raise exception 'Written notice can’t come before the decision.'; end if;
    if p_notice > today then raise exception 'Written notice can’t be in the future.'; end if;
  end if;
  insert into public.conduct_records (member_id, chapter_id, kind, summary, rule, decided_on, notice_on, suspended_until, recorded_by)
  values (m.id, m.chapter_id, p_kind, s, nullif(ru, ''), p_decided,
          case when private.conduct_formal(p_kind) then p_decided else p_notice end, susp, me)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.set_conduct_hearing(p_record uuid, p_panel uuid[], p_hearing date)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); a public.conduct_appeals; r public.conduct_records;
begin
  perform private.purge_conduct();
  a := private.conduct_open_appeal(p_record);
  select * into r from public.conduct_records where id = a.record_id;
  if not private.is_board_of(private.conduct_chapter(r)) or me = r.member_id or me = r.recorded_by then
    raise exception 'Only the board, apart from whoever recorded it, can set up the hearing.';
  end if;
  if coalesce(cardinality(p_panel), 0) <> 3 or (select count(distinct x) from unnest(p_panel) x) <> 3 then
    raise exception 'Pick three different people.';
  end if;
  if (select count(*) from public.members where id = any (p_panel) and approval = 'approved' and status <> 'legacy') <> 3 then
    raise exception 'Pick approved members for the panel.';
  end if;
  if r.member_id = any (p_panel) or (r.recorded_by is not null and r.recorded_by = any (p_panel)) then
    raise exception 'The panel can’t include the member or whoever recorded it.';
  end if;
  if p_hearing is null or p_hearing < a.lodged_on then raise exception 'Pick the hearing date.'; end if;
  update public.conduct_appeals set panel = p_panel, hearing_on = p_hearing where record_id = r.id;
end;
$$;

-- 4. Open proposals and contributions are board and NEC business (M6) -----------------------------

create or replace function public.club_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_approved_member() then
    return jsonb_build_object('conduct', '[]'::jsonb, 'merch_items', '[]'::jsonb, 'merch_orders', '[]'::jsonb,
      'contributions', '[]'::jsonb, 'chapter_proposals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'conduct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'member_id', r.member_id, 'chapter_id', r.chapter_id, 'kind', r.kind, 'summary', r.summary, 'rule', r.rule,
        'decided_on', r.decided_on, 'notice_on', r.notice_on, 'suspended_until', r.suspended_until, 'recorded_by', r.recorded_by,
        'recorded_at', r.recorded_at, 'hold_until', r.hold_until, 'hold_reason', r.hold_reason,
        'appeal', (select jsonb_build_object(
            'lodged_on', a.lodged_on, 'lodged_by', a.lodged_by, 'grounds', a.grounds, 'panel', to_jsonb(a.panel),
            'hearing_on', a.hearing_on, 'outcome', a.outcome, 'outcome_note', a.outcome_note, 'decided_on', a.decided_on,
            'decided_by', a.decided_by, 'withdrawn_on', a.withdrawn_on)
          from public.conduct_appeals a where a.record_id = r.id)
        ) order by r.decided_on desc, r.recorded_at desc)
      from public.conduct_records r where private.conduct_kept(r) and private.sees_conduct(r)), '[]'::jsonb),
    'merch_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'chapter_id', i.chapter_id, 'name', i.name, 'details', i.details, 'sizes', to_jsonb(i.sizes),
        'price_cents', i.price_cents, 'patched_only', i.patched_only, 'status', i.status, 'proposed_by', i.proposed_by,
        'proposed_at', i.proposed_at, 'decided_by', i.decided_by, 'decided_at', i.decided_at, 'decline_reason', i.decline_reason
        ) order by i.proposed_at desc)
      from public.merch_items i where private.sees_merch_item(i) or private.is_auditor()), '[]'::jsonb),
    'merch_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'item_id', o.item_id, 'member_id', o.member_id, 'size', o.size, 'qty', o.qty, 'unit_cents', o.unit_cents,
        'note', o.note, 'status', o.status, 'ordered_at', o.ordered_at, 'decided_by', o.decided_by, 'decided_at', o.decided_at,
        'decline_reason', o.decline_reason, 'paid_on', o.paid_on, 'ledger_entry_id', o.ledger_entry_id, 'handed_over_on', o.handed_over_on
        ) order by o.ordered_at desc)
      from public.merch_orders o where private.sees_merch_order(o) or private.is_auditor()), '[]'::jsonb),
    'contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'title', k.title, 'purpose', k.purpose, 'total_cents', k.total_cents, 'status', k.status,
        'proposed_by', k.proposed_by, 'proposed_at', k.proposed_at, 'settled_at', k.settled_at, 'shares', k.shares,
        'decisions', (select coalesce(jsonb_agg(jsonb_build_object('chapter_id', d.chapter_id, 'yes', d.yes, 'vote_id', d.vote_id,
                        'recorded_by', d.recorded_by, 'recorded_at', d.recorded_at) order by d.recorded_at), '[]'::jsonb)
                      from public.contribution_decisions d where d.contribution_id = k.id)
        ) order by k.proposed_at desc)
      from public.national_contributions k where k.status <> 'proposed' or private.is_any_board()), '[]'::jsonb),
    'chapter_proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'area', p.area, 'state', p.state, 'plan', p.plan, 'founder_ids', to_jsonb(p.founder_ids),
        'president_id', p.president_id, 'saa_id', p.saa_id, 'status', p.status, 'proposed_by', p.proposed_by,
        'proposed_at', p.proposed_at, 'vote_id', p.vote_id, 'decided_by', p.decided_by, 'decided_at', p.decided_at,
        'chapter_id', p.chapter_id
        ) order by p.proposed_at desc)
      from public.chapter_proposals p
      where p.status <> 'proposed' or private.is_any_board() or p.proposed_by = auth.uid() or auth.uid() = any (p.founder_ids)
      ), '[]'::jsonb));
end;
$function$;

-- 5. Attendance and sign-ups (L5) ----------------------------------------------------------------

-- A meeting check-in is the member's, their chapter board's (and the national roles') and the
-- Auditor's (see attendance_auditor_read); a ride check-in is every approved member's.
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated using (
  member_id = auth.uid()
  or private.sees_board_of(private.chapter_of(member_id))
  or (
    private.is_approved_member() and private.is_approved(member_id)
    and exists (select 1 from public.checkin_sessions s where s.id = session_id and s.kind = 'ride')
  )
);

-- A sign-up is the member's, the ride's organisers' and the boards'.
grant execute on function private.runs_charity(uuid) to authenticated;

drop policy if exists hub_registrations_for_members on public.hub_registrations;
create policy hub_registrations_for_members on public.hub_registrations for select to authenticated using (
  private.is_approved_member() and (
    member_id = auth.uid() or private.manages_ride(ride_id) or private.sees_board_of(private.chapter_of(member_id))
  )
);

drop policy if exists charity_signups_for_members on public.charity_signups;
create policy charity_signups_for_members on public.charity_signups for select to authenticated using (
  private.is_approved_member() and (
    member_id = auth.uid() or private.runs_charity(ride_id) or private.sees_board_of(private.chapter_of(member_id))
  )
);

-- The numbers for everyone approved: each ride's hub registrations and charity sign-ups that
-- haven't been withdrawn, counted the way the app counts them (hubCounts, groupBedsTaken, charityCounts).
create or replace function public.signup_counts()
returns table (
  ride_id uuid, hub_riders int, hub_pillions int, hub_group int, hub_own int, hub_camping int, hub_day int, hub_group_beds int,
  charity_riding int, charity_pillions int, charity_guests int, charity_helping int, charity_people int
)
language sql stable security definer set search_path = '' as $$
  with hubs as (
    select h.ride_id,
      count(*)::int as riders,
      count(*) filter (where h.pillion)::int as pillions,
      count(*) filter (where h.staying = 'group')::int as grp,
      count(*) filter (where h.staying = 'own')::int as own,
      count(*) filter (where h.staying = 'camping')::int as camping,
      count(*) filter (where h.staying = 'day')::int as day,
      coalesce(sum(case when h.staying = 'group' then 1 + (case when h.pillion then 1 else 0 end) else 0 end), 0)::int as group_beds
    from public.hub_registrations h where h.withdrawn_at is null group by h.ride_id
  ), charity as (
    select c.ride_id,
      count(*) filter (where c.riding)::int as riding,
      count(*) filter (where c.pillion)::int as pillions,
      coalesce(sum(c.guests), 0)::int as guests,
      count(*) filter (where c.job is not null)::int as helping,
      coalesce(sum((case when c.riding then 1 else 0 end) + (case when c.pillion then 1 else 0 end) + c.guests), 0)::int as people
    from public.charity_signups c where c.withdrawn_at is null group by c.ride_id
  )
  select coalesce(h.ride_id, c.ride_id),
    coalesce(h.riders, 0), coalesce(h.pillions, 0), coalesce(h.grp, 0), coalesce(h.own, 0), coalesce(h.camping, 0), coalesce(h.day, 0),
    coalesce(h.group_beds, 0),
    coalesce(c.riding, 0), coalesce(c.pillions, 0), coalesce(c.guests, 0), coalesce(c.helping, 0), coalesce(c.people, 0)
  from hubs h full join charity c on c.ride_id = h.ride_id
  where private.is_approved_member();
$$;
revoke all on function public.signup_counts() from public, anon;
grant execute on function public.signup_counts() to authenticated;
