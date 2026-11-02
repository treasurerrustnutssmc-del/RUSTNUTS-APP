-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the public schema (these are callable through the API as RPCs if granted; see 02 for grants).
-- Part 2 of 5.

CREATE OR REPLACE FUNCTION public.create_document(p_chapter uuid, p_kind text, p_title text, p_asks_sign_off boolean, p_review_months integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); title text := coalesce(private.trim_like_app(p_title), ''); new_id uuid;
begin
  perform private.require_scope(p_chapter);
  if p_kind is null or p_kind not in ('registered_rules', 'constitution', 'policy', 'procedure') then
    raise exception 'Pick what kind of document it is.';
  end if;
  if p_kind in ('registered_rules', 'constitution') and p_chapter is not null then
    raise exception 'The Registered Rules and the Constitution are club-wide documents.';
  end if;
  if p_kind in ('registered_rules', 'constitution') and exists (select 1 from public.documents where kind = p_kind) then
    raise exception 'The library already has that document. Publish a new version of it instead.';
  end if;
  if title = '' then raise exception 'Give the document a title.'; end if;
  if char_length(title) > 120 then raise exception 'Keep the title to 120 characters at most.'; end if;
  if p_review_months is not null and (p_review_months < 1 or p_review_months > 60) then
    raise exception 'Pick a review cycle from 1 to 60 months, or none.';
  end if;
  begin
    insert into public.documents (chapter_id, kind, title, asks_sign_off, review_months, created_by)
    values (p_chapter, p_kind, title, coalesce(p_asks_sign_off, false), p_review_months, me)
    returning id into new_id;
  exception when unique_violation then
    -- Two people adding the Constitution (or Registered Rules) at once: the second gets the same refusal.
    raise exception 'The library already has that document. Publish a new version of it instead.';
  end;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_application(p_member uuid, p_status member_status, p_for integer, p_against integer, p_abstained integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.members%rowtype;
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then
    if p_status is null then raise exception 'Only that chapter’s board can decline this applicant.'; end if;
    raise exception 'Only the % board can approve this applicant.', (select name from public.chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  if p_status is not null and p_status not in ('introduced', 'fng', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Supporter or Family.';
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  perform private.check_votes(p_for, p_against, p_abstained);

  if p_status is null then
    perform public.decline_member(p_member);
  else
    perform public.approve_member(p_member, p_status);
  end if;
  insert into public.member_decisions (member_id, kind, outcome, status, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'application', case when p_status is null then 'declined' else 'approved' end, p_status,
          p_for, p_against, p_abstained, nullif(trim(p_note), ''), private.club_date(), auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_bus(p_booking uuid, p_yes boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  b public.bus_bookings%rowtype;
  clean_reason text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.manages_bus() then
    raise exception 'Only the board or NEC can say yes or no to Rusty Bus bookings.';
  end if;
  select * into b from public.bus_bookings where id = p_booking for update;
  if not found then raise exception 'No such booking.'; end if;
  if b.status <> 'requested' then raise exception 'That booking has already been decided.'; end if;
  if b.last_day < private.club_date() then raise exception 'That booking’s days have passed.'; end if;

  if p_yes is true then
    if private.bus_clashes(b.first_day, b.last_day, b.id) then
      raise exception 'The Rusty Bus is already booked then.';
    end if;
    update public.bus_bookings
    set status = 'approved', decided_by = me, decided_at = now(), decline_reason = null
    where id = b.id;
  else
    clean_reason := nullif(private.trim_like_app(p_reason), '');
    if char_length(clean_reason) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
    update public.bus_bookings
    set status = 'declined', decided_by = me, decided_at = now(), decline_reason = clean_reason
    where id = b.id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_conduct_appeal(p_record uuid, p_outcome text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); a public.conduct_appeals; r public.conduct_records;
  n text := private.trim_like_app(coalesce(p_note, ''));
begin
  perform private.purge_conduct();
  a := private.conduct_open_appeal(p_record);
  select * into r from public.conduct_records where id = a.record_id;
  if not (me = any (a.panel)) or a.hearing_on is null then raise exception 'Only the hearing panel can record the outcome.'; end if;
  if private.club_date() < a.hearing_on then raise exception 'Wait until the hearing.'; end if;
  if p_outcome is null or p_outcome not in ('confirmed', 'varied', 'set_aside') then raise exception 'Pick an outcome.'; end if;
  if p_outcome = 'varied' and private.conduct_formal(r.kind) then raise exception 'A formal appeal is upheld or revoked (14.6).'; end if;
  if p_outcome = 'varied' and n = '' then raise exception 'Say how it was varied.'; end if;
  if char_length(n) > 1000 then raise exception 'Keep it to 1000 characters at most.'; end if;
  if p_outcome = 'set_aside' then
    delete from public.conduct_records where id = r.id;
    return;
  end if;
  update public.conduct_appeals set outcome = p_outcome, outcome_note = nullif(n, ''), decided_on = private.club_date(), decided_by = me
  where record_id = r.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_contribution(p_id uuid, p_chapter uuid, p_vote uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); k public.national_contributions := private.open_contribution(p_id);
  v public.votes; n int; yes_n int; no_n int;
begin
  if not exists (select 1 from jsonb_array_elements(k.shares) e where e->>'chapter_id' = p_chapter::text)
     or not private.holds_board_seat(p_chapter) then
    raise exception 'Only that chapter’s board can record its decision.';
  end if;
  if exists (select 1 from public.contribution_decisions where contribution_id = k.id and chapter_id = p_chapter) then
    raise exception 'That chapter has already decided.';
  end if;
  select * into v from public.votes where id = p_vote and chapter_id = p_chapter and electorate = 'chapter_board'
    and closed_at is not null and opened_at > k.proposed_at and not private.vote_used(id);
  if not found then raise exception 'Pick that chapter board’s closed vote on it (13.6).'; end if;
  insert into public.contribution_decisions (contribution_id, chapter_id, yes, vote_id, recorded_by)
  values (k.id, p_chapter, v.result = 'carried', v.id, me);
  n := jsonb_array_length(k.shares);
  select count(*) filter (where yes), count(*) filter (where not yes) into yes_n, no_n
  from public.contribution_decisions where contribution_id = k.id;
  if yes_n * 2 > n then
    update public.national_contributions set status = 'approved', settled_at = now() where id = k.id;
  elsif no_n * 2 >= n then
    update public.national_contributions set status = 'not_approved', settled_at = now() where id = k.id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_merch(p_item uuid, p_yes boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); i public.merch_items := private.merch_item_run(p_item);
  why text := private.trim_like_app(coalesce(p_reason, ''));
begin
  if i.status <> 'proposed' then raise exception 'That item has already been decided.'; end if;
  if p_yes and i.proposed_by = me then raise exception 'Someone other than whoever put it up approves it (15.1).'; end if;
  if not p_yes and char_length(why) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
  update public.merch_items set status = case when p_yes then 'on_sale' else 'declined' end, decided_by = me, decided_at = now(),
    decline_reason = case when p_yes then null else nullif(why, '') end
  where id = i.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_merch_order(p_order uuid, p_yes boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); f record;
  why text := private.trim_like_app(coalesce(p_reason, ''));
begin
  select * into f from private.merch_order(p_order);
  perform private.require_scope(f.chapter);
  if (f.o).status <> 'waiting' then raise exception 'That order has already been decided.'; end if;
  if (f.o).member_id = me then raise exception 'Someone else approves your own order.'; end if;
  if not p_yes and char_length(why) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
  update public.merch_orders set status = case when p_yes then 'approved' else 'declined' end, decided_by = me, decided_at = now(),
    decline_reason = case when p_yes then null else nullif(why, '') end
  where id = (f.o).id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decline_member(p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.members%rowtype;
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can decline this applicant.'; end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  update public.members set approval = 'declined', updated_at = now() where id = p_member;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_audit_report(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.audit_draft(p_id);
  delete from public.audit_reports where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_meeting_report(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_books(null);
  if not exists (select 1 from public.treasurer_meeting_reports where id = p_id) then raise exception 'No such report.'; end if;
  delete from public.treasurer_meeting_reports where id = p_id and presented_at is null;
  if not found then raise exception 'That report is presented and can’t be changed.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if exists (
    select 1 from public.positions
    where member_id = me and ended_on is null
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                   'nec_chair', 'nec_secretary', 'nec_auditor')
  ) then
    raise exception 'Step down from your seat first, so the club can fill it. Then you can delete your account.';
  end if;
  delete from auth.users where id = me; -- the trigger forgets the member
end $function$
;

CREATE OR REPLACE FUNCTION public.designate_big4(p_ride uuid, p_chapter uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ride public.rides%rowtype;
begin
  if not private.can_designate_big4() then raise exception 'Only the NEC designates Big 4 rides (5.11).'; end if;
  select * into ride from public.rides where id = p_ride for update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if ride.category::text not in ('club', 'north', 'west') then
    raise exception 'Big 4 rides are Club-only: pick a club, North or West ride.';
  end if;
  if private.club_date(ride.starts_at) <= private.club_date() then
    raise exception 'A Big 4 is designated before the ride, not after (5.11).';
  end if;
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  insert into public.big4_rides (ride_id, chapter_id, designated_by) values (p_ride, p_chapter, auth.uid())
  on conflict (ride_id) do update set chapter_id = excluded.chapter_id, designated_by = excluded.designated_by, designated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.document_body(p_version uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select v.body from public.document_versions v join public.documents d on d.id = v.document_id
  where v.id = p_version and private.reads_document(d.kind);
$function$
;

CREATE OR REPLACE FUNCTION public.end_position(p_position uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  pos public.positions%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into pos from public.positions where id = p_position for update;
  if not found then raise exception 'That position no longer exists.'; end if;
  if pos.ended_on is not null then raise exception 'That term has already ended.'; end if;
  if pos.role = 'founder' then raise exception 'Founder is an honour the club’s admin records.'; end if;
  if pos.role = 'nec_chair' then
    raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
  end if;

  -- Anyone can step down from their own role. Ending someone else's takes the right standing and,
  -- for a chapter role, a carried removal vote (9.3).
  if pos.member_id <> me then
    if pos.chapter_id is null then
      if not private.is_chairman() then raise exception 'Only the National Chairman can end a national role.'; end if;
    elsif pos.role = 'president' then
      if not (private.is_board_of(pos.chapter_id) or private.is_nec_officer()) then
        raise exception 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.';
      end if;
      if not private.has_carried_removal_vote(p_position) then
        raise exception 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
      end if;
    else
      if not private.is_board_of(pos.chapter_id) then raise exception 'Only that chapter’s board can end this term.'; end if;
      if not private.has_carried_removal_vote(p_position) then
        if pos.role in ('vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
          raise exception 'Removing a board member needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
        end if;
        raise exception 'Ending someone’s chapter role needs a carried majority vote of the chapter board in the last 90 days (9.3).';
      end if;
    end if;
  end if;

  update public.positions
  set ended_on = greatest(private.club_date(), pos.started_on), ended_by = me
  where id = p_position;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.family_rides()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.forget_push_device(p_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from public.push_devices where token = p_token and member_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.give_status_notice(p_member uuid, p_about text, p_record text, p_proposal text, p_respond_by date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  rec text := private.trim_like_app(coalesce(p_record, ''));
  prop text := private.trim_like_app(coalesce(p_proposal, ''));
  new_id uuid;
begin
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only their chapter’s board can give them notice (5.5).'; end if;
  if p_member = me then raise exception 'Someone else on the board has to give you notice.'; end if;
  if target.approval <> 'approved' or target.status not in ('fng', 'full', 'nomad', 'supporter') then
    raise exception 'Notice is for FNGs, Full Members, Nomads and Supporters.';
  end if;
  if p_about is null or p_about not in ('attendance', 'dues') then raise exception 'Say what it’s about: attendance or dues.'; end if;
  if rec = '' then raise exception 'Set out the record.'; end if;
  if char_length(rec) > 2000 then raise exception 'Keep the record under 2000 characters.'; end if;
  if prop = '' then raise exception 'Say what’s proposed.'; end if;
  if char_length(prop) > 500 then raise exception 'Keep the proposal under 500 characters.'; end if;
  if p_respond_by is null then raise exception 'Pick a real date.'; end if;
  if p_respond_by < private.club_date() + 14 then raise exception 'Give them at least 14 days to respond (5.5).'; end if;
  if exists (select 1 from public.status_notices where member_id = p_member and about = p_about and outcome is null) then
    raise exception 'They already have an open notice about that.';
  end if;
  begin
    insert into public.status_notices (member_id, chapter_id, about, record, proposal, respond_by, given_by)
    values (p_member, target.chapter_id, p_about, rec, prop, p_respond_by, me)
    returning id into new_id;
  exception when unique_violation then
    -- Someone else on the board gave one at the same moment.
    raise exception 'They already have an open notice about that.';
  end;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hand_bus_keys(p_to uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.bus_hand() then
    raise exception 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  end if;
  if p_to is null or not exists (select 1 from public.members where id = p_to and approval = 'approved') then
    raise exception 'Pick someone who’s an approved member.';
  end if;
  if private.bus_key_holder() is not distinct from p_to then raise exception 'They already have the keys.'; end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;

  -- The clock, not the transaction's start, so two handovers in one transaction still have an order.
  insert into public.bus_key_handovers (to_id, note, logged_by, logged_at)
  values (p_to, clean_note, me, clock_timestamp()) returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hand_over_merch_order(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f record;
begin
  perform private.require_member();
  select * into f from private.merch_order(p_order);
  perform private.require_scope(f.chapter);
  if (f.o).status <> 'paid' then raise exception 'Mark it paid first.'; end if;
  update public.merch_orders set status = 'handed_over', handed_over_on = private.club_date() where id = (f.o).id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hand_over_shop_order(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.shop_orders;
begin
  perform private.require_member();
  o := private.shop_order(p_order);
  if not private.runs_shop() then raise exception 'Only the people who run the shop can do that.'; end if;
  if o.status <> 'paid' then raise exception 'Mark it paid first.'; end if;
  update public.shop_orders set status = case when o.delivery = 'ship' then 'posted' else 'collected' end,
    handed_over_on = private.club_date() where id = o.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_site_enquiry(p_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.site_enquiries%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can see website enquiries.'; end if;
  select * into e from public.site_enquiries where id = p_id for update;
  if not found or not private.sees_site_enquiry(e.chapter_slug) then raise exception 'No such enquiry.'; end if;
  if e.handled_at is not null then raise exception 'That enquiry has already been handled.'; end if;
  if length(v_note) > 300 then raise exception 'Keep the note to 300 characters.'; end if;
  update public.site_enquiries
  set handled_at = now(), handled_by = auth.uid(), note = v_note
  where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hold_conduct(p_record uuid, p_until date, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare why text := private.trim_like_app(coalesce(p_reason, '')); r public.conduct_records;
begin
  perform private.require_member();
  perform private.purge_conduct();
  r := private.conduct_board_record(p_record);
  if p_until is null then
    update public.conduct_records set hold_until = null, hold_reason = null where id = r.id;
    return;
  end if;
  if why = '' then raise exception 'Say which matter needs it kept.'; end if;
  if char_length(why) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
  if p_until <= private.club_date() then raise exception 'Pick a date after today.'; end if;
  if p_until > (private.club_date() + interval '84 months')::date then raise exception 'Hold it at most 7 years.'; end if;
  update public.conduct_records set hold_until = p_until, hold_reason = why where id = r.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invite_club(p_ride uuid, p_club uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  r public.rides%rowtype;
  c_note text := nullif(private.trim_like_app(p_note), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.rides where id = p_ride;
  if not found then raise exception 'No such ride.'; end if;
  if r.category not in ('north', 'west', 'club') then raise exception 'Only the club’s own rides can go out as invites.'; end if;
  if r.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if private.ride_last_day(r) < private.club_date() then raise exception 'That ride has been and gone.'; end if;
  if not private.manages_ride(p_ride) then
    raise exception 'Only the ride’s board or Ride Committee can invite other clubs.';
  end if;
  perform private.check_club_on_list(p_club);
  if exists (select 1 from public.club_invites
             where direction = 'out' and ride_id = p_ride and club_id = p_club and archived_at is null) then
    raise exception 'That club has already been invited to this ride.';
  end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  begin
    insert into public.club_invites (direction, club_id, chapter_id, ride_id, note, added_by)
    values ('out', p_club,
            (select c.id from public.chapters c where r.category in ('north', 'west') and c.slug = r.category::text),
            p_ride, c_note, me)
    returning id into new_id;
  exception when unique_violation then
    raise exception 'That club has already been invited to this ride.';
  end;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_approved_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'family');
$function$
;

CREATE OR REPLACE FUNCTION public.issue_audit_report(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.audit_draft(p_id);
  update public.audit_reports set issued_at = now() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.leave_crew(p_ride uuid, p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  first_day_end timestamptz;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The ride row first, the same lock as set_crew and set_rsvp take (see set_crew).
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  first_day_end := ((date(ride.starts_at at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
  if now() >= first_day_end then raise exception 'The crew can’t change after the ride day.'; end if;

  if p_member is distinct from me and not private.manages_ride(p_ride) then
    raise exception 'Only the board or ride committee can take someone else off the crew.';
  end if;
  delete from public.ride_crew where ride_id = p_ride and member_id = p_member;
  if not found then raise exception 'They’re not on the crew.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.link_preview(p_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  kept private.link_previews%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into kept from private.link_previews where url = p_url and fetched_at > now() - interval '7 days';
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'preview', kept.preview);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_app_feedback()
 RETURNS TABLE(id uuid, member_id uuid, member_name text, member_email text, kind text, body text, where_in_app text, screenshot_path text, app_version text, build text, device text, status text, reply text, replied_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select f.id, f.member_id, m.full_name, case when private.is_feedback_keeper() then mp.email end,
         f.kind, f.body, f.where_in_app, f.screenshot_path, f.app_version, f.build, f.device, f.status, f.reply,
         f.replied_at, f.created_at
  from public.app_feedback f
  join public.members m on m.id = f.member_id
  left join public.member_private mp on mp.member_id = f.member_id
  where f.member_id = auth.uid() or private.is_feedback_keeper()
  order by case f.status when 'new' then 0 when 'looking' then 1 else 2 end, f.created_at desc, f.id;
$function$
;

CREATE OR REPLACE FUNCTION public.list_site_enquiries()
 RETURNS SETOF site_enquiries
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from public.site_enquiries
  order by (handled_at is not null), created_at desc, id;
$function$
;

CREATE OR REPLACE FUNCTION public.list_site_news()
 RETURNS SETOF site_news
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from public.site_news
  order by (removed_at is not null), created_at desc, id;
$function$
;

CREATE OR REPLACE FUNCTION public.list_site_photos()
 RETURNS SETOF site_photos
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from public.site_photos
  order by case status when 'live' then 0 else 1 end, picked_at desc, id;
$function$
;

CREATE OR REPLACE FUNCTION public.list_sponsors()
 RETURNS TABLE(id uuid, name text, blurb text, url text, deal text, logo_path text, chapter_id uuid, added_by uuid, archived_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.id, s.name, s.blurb, s.url,
         case when private.is_approved_member() then s.deal end,
         s.logo_path, s.chapter_id,
         case when private.is_any_board() then s.added_by end,
         s.archived_at
  from public.sponsors s
  where s.archived_at is null or private.is_any_board()
  order by s.name;
$function$
;

CREATE OR REPLACE FUNCTION public.live_ride_state(p_ride uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  leader boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
  leader := private.is_ride_leader(me);
  return (
    with open_emergency as (
      select distinct member_id from public.ride_alerts
      where ride_id = p_ride and kind = 'emergency' and resolved_at is null
    ),
    riders as (
      select lr.*, coalesce(m.road_name, split_part(m.full_name, ' ', 1)) as name, private.is_ride_leader(lr.member_id) as is_leader,
             mp.phone as raw_phone
      from public.live_riders lr
      join public.members m on m.id = lr.member_id
      left join public.member_private mp on mp.member_id = lr.member_id
      where lr.ride_id = p_ride and lr.stops_at > now()
    ),
    alerts as (
      select a.*, coalesce(m.road_name, split_part(m.full_name, ' ', 1)) as name, mp.phone as raw_phone
      from public.ride_alerts a
      join public.members m on m.id = a.member_id
      left join public.member_private mp on mp.member_id = a.member_id
      where a.ride_id = p_ride and (a.resolved_at is null or a.resolved_at > now() - interval '10 minutes')
    )
    select jsonb_build_object(
      'me', (select jsonb_build_object('stops_at', stops_at) from riders where member_id = me),
      'riders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'member_id', r.member_id, 'name', r.name, 'leader', r.is_leader, 'lat', r.lat, 'lng', r.lng,
          'accuracy_m', r.accuracy_m, 'updated_at', r.updated_at,
          'phone', case when r.is_leader or (leader and r.member_id in (select member_id from open_emergency))
                        then r.raw_phone end
        ) order by r.name) from riders r), '[]'::jsonb),
      'alerts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'ride_id', a.ride_id, 'member_id', a.member_id, 'kind', a.kind, 'name', a.name,
          'lat', a.lat, 'lng', a.lng, 'created_at', a.created_at, 'resolved_at', a.resolved_at,
          'phone', case when leader and a.kind in ('emergency', 'out') and a.resolved_at is null then a.raw_phone end
        ) order by a.created_at desc) from alerts a), '[]'::jsonb),
      'contacts', case when leader then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'member_id', c.member_id, 'name', c.name, 'relationship', c.relationship, 'phone', c.phone
        ) order by c.created_at) from public.emergency_contacts c
        where c.member_id in (select member_id from open_emergency)), '[]'::jsonb) else '[]'::jsonb end
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lodge_conduct_appeal(p_record uuid, p_grounds text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  why text := private.trim_like_app(coalesce(p_grounds, ''));
  r public.conduct_records;
  due date;
begin
  perform private.purge_conduct();
  r := private.conduct_record(p_record);
  if me <> r.member_id and not private.is_board_of(private.conduct_chapter(r)) then
    raise exception 'Only the member or their board can lodge this.';
  end if;
  if exists (select 1 from public.conduct_appeals where record_id = r.id) then
    raise exception 'A review or appeal has already been lodged.';
  end if;
  if why = '' then raise exception 'Say why.'; end if;
  if char_length(why) > 1000 then raise exception 'Keep it to 1000 characters at most.'; end if;
  due := case when private.conduct_formal(r.kind) then r.decided_on + 7 else r.notice_on + 14 end;
  if private.club_date() > due then raise exception 'The window closed on %.', to_char(due, 'DD/MM/YYYY'); end if;
  insert into public.conduct_appeals (record_id, lodged_on, lodged_by, grounds) values (r.id, private.club_date(), me, why);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_bus_cost(p_on date, p_kind bus_cost_kind, p_cents integer, p_litres numeric, p_booking uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  litres numeric := round(p_litres, 2);
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.bus_hand() then
    raise exception 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  end if;
  if p_on is null or p_on > private.club_date() then raise exception 'Pick the day, today or earlier.'; end if;
  if p_kind is null then raise exception 'Pick what it was for.'; end if;
  if p_cents is null or p_cents < 1 or p_cents > 10000000 then raise exception 'Enter an amount from $0.01 to $100,000.'; end if;
  if litres is not null then
    if p_kind <> 'fuel' then raise exception 'Only fuel takes litres.'; end if;
    if litres <= 0 or litres > 1000 then raise exception 'Litres: more than 0, up to 1000.'; end if;
  end if;
  if p_booking is not null and not exists (select 1 from public.bus_bookings where id = p_booking and status = 'approved') then
    raise exception 'Pick a Booked booking.';
  end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;

  insert into public.bus_costs (spent_on, kind, amount_cents, litres, booking_id, note, logged_by)
  values (p_on, p_kind, p_cents, litres, p_booking, clean_note, me) returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_bus_km(p_km integer, p_on date, p_booking uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.bus_hand() then
    raise exception 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  end if;
  if p_on is null or p_on > private.club_date() then raise exception 'Pick the day, today or earlier.'; end if;
  if p_km is null or p_km < 1 or p_km > 2000000 then raise exception 'The odometer is in whole km, up to 2,000,000.'; end if;
  if exists (
    select 1 from public.bus_km
    where struck_at is null and ((read_on <= p_on and km > p_km) or (read_on > p_on and km < p_km))
  ) then
    raise exception 'That reading is out of order with the ones before and after it.';
  end if;
  if p_booking is not null and not exists (select 1 from public.bus_bookings where id = p_booking and status = 'approved') then
    raise exception 'Pick a Booked booking.';
  end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;

  insert into public.bus_km (km, read_on, booking_id, note, logged_by)
  values (p_km, p_on, p_booking, clean_note, me) returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_attendance(p_session uuid, p_member uuid, p_present boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.checkin_sessions%rowtype;
  target public.members%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session;
  if not found then raise exception 'No such check-in.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not (target.approval = 'approved'
          or (target.approval = 'pending' and target.status = 'introduced' and private.is_board_of(target.chapter_id))) then
    raise exception 'They can’t be checked in.';
  end if;
  if s.held_on > private.club_date() then raise exception 'That check-in hasn’t started yet.'; end if;
  if p_present then
    insert into public.attendance (session_id, member_id, marked_by) values (p_session, p_member, auth.uid())
    on conflict do nothing;
  else
    delete from public.attendance where session_id = p_session and member_id = p_member;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_chat_read(p_chat uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.raise_chat_problem(p_chat);
  insert into public.chat_reads (conversation_id, member_id, read_at) values (p_chat, auth.uid(), clock_timestamp())
  on conflict (conversation_id, member_id) do update set read_at = excluded.read_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_document_reviewed(p_document uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); doc public.documents;
begin
  select * into doc from public.documents where id = p_document;
  if not found then raise exception 'That document isn’t in the library.'; end if;
  perform private.require_scope(doc.chapter_id);
  if doc.review_months is null then raise exception 'This document has no review cycle.'; end if;
  if private.document_in_force(p_document, private.club_date()) is null then
    raise exception 'Nothing is in force yet, so there’s nothing to review.';
  end if;
  update public.documents set reviewed_on = private.club_date() where id = p_document;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_listing_sold(p_id uuid, p_sold boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  l public.listings%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into l from public.listings where id = p_id for update;
  if not found then raise exception 'No such listing.'; end if;
  if l.seller_id <> me then raise exception 'Only whoever listed it can change it.'; end if;
  if l.taken_down_at is not null then raise exception 'That listing has been taken down.'; end if;
  update public.listings
  set sold_at = case when coalesce(p_sold, false) then coalesce(l.sold_at, now()) end, updated_at = now()
  where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.meeting_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.members_money()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'chapter_id', s.chapter_id, 'ride_id', s.ride_id,
                                          'title', s.title, 'held_on', s.held_on, 'opened_by', s.opened_by,
                                          'closed_at', s.closed_at) order by s.held_on desc, s.id)
      from public.checkin_sessions s), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(to_jsonb(a) order by a.checked_in_at) from public.attendance a), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) order by d.decided_on, d.created_at) from public.member_decisions d), '[]'::jsonb),
    'agms', coalesce((select jsonb_agg(jsonb_build_object('year', g.year, 'held_on', g.held_on) order by g.year) from public.agms g), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(to_jsonb(r)) from public.fee_rates r), '[]'::jsonb),
    'continuation', coalesce((select jsonb_agg(to_jsonb(f)) from public.continuation_fees f), '[]'::jsonb),
    'charges', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.charges c), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p), '[]'::jsonb),
    'details', coalesce((select jsonb_agg(to_jsonb(x)) from public.payment_details x), '[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.merch_catalogue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_approved_member() then
    return jsonb_build_object('designs', '[]'::jsonb, 'shipping', '[]'::jsonb, 'address', null, 'runs_shop', false);
  end if;
  return jsonb_build_object(
    'designs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'eligibility', d.eligibility, 'blurb', coalesce(d.blurb, ''), 'sort', d.sort, 'on_sale', d.on_sale,
        'updated_by', d.updated_by, 'updated_at', d.updated_at, 'problem', private.design_problem(d),
        'garments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id, 'design_id', g.design_id, 'name', g.name, 'price_cents', g.price_cents, 'sizes', to_jsonb(g.sizes),
            'colours', to_jsonb(g.colours), 'sort', g.sort, 'on_sale', g.on_sale) order by g.sort, g.name)
          from public.shop_garments g where g.design_id = d.id and (g.on_sale or private.runs_shop())), '[]'::jsonb),
        'pictures', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'garment_id', p.garment_id, 'colour', p.colour, 'side', p.side, 'path', p.path, 'sort', p.sort)
            order by p.sort, p.id)
          from public.shop_pictures p where p.design_id = d.id and (p.garment_id is null or private.runs_shop() or exists (
            select 1 from public.shop_garments g where g.id = p.garment_id and g.on_sale))), '[]'::jsonb)
        ) order by d.sort, d.name)
      from public.shop_designs d where d.on_sale or private.runs_shop()), '[]'::jsonb),
    'shipping', coalesce((
      select jsonb_agg(jsonb_build_object('state', s.state, 'method', s.method, 'cents', s.cents) order by s.state, s.method)
      from public.shop_shipping s), '[]'::jsonb),
    'address', (select case when mp.street is null then null else jsonb_build_object(
        'street', mp.street, 'suburb', mp.suburb, 'state', mp.state, 'postcode', mp.postcode) end
      from public.member_private mp where mp.member_id = auth.uid()),
    'runners', case when private.runs_shop() then coalesce((
      select jsonb_agg(jsonb_build_object('member_id', r.member_id, 'named_by', r.named_by, 'named_on', r.named_on) order by r.named_on)
      from public.shop_runners r), '[]'::jsonb) else '[]'::jsonb end,
    'runs_shop', private.runs_shop());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.minutes_draft_start(p_meeting uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  this_month constant date := date_trunc('month', private.club_date())::date;
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  max_drafts constant int := 5;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  asked int;
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

  -- Counted first and checked after, so drafts asked for at the same moment queue on the row
  -- rather than all slipping through; a refusal rolls its own count back.
  insert into private.minutes_drafts as d (meeting_id, drafts) values (p_meeting, 1)
  on conflict (meeting_id) do update set drafts = d.drafts + 1
  returning drafts into done;
  if done > max_drafts then
    raise exception 'This meeting has been drafted % times. Finish it by hand.', max_drafts;
  end if;
  -- Each draft is also one of the member's Ask the club questions for the day.
  delete from private.assistant_days where day < private.club_date() - 1;
  insert into private.assistant_days as a (member_id, day, questions) values (auth.uid(), private.club_date(), 1)
  on conflict (member_id, day) do update set questions = a.questions + 1
  returning questions into asked;
  if asked > daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  insert into private.assistant_months as mo (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = mo.questions + 1
  returning spent_microusd into spent;
  if spent >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(private.club_date()), 'DD/MM/YYYY');
  end if;

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
    and (p.chapter_id is not distinct from m.chapter_id
         -- The NEC is the national roles plus the chapter Presidents (11.2).
         or (m.chapter_id is null and p.role = 'president'));

  return jsonb_build_object('meeting', meeting, 'people', people, 'board', board);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_open_reports()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', 'message', 'target_id', r.message_id) as x
    from public.message_reports r where r.reporter_id = auth.uid() and r.resolved_at is null
    union all
    select jsonb_build_object('kind', r.kind, 'target_id', r.target_id)
    from public.content_reports r where r.reporter_id = auth.uid() and r.resolved_at is null
  ) mine;
$function$
;

CREATE OR REPLACE FUNCTION public.name_shop_runner(p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_shop_seat();
begin
  if not exists (select 1 from public.members where id = p_member and approval = 'approved' and status::text <> 'legacy') then
    raise exception 'No such member.';
  end if;
  if exists (select 1 from public.shop_runners where member_id = p_member) then raise exception 'Already a shop runner.'; end if;
  insert into public.shop_runners (member_id, named_by, named_on) values (p_member, me, private.club_date());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nominate(p_award uuid, p_ride uuid, p_title text, p_photo jsonb, p_story text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  a public.brag_awards%rowtype;
  r public.rides%rowtype;
  ridden date;
  c_title text;
  c_story text;
  c_photo jsonb;
  c_reason text := nullif(private.trim_like_app(p_reason), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- Locked, so two nominations at once can't both slip under the limit or take the same ride.
  select * into a from public.brag_awards where id = p_award for update;
  if not found then raise exception 'No such award.'; end if;
  if a.archived_at is not null then raise exception 'That award has been taken off.'; end if;
  if private.award_phase(a.nominations_close, a.voting_close) <> 'nominating' then
    raise exception 'Nominations are closed.';
  end if;
  if (select count(*) from public.brag_nominations n
      where n.award_id = a.id and n.withdrawn_at is null and n.nominated_by = me) >= 3 then
    raise exception 'Three nominations each per award.';
  end if;

  if a.kind = 'ride' then
    if p_ride is null then raise exception 'Pick a ride.'; end if;
    select * into r from public.rides where id = p_ride;
    ridden := (r.starts_at at time zone 'Australia/Melbourne')::date;
    if r.id is null or r.cancelled_at is not null or ridden > private.club_date()
       or extract(year from ridden)::int <> a.year then
      raise exception 'Pick a ride from that year that’s been ridden.';
    end if;
    if exists (select 1 from public.brag_nominations n
               where n.award_id = a.id and n.withdrawn_at is null and n.ride_id = p_ride) then
      raise exception 'That ride is already nominated.';
    end if;
  else
    c_title := nullif(private.trim_like_app(p_title), '');
    if c_title is null then raise exception 'Give it a title.'; end if;
    if char_length(c_title) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
    if a.kind = 'photo' then
      if p_photo is null or jsonb_typeof(p_photo) = 'null' then raise exception 'Add a photo.'; end if;
      if jsonb_typeof(p_photo) <> 'object'
         or jsonb_typeof(p_photo->'path') is distinct from 'string'
         or split_part(p_photo->>'path', '/', 1) <> me::text
         or not exists (select 1 from storage.objects o
                        where o.bucket_id = 'brag-media' and o.name = p_photo->>'path' and o.owner_id = me::text)
         or private.brag_file_in_use(p_photo->>'path') then
        raise exception 'That photo didn’t upload properly. Try again.';
      end if;
      -- Kept as just the path and size.
      c_photo := jsonb_build_object(
        'path', p_photo->>'path',
        'width', case when jsonb_typeof(p_photo->'width') = 'number' then round((p_photo->>'width')::numeric) end,
        'height', case when jsonb_typeof(p_photo->'height') = 'number' then round((p_photo->>'height')::numeric) end);
    else
      c_story := nullif(private.trim_like_app(p_story), '');
      if c_story is null then raise exception 'Tell the story.'; end if;
      if char_length(c_story) > 1000 then raise exception 'Keep the story to 1,000 characters at most.'; end if;
    end if;
  end if;
  if char_length(c_reason) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;

  insert into public.brag_nominations (award_id, nominated_by, ride_id, title, photo, story, reason)
  values (a.id, me, case when a.kind = 'ride' then p_ride end, c_title, c_photo, c_story, c_reason)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_award(p_kind text, p_title text, p_year integer, p_nominations_close text, p_voting_close text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c_title text := coalesce(private.trim_like_app(p_title), '');
  c_noms date;
  c_votes date;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can run awards.'; end if;
  if p_kind is null or p_kind not in ('ride', 'photo', 'story') then raise exception 'Pick what the award is for.'; end if;
  if c_title = '' then raise exception 'Give the award a name.'; end if;
  if char_length(c_title) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if p_year is null or p_year < 2019 or p_year > extract(year from private.club_date())::int then
    raise exception 'Pick a year from 2019 on.';
  end if;
  if p_nominations_close is null or p_nominations_close !~ '^\d{4}-\d{2}-\d{2}$'
     or p_voting_close is null or p_voting_close !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Nominations close first, then voting, both from today on.';
  end if;
  begin
    c_noms := p_nominations_close::date;
    c_votes := p_voting_close::date;
  exception when others then
    raise exception 'Nominations close first, then voting, both from today on.';
  end;
  if to_char(c_noms, 'YYYY-MM-DD') <> p_nominations_close or to_char(c_votes, 'YYYY-MM-DD') <> p_voting_close
     or c_noms < private.club_date() or c_votes <= c_noms then
    raise exception 'Nominations close first, then voting, both from today on.';
  end if;

  insert into public.brag_awards (kind, title, year, nominations_close, voting_close, opened_by)
  values (p_kind::public.brag_kind, c_title, p_year, c_noms, c_votes, me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_checkin(p_kind text, p_ride uuid, p_chapter uuid, p_title text, p_held_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  seat uuid := p_chapter;
  title text := nullif(trim(p_title), '');
  held date := p_held_on;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_kind = 'ride' then
    select * into ride from public.rides where id = p_ride;
    if not found then raise exception 'No such ride.'; end if;
    if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
    if exists (select 1 from public.checkin_sessions where ride_id = p_ride) then
      raise exception 'Check-in for this ride is already open.';
    end if;
    seat := case when ride.category in ('north', 'west')
                 then (select id from public.chapters where slug = ride.category::text) end;
    title := ride.title;
    held := private.club_date(ride.starts_at);
  elsif p_kind = 'meeting' then
    if p_chapter is null then raise exception 'Pick a chapter.'; end if;
    if title is null then raise exception 'Add a title.'; end if;
    if held is null or held < private.club_date() then raise exception 'Pick today or a later date.'; end if;
  else
    raise exception 'Pick a ride or a meeting.';
  end if;
  if not private.can_run_checkin(seat) then raise exception 'Only that chapter’s board can open a check-in.'; end if;

  insert into public.checkin_sessions (kind, chapter_id, ride_id, title, held_on, code, opened_by)
  values (p_kind, seat, case when p_kind = 'ride' then p_ride end, title, held, private.new_checkin_code(), me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_checkin(p_kind text, p_ride uuid, p_chapter uuid, p_title text, p_held_on date, p_meeting_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
begin
  new_id := public.open_checkin(p_kind, p_ride, p_chapter, p_title, p_held_on);
  if p_kind = 'meeting' then
    if p_meeting_type is null or p_meeting_type not in ('ordinary', 'special', 'event') then
      raise exception 'Pick what kind of meeting it is.';
    end if;
    update public.checkin_sessions set meeting_type = p_meeting_type where id = new_id;
  end if;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_direct_chat(p_member uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.open_vote(p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text, p_electorate electorate, p_threshold vote_threshold, p_secret boolean, p_quorum integer, p_closes_at timestamp with time zone, p_role position_role DEFAULT NULL::position_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_electorate = 'chapter_board' and electors < 3 then
    raise exception 'A board vote needs at least three board members (8.5).';
  end if;
  if p_quorum is null or p_quorum < private.min_quorum(p_electorate, electors) or p_quorum > electors then
    raise exception 'Quorum must be between % and %.', private.min_quorum(p_electorate, electors), electors;
  end if;
  if p_closes_at is null or p_closes_at <= now() then raise exception 'Pick a closing time in the future.'; end if;
  if p_closes_at > now() + interval '1440 hours' then raise exception 'Votes can stay open for 60 days at most.'; end if;
  -- A vote that names a role: the NEC seats someone (11.6, 11.8), or a chapter removes someone (9.3).
  if p_role is not null and p_chapter is null and p_role not in ('nec_auditor', 'nec_secretary') then
    raise exception 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).';
  end if;
  if p_role in ('nec_auditor', 'nec_secretary') and (p_subject is null or p_chapter is not null) then
    raise exception 'A vote for a national seat is the NEC’s vote about a Full Member (11.6, 11.8).';
  end if;
  if p_role is not null and p_chapter is not null and (p_subject is null or p_role in ('founder', 'nec_chair')) then
    raise exception 'A removal vote is the chapter’s vote about one of its own role holders (9.3).';
  end if;
  if p_subject is not null and p_chapter is null then
    select * into subject from public.members where id = p_subject;
    if found and subject.approval = 'approved' and subject.status = 'full' then
      -- Seating a Full Member as National Auditor (11.8) or National Secretary (11.6): two-thirds of
      -- the NEC, on someone who could hold the seat.
      if p_role is null then
        raise exception 'Say which seat the vote is for: National Auditor or National Secretary (11.6, 11.8).';
      end if;
      if p_role = 'nec_auditor' and (p_electorate <> 'nec' or p_threshold <> 'two_thirds' or exists (
           select 1 from public.positions where member_id = p_subject and ended_on is null
             and role in ('president', 'treasurer', 'nec_chair', 'nec_secretary'))) then
        raise exception 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).';
      end if;
      if p_role = 'nec_secretary' and (p_electorate <> 'nec' or p_threshold <> 'two_thirds' or exists (
           select 1 from public.positions where member_id = p_subject and ended_on is null
             and role in ('nec_chair', 'nec_secretary', 'nec_auditor'))) then
        raise exception 'A vote to appoint the National Secretary is an NEC two-thirds vote on a Full Member who isn’t already National Chairman, Secretary or Auditor (11.6).';
      end if;
    elsif p_role is not null then
      raise exception 'Only a Full Member can be voted into a national seat (9.1).';
    elsif not found or subject.approval <> 'approved' or subject.status not in ('supporter', 'legacy', 'family', 'introduced')
       or p_electorate <> 'nec' or p_threshold <> 'majority' then
      -- Bringing someone back to Full or Nomad is the NEC's decision (5.6).
      raise exception 'A reinstatement vote is an NEC majority vote on a member who isn’t Full, Nomad or an FNG (5.6).';
    end if;
  elsif p_subject is not null and p_role is not null then
    -- A removal vote (9.3): about a Full Member or Nomad who holds that role in this chapter. A board
    -- seat goes by two-thirds of the chapter's Full Members; any other chapter role by a board majority.
    select * into subject from public.members where id = p_subject;
    if not found or subject.approval <> 'approved' or subject.status not in ('full', 'nomad') or not exists (
         select 1 from public.positions
         where member_id = p_subject and chapter_id = p_chapter and role = p_role and ended_on is null) then
      raise exception 'A removal vote is about a Full Member or Nomad who holds that role in this chapter (9.3).';
    end if;
    if p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
      if p_electorate <> 'chapter_patched' or p_threshold <> 'two_thirds' then
        raise exception 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).';
      end if;
    elsif p_electorate <> 'chapter_board' or p_threshold <> 'majority' then
      raise exception 'Removing someone from a chapter role is a majority vote of the chapter board (9.3).';
    end if;
  elsif p_subject is not null then
    select * into subject from public.members where id = p_subject;
    if not found or subject.chapter_id <> p_chapter or subject.approval <> 'approved' or subject.status <> 'fng' then
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

  insert into public.votes (chapter_id, meeting_id, subject_member_id, subject_role, question, details, electorate,
                            threshold, secret, quorum, closes_at, created_by)
  values (p_chapter, p_meeting, p_subject, p_role, trim(p_question), nullif(trim(p_details), ''), p_electorate,
          p_threshold, coalesce(p_secret, false), p_quorum, p_closes_at, me)
  returning id into opened;
  insert into public.vote_electors (vote_id, member_id)
  select opened, e from private.electors_for(p_electorate, p_chapter) e;
  return opened;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.order_merch(p_item uuid, p_size text, p_qty integer, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); i public.merch_items; my_status text;
  n text := private.trim_like_app(coalesce(p_note, '')); new_id uuid;
begin
  select status::text into my_status from public.members where id = me;
  if my_status = 'legacy' then raise exception 'Legacy members can’t order merch.'; end if;
  select * into i from public.merch_items where id = p_item;
  if not found or not private.sees_merch_item(i) or i.status <> 'on_sale' then raise exception 'That item isn’t on sale.'; end if;
  if i.patched_only and my_status not in ('full', 'nomad') then raise exception 'That item is for Full and Nomad members only.'; end if;
  if cardinality(i.sizes) > 0 and (p_size is null or not (p_size = any (i.sizes))) then raise exception 'Pick a size.'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'Order 1 to 10.'; end if;
  if char_length(n) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;
  insert into public.merch_orders (item_id, member_id, size, qty, unit_cents, note)
  values (i.id, me, case when cardinality(i.sizes) > 0 then p_size end, p_qty, i.price_cents, nullif(n, ''))
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_debit(p_id uuid, p_paid_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.ledger_entries;
begin
  perform private.require_member();
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.keeps_books(e.chapter_id) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if e.state = 'awaiting' then raise exception 'It needs two approvals before it’s paid (13.3).'; end if;
  if e.state <> 'approved' then raise exception 'That’s already been paid or voided.'; end if;
  if p_paid_on is null then raise exception 'Pick the date it was paid.'; end if;
  if p_paid_on > private.club_date() then raise exception 'That date hasn’t happened yet.'; end if;
  if p_paid_on < (select max(private.club_date(approved_at)) from public.ledger_approvals where entry_id = p_id) then
    raise exception 'It can’t be paid before it was approved (13.3).';
  end if;
  update public.ledger_entries set state = 'paid', entry_on = p_paid_on, updated_at = now() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_merch_order(p_order uuid, p_paid_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); f record; i public.merch_items; who text; new_id uuid;
begin
  select * into f from private.merch_order(p_order);
  if not private.keeps_books(f.chapter) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if (f.o).status in ('paid', 'handed_over') then raise exception 'That order is already paid.'; end if;
  if (f.o).status <> 'approved' then raise exception 'Approve the order first.'; end if;
  if (f.o).member_id = me then raise exception 'Someone else records your own payment.'; end if;
  if p_paid_on is null or p_paid_on > private.club_date() or p_paid_on < private.club_date((f.o).ordered_at) then
    raise exception 'Pick the day it was paid.';
  end if;
  select * into i from public.merch_items where id = (f.o).item_id;
  select coalesce(road_name, full_name) into who from public.members where id = (f.o).member_id;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, state, recorded_by)
  values (f.chapter, 'CR-005',
          'Merch: ' || i.name || coalesce(' (' || (f.o).size || ')', '') || ' ×' || (f.o).qty || ' for ' || coalesce(who, 'Member'),
          (f.o).unit_cents * (f.o).qty, p_paid_on, p_paid_on, 'paid', me)
  returning id into new_id;
  update public.merch_orders set status = 'paid', paid_on = p_paid_on, ledger_entry_id = new_id where id = (f.o).id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_shop_order(p_order uuid, p_paid_on date, p_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); o public.shop_orders; items text; new_id uuid;
begin
  o := private.shop_order(p_order);
  if not private.keeps_books(null) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if o.status <> 'sent' then raise exception 'Mark it paid once it has been sent to Make.'; end if;
  if p_paid_on is null or p_paid_on > private.club_date() or p_paid_on < private.club_date(o.ordered_at) then
    raise exception 'Pick the day it was paid.';
  end if;
  if p_cents is null or p_cents < 1 or p_cents > 1000000 then raise exception 'Enter the amount received.'; end if;
  if o.member_id = me then raise exception 'Someone else records your own payment.'; end if;
  select string_agg(
      l.design_name || ' ' || l.garment_name
        || case when l.size is null and l.colour is null then ''
                else ' (' || concat_ws(', ', l.size, l.colour) || ')' end
        || ' ×' || l.qty, ', ' order by l.design_name, l.garment_name, l.size, l.colour)
  into items from public.shop_order_lines l where l.order_id = o.id;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, state, recorded_by)
  values (null, 'CR-005',
          'Shop order ' || upper(left(o.id::text, 8)) || ': ' || coalesce(items, '') || ' for ' || coalesce(o.road_name, o.buyer_name),
          p_cents, p_paid_on, p_paid_on, 'paid', me)
  returning id into new_id;
  update public.shop_orders set status = 'paid', paid_on = p_paid_on, paid_cents = p_cents, ledger_entry_id = new_id where id = o.id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.photos_on_this_day()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  today date := private.club_date();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from (
      select m.*
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and private.is_on_this_day(private.club_date(m.created_at), today)
        and exists (select 1 from public.message_media x where x.message_id = m.id and x.kind in ('photo', 'video'))
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
      order by m.created_at desc
      limit 60
    ) m
    join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pick_site_photo(p_media uuid, p_caption text, p_consent boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  mm public.message_media%rowtype;
  m public.messages%rowtype;
  chat_kind text;
  v_caption text := nullif(private.trim_like_app(coalesce(p_caption, '')), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_site_photo_editor() then
    raise exception 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
  end if;
  select * into mm from public.message_media where id = p_media;
  if found then select * into m from public.messages where id = mm.message_id; end if;
  if not found or m.removed_at is not null or not private.can_read_chat(mm.conversation_id) then
    raise exception 'No such photo.';
  end if;
  if mm.kind <> 'photo' then raise exception 'Only photos go on the website, not videos or GIFs.'; end if;
  select kind::text into chat_kind from public.conversations where id = mm.conversation_id;
  if chat_kind = 'direct' then raise exception 'Photos from private chats stay private.'; end if;
  if exists (select 1 from public.site_photos where media_id = p_media and status <> 'removed') then
    raise exception 'That photo is already on the list.';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Tick that everyone in the photo is happy to be on the website.'; end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;

  insert into public.site_photos (source, media_id, bucket, path, width, height, caption, posted_by, picked_by, status, decided_at)
  values ('chat', p_media, 'chat-media', mm.path, mm.width, mm.height, v_caption, m.author_id, me, 'live', now())
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pin_message(p_chat uuid, p_message uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.messages%rowtype;
  was uuid;
begin
  perform private.raise_chat_problem(p_chat);
  if not private.can_moderate(p_chat) then raise exception 'Only moderators can pin messages.'; end if;
  if p_message is not null then
    select * into m from public.messages where id = p_message and conversation_id = p_chat;
    if not found then raise exception 'No such message.'; end if;
    if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  end if;
  select pinned_message_id into was from public.conversations where id = p_chat;
  update public.conversations set pinned_message_id = p_message where id = p_chat;
  update public.messages set updated_at = clock_timestamp() where id in (was, p_message);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.place_shop_order(p_client_ref uuid, p_lines jsonb, p_email text, p_phone text, p_delivery text, p_street text, p_suburb text, p_state text, p_postcode text, p_shipping_method text, p_save_address boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  my record;
  existing public.shop_orders;
  v_email text := private.trim_like_app(coalesce(p_email, ''));
  v_phone text := private.trim_like_app(coalesce(p_phone, ''));
  v_street text := private.trim_like_app(coalesce(p_street, ''));
  v_suburb text := private.trim_like_app(coalesce(p_suburb, ''));
  v_state text := upper(private.trim_like_app(coalesce(p_state, '')));
  v_postcode text := private.trim_like_app(coalesce(p_postcode, ''));
  ship boolean := p_delivery = 'ship';
  problem text;
  l record;
  g public.shop_garments;
  d public.shop_designs;
  merged jsonb;
  subtotal int := 0;
  shipping int := 0;
  new_id uuid;
begin
  if p_client_ref is null then raise exception 'Add something first.'; end if;
  -- One order at a time per member: the repeat check and the daily count both sit under this lock.
  perform pg_advisory_xact_lock(hashtext('shop_order:' || me::text));
  select * into existing from public.shop_orders where member_id = me and client_ref = p_client_ref;
  if found then return private.shop_order_json(existing) || jsonb_build_object('created', false); end if;
  select m.status::text as status, m.full_name, m.road_name, mp.email as saved_email into my
  from public.members m left join public.member_private mp on mp.member_id = m.id where m.id = me;
  if my.status = 'legacy' then raise exception 'Legacy members can’t order merch.'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add something first.'; end if;
  -- The same garment, size and colour twice is one line (mergeLines).
  select coalesce(jsonb_agg(jsonb_build_object('garment_id', x.garment_id, 'size', x.size, 'colour', x.colour, 'qty', x.qty) order by x.first), '[]'::jsonb)
  into merged
  from (
    select e->>'garment_id' as garment_id, e->>'size' as size, e->>'colour' as colour,
      sum(case when jsonb_typeof(e->'qty') = 'number' then (e->>'qty')::numeric end) as qty, min(i) as first
    from jsonb_array_elements(p_lines) with ordinality as t(e, i)
    group by 1, 2, 3
  ) x;
  if jsonb_array_length(merged) > 10 then raise exception 'Up to 10 lines an order.'; end if;
  for l in select e->>'garment_id' as garment_id, e->>'size' as size, e->>'colour' as colour,
                  case when jsonb_typeof(e->'qty') = 'number' then (e->>'qty')::numeric end as qty
           from jsonb_array_elements(merged) e loop
    g := null; d := null;
    select sg.* into g from public.shop_garments sg where sg.id::text = l.garment_id;
    if found then select sd.* into d from public.shop_designs sd where sd.id = g.design_id; end if;
    if g.id is null or d.id is null or not g.on_sale then raise exception 'That isn’t on sale.'; end if;
    problem := private.design_problem(d);
    if problem is not null then raise exception '%', problem; end if;
    if l.qty is null or l.qty <> trunc(l.qty) or l.qty < 1 or l.qty > 10 then raise exception 'Order 1 to 10 of each.'; end if;
    if (cardinality(g.sizes) > 0 and (l.size is null or not (l.size = any (g.sizes))))
       or (cardinality(g.sizes) = 0 and l.size is not null) then
      raise exception 'Pick a size.';
    end if;
    if (cardinality(g.colours) > 0 and (l.colour is null or not (l.colour = any (g.colours))))
       or (cardinality(g.colours) = 0 and l.colour is not null) then
      raise exception 'Pick a colour.';
    end if;
    subtotal := subtotal + g.price_cents * l.qty::int;
  end loop;
  if v_email = '' then v_email := private.trim_like_app(coalesce(my.saved_email, '')); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'That email address does not look right.'; end if;
  if char_length(v_phone) > 30 then raise exception 'Keep the phone number to 30 characters.'; end if;
  if p_delivery = 'ship' then
    problem := private.address_problem(v_street, v_suburb, v_state, v_postcode);
    if problem is not null then raise exception '%', problem; end if;
    if p_shipping_method is null or p_shipping_method not in ('standard', 'express') then raise exception 'Pick Standard or Express.'; end if;
    select s.cents into shipping from public.shop_shipping s where s.state = v_state and s.method = p_shipping_method;
    shipping := coalesce(shipping, 0);
  elsif p_delivery is distinct from 'collect' then
    raise exception 'Pick ship or collect.';
  end if;
  -- Five orders a member a day, counted in Melbourne.
  if (select count(*) from public.shop_orders where member_id = me and private.club_date(ordered_at) = private.club_date()) >= 5 then
    raise exception 'That’s enough orders for one day. Try again tomorrow.';
  end if;
  insert into public.shop_orders (member_id, client_ref, buyer_name, road_name, email, phone, delivery, street, suburb, state, postcode,
    shipping_method, subtotal_cents, shipping_cents)
  values (me, p_client_ref, my.full_name, my.road_name, v_email, nullif(v_phone, ''), p_delivery,
    case when ship then v_street end, case when ship then v_suburb end, case when ship then v_state end, case when ship then v_postcode end,
    case when ship then p_shipping_method end, subtotal, shipping)
  returning id into new_id;
  insert into public.shop_order_lines (order_id, garment_id, design_name, garment_name, size, colour, qty, unit_cents)
  select new_id, sg.id, sd.name, sg.name, e->>'size', e->>'colour', (e->>'qty')::numeric::int, sg.price_cents
  from jsonb_array_elements(merged) e
  join public.shop_garments sg on sg.id::text = e->>'garment_id'
  join public.shop_designs sd on sd.id = sg.design_id;
  if ship and p_save_address then
    update public.member_private mp set street = v_street, suburb = v_suburb, state = v_state, postcode = v_postcode, updated_at = now()
    where mp.member_id = me;
    if not found then
      insert into public.member_private (member_id, street, suburb, state, postcode) values (me, v_street, v_suburb, v_state, v_postcode);
    end if;
  end if;
  select * into existing from public.shop_orders where id = new_id;
  -- created: true tells the shop-order function this call made the order, so only it posts to Make.
  return private.shop_order_json(existing) || jsonb_build_object('created', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_build_update(p_bike uuid, p_body text, p_photos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  b public.bikes%rowtype;
  c_body text := nullif(private.trim_like_app(p_body), '');
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  bad boolean;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into b from public.bikes where id = p_bike;
  if not found then raise exception 'No such bike.'; end if;
  if b.member_id <> me then raise exception 'Only the bike’s owner can post on its build.'; end if;
  if not b.is_project then
    raise exception 'Build threads are for project bikes. Mark it as a project in your garage first.';
  end if;
  if jsonb_typeof(v_photos) <> 'array' then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  if c_body is null and jsonb_array_length(v_photos) = 0 then raise exception 'Write something or add a photo.'; end if;
  if char_length(c_body) > 2000 then raise exception 'Keep it to 2,000 characters at most.'; end if;
  if jsonb_array_length(v_photos) > 4 then raise exception 'Up to 4 photos.'; end if;

  select exists (
    select 1 from jsonb_array_elements(v_photos) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'path') is distinct from 'string'
       or split_part(item->>'path', '/', 1) <> me::text
       or not exists (select 1 from storage.objects o
                      where o.bucket_id = 'build-media' and o.name = item->>'path' and o.owner_id = me::text)
       or private.build_file_in_use(item->>'path')
       or (select count(*) from jsonb_array_elements(v_photos) sib where sib->>'path' = item->>'path') > 1
  ) into bad;
  if bad then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  -- Kept as just the path and size.
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', item->>'path',
           'width', case when jsonb_typeof(item->'width') = 'number' then round((item->>'width')::numeric) end,
           'height', case when jsonb_typeof(item->'height') = 'number' then round((item->>'height')::numeric) end)
         order by i), '[]')
  into v_photos from jsonb_array_elements(v_photos) with ordinality as e(item, i);

  insert into public.build_updates (bike_id, author_id, body, photos)
  values (p_bike, me, c_body, v_photos)
  returning id into new_id;
  return new_id;
end;
$function$
;

