-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the public schema (these are callable through the API as RPCs if granted; see 02 for grants).
-- Part 1 of 5.

CREATE OR REPLACE FUNCTION public.accept_posting_rules()
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  agreed date;
begin
  update public.members set posting_rules_accepted_on = coalesce(posting_rules_accepted_on, private.club_date()), updated_at = now()
  where id = me
  returning posting_rules_accepted_on into agreed;
  return agreed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_fee_payment(p_payment uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); p public.payments; c public.charges; who text; new_id uuid;
begin
  select * into p from public.payments where id = p_payment;
  select * into c from public.charges where id = p.charge_id;
  if p.id is null or c.id is null then raise exception 'No such payment.'; end if;
  if not private.keeps_books(c.chapter_id) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if p.state <> 'confirmed' then raise exception 'Only a confirmed payment goes in the ledger.'; end if;
  if exists (select 1 from public.ledger_entries where payment_id = p_payment) then
    raise exception 'That payment is already in the ledger.';
  end if;
  select coalesce(road_name, full_name) into who from public.members where id = c.member_id;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, payment_id, state, recorded_by)
  values (c.chapter_id, 'CR-001', 'Member fees: ' || coalesce(who, 'Member'), p.amount_cents, p.paid_on, p.paid_on, p_payment, 'paid', me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_shop_picture(p_design uuid, p_garment uuid, p_colour text, p_side text, p_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_runs_shop();
  c text := nullif(private.trim_like_app(coalesce(p_colour, '')), '');
  pth text := coalesce(p_path, '');
  new_id uuid;
begin
  if not exists (select 1 from public.shop_designs where id = p_design) then raise exception 'No such design.'; end if;
  if p_garment is not null and not exists (select 1 from public.shop_garments where id = p_garment and design_id = p_design) then
    raise exception 'No such garment.';
  end if;
  if c is not null and not exists (
    select 1 from public.shop_garments g where g.design_id = p_design and (p_garment is null or g.id = p_garment) and c = any (g.colours)) then
    raise exception 'Pick one of its colours, or any colour.';
  end if;
  if p_side is null or p_side not in ('front', 'back') then raise exception 'Pick front or back.'; end if;
  if left(pth, char_length(p_design::text) + 1) <> p_design::text || '/' or char_length(pth) <= char_length(p_design::text) + 1
     or not exists (select 1 from storage.objects o where o.bucket_id = 'shop-pictures' and o.name = pth) then
    raise exception 'Upload the picture first.';
  end if;
  perform 1 from public.shop_designs where id = p_design for update; -- two runners at once can't pass 40
  if (select count(*) from public.shop_pictures where design_id = p_design) >= 40 then raise exception 'Up to 40 pictures a design.'; end if;
  if exists (select 1 from public.shop_pictures where path = pth) then raise exception 'That picture is already in the shop.'; end if;
  insert into public.shop_pictures (design_id, garment_id, colour, side, path, sort, added_by)
  values (p_design, p_garment, c, p_side, pth,
          coalesce((select max(sort) + 1 from public.shop_pictures where design_id = p_design), 0), me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.answer_app_feedback(p_id uuid, p_status text, p_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.app_feedback%rowtype;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.uses_app() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_feedback_keeper() then raise exception 'Only the app keepers can answer feedback.'; end if;
  select * into f from public.app_feedback where id = p_id for update;
  if not found then raise exception 'No such report.'; end if;
  if p_status is null or p_status not in ('new', 'looking', 'done') then
    raise exception 'Pick a status: new, looking into it or done.';
  end if;
  if length(v_reply) > 600 then raise exception 'Keep the reply to 600 characters.'; end if;
  update public.app_feedback
  set status = p_status,
      status_changed_at = case when p_status <> f.status then now() else status_changed_at end,
      reply = coalesce(v_reply, reply),
      replied_by = case when v_reply is not null then auth.uid() else replied_by end,
      replied_at = case when v_reply is not null then now() else replied_at end,
      reply_count = reply_count + (v_reply is not null)::int
  where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.answer_audit_request(p_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  r public.audit_requests%rowtype;
  a text;
begin
  select * into r from public.audit_requests where id = p_id for update;
  if not found then raise exception 'That request isn’t there any more.'; end if;
  if not private.runs_scope(r.chapter_id) then
    if r.chapter_id is null then raise exception 'Only the NEC answers this request.'; end if;
    raise exception 'Only that chapter’s board answers this request.';
  end if;
  if r.closed_at is not null then raise exception 'That request is closed.'; end if;
  a := private.audit_text(p_answer, 'Write the answer first.', 4000);
  update public.audit_requests set answer = a, answered_by = me, answered_at = now() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.answer_invite(p_id uuid, p_answer text, p_label text, p_bikes numeric, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  i public.club_invites%rowtype;
  c_note text := nullif(private.trim_like_app(p_note), '');
  is_yes boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into i from public.club_invites where id = p_id for update;
  if not found then raise exception 'No such invite.'; end if;
  if i.archived_at is not null then raise exception 'That invite has been taken off.'; end if;
  if not private.manages_invite(i) then raise exception 'Only the board or Ride Committee can answer invites.'; end if;
  if p_answer is null or p_answer not in ('waiting', 'yes', 'no') then raise exception 'Pick an answer.'; end if;
  is_yes := p_answer = 'yes';
  if i.direction = 'in' and is_yes and (p_label is null or p_label not in ('supported', 'non_nuts')) then
    raise exception 'Pick how it goes on the club calendar.';
  end if;
  if i.direction = 'out' and is_yes and p_bikes is not null
     and (p_bikes <> trunc(p_bikes) or p_bikes < 1 or p_bikes > 500) then
    raise exception 'Bikes expected must be a whole number from 1 to 500.';
  end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  update public.club_invites
  set answer = p_answer::public.invite_answer,
      calendar_label = case when i.direction = 'in' and is_yes then p_label::public.ride_category end,
      bikes = case when i.direction = 'out' and is_yes then p_bikes::int end,
      -- An incoming invite that's no longer a yes lets go of its calendar ride.
      ride_id = case when i.direction = 'in' and not is_yes then null else i.ride_id end,
      note = c_note,
      answered_by = case when p_answer = 'waiting' then null else me end,
      answered_at = case when p_answer = 'waiting' then null else now() end
  where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.answer_swap(p_swap uuid, p_yes boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  s public.crew_swaps%rowtype;
  ride public.rides%rowtype;
  ride_day date;
  problem text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into s from public.crew_swaps where id = p_swap;
  if not found then raise exception 'No such swap.'; end if;
  if s.asked_to <> me then raise exception 'That ask isn’t for you.'; end if;
  if p_yes is not true then
    update public.crew_swaps set state = 'declined', answered_at = now() where id = s.id and state = 'asked';
    if not found then raise exception 'That ask has already been answered.'; end if;
    return;
  end if;
  -- The ride row first, then the ask again (it may have been answered or withdrawn meanwhile).
  select * into ride from public.rides where id = s.ride_id for no key update;
  select * into s from public.crew_swaps where id = p_swap for update;
  if s.state <> 'asked' then raise exception 'That ask has already been answered.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'The crew can’t change after the ride day.'; end if;
  if not exists (select 1 from public.ride_crew where ride_id = s.ride_id and member_id = s.asked_by and role = s.role)
     or (select role from public.ride_crew where ride_id = s.ride_id and member_id = me) is distinct from s.their_role then
    raise exception 'The crew has changed since. Ask again.';
  end if;
  ride_day := date(ride.starts_at at time zone 'Australia/Melbourne');
  problem := private.crew_eligibility(me, s.role, ride_day);
  if problem is null and s.their_role is not null then problem := private.crew_eligibility(s.asked_by, s.their_role, ride_day); end if;
  if problem is not null then raise exception '%', problem; end if;

  if s.their_role is null then
    update public.ride_crew set member_id = me, assigned_by = me, assigned_at = now()
    where ride_id = s.ride_id and member_id = s.asked_by;
  else
    -- Through Officer (which has no limit), so the one-per-spot index never sees two holders.
    update public.ride_crew set role = 'officer' where ride_id = s.ride_id and member_id = s.asked_by;
    update public.ride_crew set role = s.role, assigned_by = me, assigned_at = now() where ride_id = s.ride_id and member_id = me;
    update public.ride_crew set role = s.their_role, assigned_by = me, assigned_at = now() where ride_id = s.ride_id and member_id = s.asked_by;
  end if;
  insert into public.rsvps (ride_id, member_id, answer) values (s.ride_id, me, 'going')
  on conflict (ride_id, member_id) do update set answer = excluded.answer, updated_at = now();
  update public.crew_swaps set state = 'accepted', answered_at = now() where id = s.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_ride_sync(p_feed uuid, p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
  incoming jsonb;
  n int;
begin
  -- The rides as listed, one per (uid, start), the later listing winning.
  select coalesce(jsonb_agg(ev), '[]'::jsonb) into incoming
  from (
    select distinct on (e.uid, e."startsAt") x.ev
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality as x(ev, pos)
    cross join lateral jsonb_to_record(x.ev) as e(uid text, "startsAt" timestamptz, category public.ride_category)
    where e.uid is not null and e."startsAt" is not null and e.category is not null
    order by e.uid, e."startsAt", x.pos desc
  ) listed;

  insert into public.rides as r (source, feed_id, external_uid, starts_at, ends_at, all_day, title, location, notes, category,
                            cancelled_at, synced_at)
  select 'feed', p_feed, e.uid, e."startsAt", e."endsAt", coalesce(e."allDay", false),
         coalesce(nullif(trim(e.title), ''), 'Ride'), nullif(trim(e.location), ''), nullif(trim(e.notes), ''),
         e.category, null, now()
  from jsonb_to_recordset(incoming) as e(
    uid text, "startsAt" timestamptz, "endsAt" timestamptz, "allDay" boolean, title text, location text,
    notes text, category public.ride_category)
  on conflict (feed_id, external_uid, starts_at) do update set
    ends_at = excluded.ends_at, all_day = excluded.all_day, title = excluded.title, location = excluded.location,
    notes = excluded.notes, category = excluded.category, cancelled_at = null, synced_at = now()
  where (r.ends_at, r.all_day, r.title, r.location, r.notes, r.category, r.cancelled_at)
    is distinct from (excluded.ends_at, excluded.all_day, excluded.title, excluded.location, excluded.notes,
                      excluded.category, null::timestamptz);
  get diagnostics n = row_count;

  update public.rides r set cancelled_at = now(), synced_at = now()
  where r.feed_id = p_feed and r.cancelled_at is null and r.starts_at >= today_start
    and not exists (
      select 1 from jsonb_to_recordset(incoming) as i(uid text, "startsAt" timestamptz)
      where i.uid = r.external_uid and i."startsAt" = r.starts_at);

  update private.ride_feeds set last_ok_at = now(), last_error = null where id = p_feed;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_to_join(p_chapter uuid, p_full_name text, p_road_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_introduced_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_status member_status DEFAULT 'introduced'::member_status, p_bike_make text DEFAULT NULL::text, p_bike_model text DEFAULT NULL::text, p_bike_year integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  bike_make text := nullif(trim(p_bike_make), '');
  bike_model text := nullif(trim(p_bike_model), '');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.members where id = me) then raise exception 'You have already applied.'; end if;
  if p_status not in ('introduced', 'supporter', 'family') then
    raise exception 'New applications start as Introduced, Supporter or Family.';
  end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Add your name.'; end if;
  if not exists (select 1 from public.chapters where id = p_chapter) then raise exception 'Pick a chapter.'; end if;
  if (bike_make is null) <> (bike_model is null) then
    raise exception 'Add the bike’s make and model, or leave both blank.';
  end if;
  if bike_make is null and p_bike_year is not null then
    raise exception 'Add the bike’s make and model too, or clear the year.';
  end if;
  if bike_make is not null then perform private.check_bike_year(p_bike_year); end if;

  insert into public.members (id, chapter_id, full_name, road_name, status, approval, applied_on)
  values (me, p_chapter, trim(p_full_name), nullif(trim(p_road_name), ''), p_status, 'pending', private.club_date());

  insert into public.member_private (member_id, email, phone, introduced_by, application_note)
  values (
    me,
    (select email from auth.users where id = me),
    nullif(trim(p_phone), ''),
    nullif(trim(p_introduced_by), ''),
    nullif(trim(p_note), '')
  );

  if bike_make is not null then
    insert into public.bikes (member_id, make, model, year) values (me, bike_make, bike_model, p_bike_year);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.appoint_position(p_member uuid, p_chapter uuid, p_role position_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  is_national_role boolean := p_role in ('nec_chair', 'nec_secretary', 'nec_auditor');
  seat uuid;
  unfit text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_role = 'founder' then raise exception 'Founder is an honour the club’s admin records.'; end if;
  if p_member = me then raise exception 'You can’t appoint yourself.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if target.status = 'legacy' then raise exception 'Legacy members don’t hold positions.'; end if;

  seat := case when is_national_role then null else p_chapter end;
  if is_national_role then
    if p_role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    if not private.is_chairman() then raise exception 'Only the National Chairman hands out national roles.'; end if;
  else
    if seat is null or seat <> target.chapter_id then raise exception 'They’re not a member of that chapter.'; end if;
    if p_role = 'president' then
      if not private.is_nec_officer() then
        raise exception 'Only the National Chairman or Secretary can seat a President.';
      end if;
    elsif not private.is_board_of(seat) then
      raise exception 'Only that chapter’s board can appoint here.';
    end if;
  end if;

  unfit := private.hold_problem(p_member, p_role);
  if unfit is not null then raise exception '%', unfit; end if;

  if exists (
    select 1 from public.positions
    where member_id = p_member and role = p_role and chapter_id is not distinct from seat and ended_on is null
  ) then
    raise exception 'They already hold that role.';
  end if;
  if (is_national_role or p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))
    and exists (
      select 1 from public.positions where role = p_role and chapter_id is not distinct from seat and ended_on is null
    ) then
    raise exception 'That seat is taken. End the current term first.';
  end if;
  -- The Auditor (11.8) and the Secretary (11.6) are seated after a carried two-thirds NEC vote about them.
  if p_role in ('nec_auditor', 'nec_secretary') and not private.has_carried_nec_vote(p_member, p_role) then
    raise exception 'Appointing the National % needs a carried two-thirds NEC vote about them in the last 90 days (%).',
      case p_role when 'nec_auditor' then 'Auditor' else 'Secretary' end,
      case p_role when 'nec_auditor' then '11.8' else '11.6' end;
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (p_member, seat, p_role, private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_budget(p_chapter uuid, p_fy integer, p_vote uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); b public.budgets; v public.votes;
begin
  if not private.approves_for(p_chapter) then
    raise exception 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.';
  end if;
  select * into b from public.budgets where chapter_id is not distinct from p_chapter and fy = p_fy for update;
  if not found then raise exception 'Save the budget first.'; end if;
  if b.approved_at is not null then raise exception 'That budget is already approved.'; end if;
  select * into v from public.votes where id = p_vote and result = 'carried' and chapter_id is not distinct from p_chapter
    and electorate = case when p_chapter is null then 'nec' else 'chapter_board' end::public.electorate;
  if not found then raise exception 'Pick a carried board vote for this budget (13.4).'; end if;
  if v.closed_at is null or v.closed_at <= b.updated_at then
    raise exception 'That vote closed before the budget’s last change. It needs a new vote (13.4).';
  end if;
  update public.budgets set approved_vote_id = p_vote, approved_at = now(), approved_by = me
  where chapter_id is not distinct from p_chapter and fy = p_fy;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_debit(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); e public.ledger_entries;
begin
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.approves_for(e.chapter_id) then raise exception 'You can’t approve spending from this fund.'; end if;
  if e.state <> 'awaiting' then raise exception 'That isn’t waiting for approval.'; end if;
  if e.payee_member_id = me then raise exception 'The payee can’t approve their own payment (13.3).'; end if;
  if exists (select 1 from public.ledger_approvals where entry_id = p_id and member_id = me) then
    raise exception 'You’ve already approved this.';
  end if;
  insert into public.ledger_approvals (entry_id, member_id) values (p_id, me);
  update public.ledger_entries
  set state = case when (select count(*) from public.ledger_approvals where entry_id = p_id) >= 2 then 'approved' else 'awaiting' end,
      updated_at = now()
  where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_member(p_member uuid, p_status member_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.members%rowtype;
  today date := private.club_date();
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then
    raise exception 'Only the % board can approve this applicant.', (select name from public.chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  if p_status not in ('introduced', 'fng', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Supporter or Family.';
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;

  update public.members set
    approval = 'approved',
    status = p_status,
    joined_on = coalesce(joined_on, today),
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_minutes(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.minutes_approved_at is not null then raise exception 'Those minutes are approved and locked.'; end if;
  if m.starts_at > now() then raise exception 'The meeting hasn’t happened yet.'; end if;
  if nullif(trim(m.minutes), '') is null then raise exception 'Write the minutes first.'; end if;
  update public.meetings set minutes_approved_at = now(), minutes_approved_by = auth.uid() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_award(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.brag_awards%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can run awards.'; end if;
  select * into a from public.brag_awards where id = p_id for update;
  if not found then raise exception 'No such award.'; end if;
  if a.archived_at is not null then raise exception 'That award has already been taken off.'; end if;
  update public.brag_awards set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_history_entry(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.club_history%rowtype;
begin
  perform private.check_history_keeper();
  select * into e from public.club_history where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if e.archived_at is not null then raise exception 'That entry has already been taken off.'; end if;
  update public.club_history set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_honour(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  h public.club_honours%rowtype;
begin
  perform private.check_history_keeper();
  select * into h from public.club_honours where id = p_id for update;
  if not found then raise exception 'No such honour.'; end if;
  if h.archived_at is not null then raise exception 'That honour has already been taken off.'; end if;
  update public.club_honours set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_invite(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  i public.club_invites%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into i from public.club_invites where id = p_id for update;
  if not found then raise exception 'No such invite.'; end if;
  if i.archived_at is not null then raise exception 'That invite has already been taken off.'; end if;
  if not private.can_change_invite(i) then raise exception 'Only the board or Ride Committee can change that invite.'; end if;
  update public.club_invites set archived_at = now(), archived_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_mechanic(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  m public.mechanics%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.mechanics where id = p_id for update;
  if not found then raise exception 'No such workshop.'; end if;
  if not private.can_edit_mechanic(m.added_by) then
    raise exception 'Only whoever added it or the board can change it.';
  end if;
  if m.archived_at is not null then raise exception 'That workshop is already off the list.'; end if;
  update public.mechanics set archived_at = now(), archived_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_other_club(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.other_clubs%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into c from public.other_clubs where id = p_id for update;
  if not found then raise exception 'No such club.'; end if;
  if c.archived_at is not null then raise exception 'That club is already off the list.'; end if;
  if not private.can_edit_other_club(c.added_by) then
    raise exception 'Only whoever added it, the board or the Ride Committee can change it.';
  end if;
  update public.other_clubs set archived_at = now(), archived_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_route(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  existing public.routes%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into existing from public.routes where id = p_id for update;
  if not found then raise exception 'That route no longer exists.'; end if;
  if not private.manages_chapter_rides(existing.chapter_id) then
    raise exception 'Only the board or ride committee can change routes.';
  end if;
  if existing.archived_at is null then
    update public.routes set archived_at = now(), updated_by = me, updated_at = now() where id = p_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_sponsor(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.sponsors%rowtype;
begin
  perform private.check_sponsor_keeper();
  select * into s from public.sponsors where id = p_id for update;
  if not found then raise exception 'No such sponsor.'; end if;
  if s.archived_at is not null then raise exception 'That sponsor has already been taken off.'; end if;
  update public.sponsors set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ask_swap(p_ride uuid, p_to uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  ride_day date;
  my_role public.crew_role;
  their public.crew_role;
  problem text;
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'The crew can’t change after the ride day.'; end if;
  ride_day := date(ride.starts_at at time zone 'Australia/Melbourne');
  select role into my_role from public.ride_crew where ride_id = p_ride and member_id = me;
  if not found then raise exception 'You’re not on this ride’s crew.'; end if;
  if p_to = me then raise exception 'Pick someone else.'; end if;
  if p_to is null or not exists (select 1 from public.members where id = p_to) then raise exception 'That member no longer exists.'; end if;
  problem := private.crew_eligibility(p_to, my_role, ride_day);
  if problem is not null then raise exception '%', problem; end if;
  if exists (select 1 from public.rsvps where ride_id = p_ride and member_id = p_to and answer = 'no') then
    raise exception 'They said they can’t make it.';
  end if;
  select role into their from public.ride_crew where ride_id = p_ride and member_id = p_to;
  if their = my_role then raise exception 'They already have that spot.'; end if;
  if their is not null then
    problem := private.crew_eligibility(me, their, ride_day);
    if problem is not null then raise exception '%', problem; end if;
  end if;
  if exists (select 1 from public.crew_swaps where ride_id = p_ride and asked_by = me and state = 'asked') then
    raise exception 'You’ve already asked someone. Withdraw that first.';
  end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;
  insert into public.crew_swaps (ride_id, asked_by, role, asked_to, their_role, note)
  values (p_ride, me, my_role, p_to, their, clean_note)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assistant_spent(p_microusd bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  this_month constant date := date_trunc('month', private.club_date())::date;
begin
  if p_microusd is null or p_microusd < 0 then
    raise exception 'The cost can’t be negative.';
  end if;
  insert into private.assistant_months as m (month, spent_microusd) values (this_month, p_microusd)
  on conflict (month) do update set spent_microusd = m.spent_microusd + excluded.spent_microusd;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assistant_start()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today constant date := private.club_date();
  this_month constant date := date_trunc('month', private.club_date())::date;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  asked int;
  spent bigint;
  constitution jsonb;
  road_rules jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved_member() then
    raise exception 'Only approved members can ask the club.';
  end if;
  if not private.assistant_on() then
    raise exception 'Ask the club isn’t switched on yet.';
  end if;

  -- Nothing about who asked lingers: yesterday's count is kept for the day boundary, older goes.
  delete from private.assistant_days where day < today - 1;

  select questions into asked from private.assistant_days where member_id = auth.uid() and day = today for update;
  if coalesce(asked, 0) >= daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  -- Locked, so questions asked at the same moment near the cap queue here rather than all slip through.
  select spent_microusd into spent from private.assistant_months where month = this_month for update;
  if coalesce(spent, 0) >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(today), 'DD/MM/YYYY');
  end if;

  insert into private.assistant_days as d (member_id, day, questions) values (auth.uid(), today, 1)
  on conflict (member_id, day) do update set questions = d.questions + 1;
  insert into private.assistant_months as m (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = m.questions + 1;

  select jsonb_build_object('label', v.label, 'body', v.body) into constitution
  from public.document_versions v join public.documents d on d.id = v.document_id
  where d.kind = 'constitution' order by v.number desc limit 1;
  select jsonb_build_object('number', r.number, 'body', r.body) into road_rules
  from public.road_rules_versions r order by r.number desc limit 1;

  return jsonb_build_object('constitution', constitution, 'road_rules', road_rules);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assistant_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today constant date := private.club_date();
  this_month constant date := date_trunc('month', private.club_date())::date;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  asked int;
  spent bigint;
  month_questions int;
  answer jsonb;
begin
  if not private.is_approved_member() then
    return jsonb_build_object('on', false, 'left_today', 0, 'daily_limit', daily_limit, 'resting_until', null);
  end if;
  select questions into asked from private.assistant_days where member_id = auth.uid() and day = today;
  select m.spent_microusd, m.questions into spent, month_questions from private.assistant_months m where m.month = this_month;
  answer := jsonb_build_object(
    'on', private.assistant_on(),
    'left_today', greatest(daily_limit - coalesce(asked, 0), 0),
    'daily_limit', daily_limit,
    'resting_until', case when coalesce(spent, 0) >= budget then to_char(private.assistant_next_month(today), 'DD/MM/YYYY') end);
  if private.is_national() then
    answer := answer || jsonb_build_object(
      'spent_microusd', coalesce(spent, 0), 'budget_microusd', budget, 'questions', coalesce(month_questions, 0));
  end if;
  return answer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.book_bus(p_first date, p_last date, p_purpose bus_purpose, p_ride uuid, p_driver uuid, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  today date;
  manager boolean;
  clean_notes text;
  straight_away boolean;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The bus lock first, so the clash checked below can't change until this commits.
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  today := private.club_date();
  manager := private.manages_bus();
  if not manager and not exists (
    select 1 from public.members where id = me and approval = 'approved' and status in ('full', 'nomad')
  ) then
    raise exception 'Only Full and Nomad members can book the Rusty Bus.';
  end if;

  if p_first is null or p_last is null then raise exception 'Pick the first and last day.'; end if;
  if p_last < p_first then raise exception 'The last day can’t be before the first.'; end if;
  if p_first < today then raise exception 'Bookings can’t start in the past.'; end if;
  if p_last - p_first + 1 > 14 then raise exception 'Keep a booking to 14 days at most.'; end if;
  if p_first > (today + interval '1 year')::date then raise exception 'Book at most 12 months ahead.'; end if;
  if p_purpose is null then raise exception 'Pick what it’s for.'; end if;
  if p_ride is not null and not exists (select 1 from public.rides where id = p_ride and cancelled_at is null) then
    raise exception 'That ride isn’t on the calendar.';
  end if;
  if p_driver is null or not exists (select 1 from public.members where id = p_driver and approval = 'approved') then
    raise exception 'Pick a driver who’s an approved member.';
  end if;
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_notes) > 500 then raise exception 'Keep the notes to 500 characters at most.'; end if;

  straight_away := manager or (p_purpose = 'recovery' and p_first in (today, today + 1));
  if straight_away and private.bus_clashes(p_first, p_last, null) then
    raise exception 'The Rusty Bus is already booked then.';
  end if;

  insert into public.bus_bookings (first_day, last_day, purpose, ride_id, driver_id, notes, status,
                                   booked_by, booked_at, decided_by, decided_at)
  values (p_first, p_last, p_purpose, p_ride, p_driver, clean_notes,
          case when straight_away then 'approved'::public.bus_status else 'requested'::public.bus_status end,
          me, now(),
          case when straight_away then me end, case when straight_away then now() end)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.brag_tallies()
 RETURNS TABLE(nomination_id uuid, votes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select n.id, (select count(*)::int from public.brag_votes v where v.nomination_id = n.id)
  from public.brag_nominations n
  join public.brag_awards a on a.id = n.award_id
  where private.is_approved_member()
    and a.archived_at is null and n.withdrawn_at is null
    and private.award_phase(a.nominations_close, a.voting_close) = 'closed';
$function$
;

CREATE OR REPLACE FUNCTION public.call_ride(p_ride uuid, p_state ride_call_state, p_reason text, p_new_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  ride_day date;
  clean_reason text;
  line text;
  chat uuid;
  current_state public.ride_call_state;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'It’s too late to call this ride.'; end if;
  if not private.writes_ride(p_ride) then
    raise exception 'Only the board, ride committee or this ride’s Road Captain can call the ride.';
  end if;
  if p_state is null then p_state := 'off'; end if;
  -- A call has to change something (a postponed ride can be postponed again, to a new day).
  select state into current_state from public.ride_calls where ride_id = p_ride;
  current_state := coalesce(current_state, 'on');
  if p_state = 'off' and current_state = 'off' then raise exception 'The ride’s already off.'; end if;
  if p_state = 'on' and current_state = 'on' then raise exception 'The ride isn’t off or postponed.'; end if;
  clean_reason := case when p_state = 'on' then null else nullif(private.trim_like_app(p_reason), '') end;
  if char_length(clean_reason) > 200 then raise exception 'Keep the reason to 200 characters at most.'; end if;
  if p_new_day is not null and p_state <> 'postponed' then raise exception 'Only a postponed ride takes a new day.'; end if;
  ride_day := date(ride.starts_at at time zone 'Australia/Melbourne');
  if p_new_day is not null and (p_new_day <= ride_day or p_new_day > (ride_day + interval '1 year')::date) then
    raise exception 'Pick a new day after the ride, within 12 months.';
  end if;

  insert into public.ride_calls (ride_id, state, reason, new_day, called_by, called_at)
  values (p_ride, p_state, clean_reason, p_new_day, me, now())
  on conflict (ride_id) do update
    set state = excluded.state, reason = excluded.reason, new_day = excluded.new_day,
        called_by = excluded.called_by, called_at = excluded.called_at;

  -- The same line as the app's callLine.
  line := case p_state
    when 'off' then 'Ride’s off'
    when 'postponed' then 'Ride’s postponed' || coalesce(' to ' || to_char(p_new_day, 'DD/MM/YYYY'), '')
    else 'Ride’s back on'
  end || coalesce(': ' || clean_reason, '.');
  -- Rides from before the chat have no chat yet: make it, as ride_chat() does.
  insert into public.conversations (kind, ride_id) values ('ride', p_ride) on conflict do nothing;
  select id into chat from public.conversations where kind = 'ride' and ride_id = p_ride;
  insert into public.messages (conversation_id, author_id, body) values (chat, me, line);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_bus(p_booking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  b public.bus_bookings%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  select * into b from public.bus_bookings where id = p_booking for update;
  if not found then raise exception 'No such booking.'; end if;
  if not (coalesce(b.booked_by = me, false) or coalesce(b.driver_id = me, false) or private.manages_bus()) then
    raise exception 'Only whoever booked it, its driver or the board can cancel it.';
  end if;
  if b.status in ('declined', 'cancelled') then raise exception 'That booking is already off.'; end if;
  if b.last_day < private.club_date() then raise exception 'That booking’s days have passed.'; end if;

  update public.bus_bookings set status = 'cancelled', cancelled_by = me, cancelled_at = now() where id = b.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_meeting(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.starts_at <= now() then raise exception 'That meeting has already started.'; end if;
  update public.meetings set cancelled_at = now() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_merch_order(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); f record;
begin
  select * into f from private.merch_order(p_order);
  if (f.o).member_id <> me and not private.runs_scope(f.chapter) then
    raise exception 'Only whoever ordered it or the board can cancel it.';
  end if;
  if (f.o).status not in ('waiting', 'approved') then raise exception 'That order can’t be cancelled now.'; end if;
  update public.merch_orders set status = 'cancelled', decided_by = coalesce(decided_by, me), decided_at = coalesce(decided_at, now())
  where id = (f.o).id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_shop_order(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); o public.shop_orders;
begin
  o := private.shop_order(p_order);
  if o.member_id <> me and not private.runs_shop() then raise exception 'Only whoever ordered it or the shop can cancel it.'; end if;
  if o.status not in ('held', 'sent') then raise exception 'That order can’t be cancelled now.'; end if;
  update public.shop_orders set status = 'cancelled', cancelled_at = now(), cancelled_by = me where id = o.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cast_ballot(p_vote uuid, p_choice ballot_choice)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cast_brag_vote(p_nomination uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  n public.brag_nominations%rowtype;
  a public.brag_awards%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into n from public.brag_nominations where id = p_nomination and withdrawn_at is null;
  if found then
    select * into a from public.brag_awards where id = n.award_id and archived_at is null;
  end if;
  if n.id is null or a.id is null then raise exception 'No such nomination.'; end if;
  if private.award_phase(a.nominations_close, a.voting_close) <> 'voting' then raise exception 'Voting isn’t open.'; end if;
  if n.nominated_by = me then raise exception 'You can’t vote for your own nomination.'; end if;
  insert into public.brag_votes (award_id, member_id, nomination_id)
  values (a.id, me, n.id)
  on conflict (award_id, member_id) do update set nomination_id = excluded.nomination_id, voted_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.catchup_start(p_chat uuid, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today constant date := private.club_date();
  this_month constant date := date_trunc('month', private.club_date())::date;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  me uuid := auth.uid();
  wanted int := least(greatest(coalesce(p_count, 8), 8), 300);
  chat_kind text;
  asked int;
  spent bigint;
  others int;
  messages jsonb;
  who jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved_member() then
    raise exception 'Only approved members can ask the club.';
  end if;
  select c.kind::text into chat_kind from public.conversations c where c.id = p_chat;
  if chat_kind is null or not private.can_read_chat(p_chat) then
    raise exception 'That chat isn’t one of yours.';
  end if;
  if not private.assistant_on() then
    raise exception 'Ask the club isn’t switched on yet.';
  end if;

  -- The newest messages, oldest first: none removed, none from someone the member has blocked, none
  -- with nothing in them. Each is cut to 1,000 characters and the lot to about 40,000 (the newest
  -- kept), so one catch-up costs cents and a busy chat can't eat the club's month.
  with recent as (
    select m.id, m.author_id, left(nullif(trim(m.body), ''), 1000) as body, m.created_at
    from public.messages m
    where m.conversation_id = p_chat and m.removed_at is null
      and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
      and (nullif(trim(m.body), '') is not null or exists (select 1 from public.message_media mm where mm.message_id = m.id))
    order by m.created_at desc, m.id desc
    limit wanted
  ), picked as (
    select r.* from (
      select recent.*, sum(coalesce(length(recent.body), 0)) over (order by recent.created_at desc, recent.id desc) as running
      from recent
    ) r
    where r.running <= 40000
  )
  select
    count(*) filter (where p.author_id <> me),
    coalesce(jsonb_agg(jsonb_build_object(
      'who', case when p.author_id = me then 'you'
                  when x.id is null then 'a former member'
                  when x.road_name is null then x.full_name
                  else x.full_name || ' (' || x.road_name || ')' end,
      'at', p.created_at,
      'text', p.body,
      'media', (select string_agg(n || ' ' || k || case when n > 1 then 's' else '' end, ', ')
                from (select case mm.kind::text when 'voice' then 'voice note' when 'gif' then 'GIF' else mm.kind::text end as k, count(*) as n from public.message_media mm
                      where mm.message_id = p.id group by mm.kind) media)
    ) order by p.created_at), '[]'::jsonb)
  into others, messages
  from picked p left join public.members x on x.id = p.author_id;

  if others < 3 then
    raise exception 'Nothing much to catch up on.';
  end if;

  -- Counted first and checked after, so questions asked at the same moment can't all slip under the
  -- limit; a refusal rolls its own count back.
  delete from private.assistant_days where day < today - 1;
  insert into private.assistant_days as d (member_id, day, questions) values (me, today, 1)
  on conflict (member_id, day) do update set questions = d.questions + 1
  returning questions into asked;
  if asked > daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  insert into private.assistant_months as mo (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = mo.questions + 1
  returning spent_microusd into spent;
  if spent >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(today), 'DD/MM/YYYY');
  end if;

  select jsonb_build_object('name', x.full_name, 'roadName', x.road_name) into who from public.members x where x.id = me;
  return jsonb_build_object('kind', chat_kind, 'me', who, 'messages', messages);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.change_bus(p_booking uuid, p_first date, p_last date, p_purpose bus_purpose, p_ride uuid, p_driver uuid, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  today date;
  manager boolean;
  b public.bus_bookings%rowtype;
  clean_notes text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  today := private.club_date();
  manager := private.manages_bus();
  select * into b from public.bus_bookings where id = p_booking for update;
  if not found then raise exception 'No such booking.'; end if;
  if not (coalesce(b.booked_by = me, false) or manager) then
    raise exception 'Only whoever booked it or the board can change it.';
  end if;
  if b.status in ('declined', 'cancelled') then raise exception 'That booking is already off.'; end if;
  if b.last_day < today then raise exception 'That booking’s days have passed.'; end if;

  if p_first is null or p_last is null then raise exception 'Pick the first and last day.'; end if;
  if p_last < p_first then raise exception 'The last day can’t be before the first.'; end if;
  if p_first < today and p_first <> b.first_day then raise exception 'Bookings can’t start in the past.'; end if;
  if p_last < today then raise exception 'The last day can’t be before today.'; end if;
  if p_last - p_first + 1 > 14 then raise exception 'Keep a booking to 14 days at most.'; end if;
  if p_first > (today + interval '1 year')::date then raise exception 'Book at most 12 months ahead.'; end if;
  if p_purpose is null then raise exception 'Pick what it’s for.'; end if;
  if p_ride is not null and not exists (select 1 from public.rides where id = p_ride and cancelled_at is null) then
    raise exception 'That ride isn’t on the calendar.';
  end if;
  if p_driver is null or not exists (select 1 from public.members where id = p_driver and approval = 'approved') then
    raise exception 'Pick a driver who’s an approved member.';
  end if;
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_notes) > 500 then raise exception 'Keep the notes to 500 characters at most.'; end if;

  if b.status = 'approved' then
    if (p_first < b.first_day or p_last > b.last_day)
       and not (manager or (p_purpose = 'recovery' and p_first in (today, today + 1))) then
      raise exception 'Only the board or NEC can add days to a Booked booking.';
    end if;
    if private.bus_clashes(p_first, p_last, b.id) then
      raise exception 'The Rusty Bus is already booked then.';
    end if;
  end if;

  update public.bus_bookings
  set first_day = p_first, last_day = p_last, purpose = p_purpose, ride_id = p_ride, driver_id = p_driver,
      notes = clean_notes, changed_by = me, changed_at = now()
  where id = b.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chapter_of(target_member uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select chapter_id from members where id = target_member;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_list()
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
    select jsonb_agg(item)
    from (
      select jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'chapter_id', c.chapter_id, 'ride_id', c.ride_id, 'committee', c.committee,
        'pinned_message_id', c.pinned_message_id,
        'member_ids', coalesce((select jsonb_agg(cm.member_id) from public.conversation_members cm where cm.conversation_id = c.id), '[]'::jsonb),
        'ride', (select private.ride_json(r) from public.rides r where r.id = c.ride_id),
        'last', (
          select jsonb_build_object('id', m.id, 'author_id', m.author_id, 'body', m.body, 'created_at', m.created_at,
                                    'removed', m.removed_at is not null,
                                    'media_count', (select count(*) from public.message_media mm where mm.message_id = m.id),
                                    'voice', m.removed_at is null and exists (
                                      select 1 from public.message_media mm where mm.message_id = m.id and mm.kind::text = 'voice'))
          from public.messages m
          where m.conversation_id = c.id
            and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
          order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from public.messages m
          where m.conversation_id = c.id and m.author_id <> me and m.removed_at is null
            -- Writing in a chat counts as having read everything before it.
            and m.created_at > greatest(
              coalesce((select read_at from public.chat_reads cr where cr.conversation_id = c.id and cr.member_id = me), '-infinity'),
              coalesce((select max(o.created_at) from public.messages o where o.conversation_id = c.id and o.author_id = me), '-infinity'))
            and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        )
      ) as item
      from public.conversations c
      left join public.rides r on r.id = c.ride_id
      where private.can_read_chat(c.id)
        and (c.kind <> 'ride' or (
          exists (select 1 from public.rsvps a where a.ride_id = r.id and a.member_id = me and a.answer in ('going', 'maybe'))
          and (r.starts_at at time zone 'Australia/Melbourne')::date - 7 <= today
          and private.ride_last_day(r) + 3 >= today
        ))
    ) listed
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_reports()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'created_at', r.created_at, 'reporter_id', r.reporter_id,
      'message', jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'author_id', m.author_id,
                                    'body', r.body, 'media_count', r.media_count, 'created_at', m.created_at,
                                    'voice', (select jsonb_build_object('path', mm.path, 'duration_ms', mm.duration_ms)
                                              from public.message_media mm where mm.message_id = m.id and mm.kind::text = 'voice')),
      'chat', jsonb_build_object('id', c.id, 'kind', c.kind, 'chapter_id', c.chapter_id, 'ride_id', c.ride_id,
                                 'committee', c.committee)
    ) as x
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.resolved_at is null and private.is_approved_member() and private.can_act_on_report(r.id)
  ) reports;
$function$
;

CREATE OR REPLACE FUNCTION public.check_in(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  s public.checkin_sessions%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.can_check_in() then raise exception 'Only members and applicants can check in.'; end if;
  if wanted like 'RUSTNUTS:%' then wanted := substr(wanted, 10); end if;
  select * into s from public.checkin_sessions where code = wanted;
  if not found then raise exception 'That code doesn’t match a check-in.'; end if;
  if s.closed_at is not null then raise exception 'That check-in has closed.'; end if;
  if s.held_on <> private.club_date() then raise exception 'That check-in isn’t for today.'; end if;
  insert into public.attendance (session_id, member_id) values (s.id, me) on conflict do nothing;
  return s.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.checkin_code(p_session uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.checkin_sessions%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session;
  if not found then raise exception 'No such check-in.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  return s.code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_payment(p_charge uuid, p_amount_cents integer, p_paid_on date, p_method text, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.charges%rowtype;
  new_id uuid;
begin
  select * into c from public.charges where id = p_charge for update;
  if me is null or not found or c.member_id <> me then raise exception 'You can only pay your own fees.'; end if;
  perform private.check_payment(c, p_amount_cents, p_paid_on, p_method, 'That’s more than you owe.');
  insert into public.payments (charge_id, amount_cents, paid_on, method, reference, state, claimed_by)
  values (p_charge, p_amount_cents, p_paid_on, p_method, nullif(trim(p_reference), ''), 'claimed', me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_roster()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  my_email text;
  entry private.roster%rowtype;
  wanted public.position_role;
  seat uuid;
  bike uuid;
begin
  if me is null then return false; end if;
  if exists (select 1 from public.members where id = me) then return false; end if;

  -- Only a confirmed email counts, and never an anonymous account. (Supabase gives email-code
  -- accounts a random password too, so a password can't be used to tell sign-ups apart; see the
  -- spec for the launch check on password sign-ups.)
  select lower(trim(email)) into my_email from auth.users
  where id = me and email_confirmed_at is not null and not coalesce(is_anonymous, false);
  if my_email is null then return false; end if;

  select * into entry from private.roster
  where lower(trim(email)) = my_email and claimed_by is null
  for update;
  if not found then return false; end if;

  insert into public.members (id, chapter_id, full_name, road_name, status, approval,
                              joined_on, patched_on, fng_started_on, on_hiatus, applied_on)
  values (me, entry.chapter_id, trim(entry.full_name), nullif(trim(entry.road_name), ''), entry.status, 'approved',
          entry.joined_on, entry.patched_on, entry.fng_started_on, entry.on_hiatus and entry.status <> 'legacy',
          coalesce(entry.joined_on, private.club_date()));

  insert into public.member_private (member_id, email, phone) values (me, my_email, nullif(trim(entry.phone), ''));

  -- The sheet doesn't say how they know their contact; the member can fix the label.
  if nullif(trim(entry.emergency_name), '') is not null then
    insert into public.emergency_contacts (member_id, name, relationship, phone)
    values (me, trim(entry.emergency_name), coalesce(nullif(trim(entry.emergency_relationship), ''), 'Emergency contact'),
            trim(entry.emergency_phone));
  end if;

  if nullif(trim(entry.bike_make), '') is not null then
    insert into public.bikes (member_id, make, model) values (me, trim(entry.bike_make), trim(entry.bike_model))
    returning id into bike;
    if nullif(trim(entry.bike_rego), '') is not null then
      insert into public.bike_registrations (bike_id, rego) values (bike, upper(trim(entry.bike_rego)));
    end if;
  end if;

  foreach wanted in array entry.roles loop
    continue when entry.status = 'legacy' and wanted <> 'founder';
    seat := case when wanted in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder') then null else entry.chapter_id end;
    perform private.add_roster_position(me, seat, wanted);
  end loop;

  update private.roster set claimed_by = me, claimed_at = now() where id = entry.id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_audit_request(p_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_auditor();
  r public.audit_requests%rowtype;
  n text;
begin
  select * into r from public.audit_requests where id = p_id for update;
  if not found then raise exception 'That request isn’t there any more.'; end if;
  if r.closed_at is not null then raise exception 'That request is closed.'; end if;
  n := private.audit_text(p_note, 'Say why you’re closing it.', 1000);
  update public.audit_requests set closed_at = now(), closed_by = me, close_note = n where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_checkin(p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.checkin_sessions%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session for update;
  if not found then raise exception 'No such check-in.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  if s.closed_at is not null then raise exception 'That check-in is already closed.'; end if;
  update public.checkin_sessions set closed_at = now() where id = p_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_merch(p_item uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.merch_items;
begin
  perform private.require_member();
  i := private.merch_item_run(p_item);
  if i.status <> 'on_sale' then raise exception 'Only an item on sale can be closed.'; end if;
  update public.merch_items set status = 'closed' where id = i.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_status_notice(p_notice uuid, p_outcome text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  n public.status_notices%rowtype;
  note text := private.trim_like_app(coalesce(p_note, ''));
begin
  select * into n from public.status_notices where id = p_notice for update;
  if not found then raise exception 'No such notice.'; end if;
  if not private.is_board_of(n.chapter_id) then raise exception 'Only their chapter’s board can do that.'; end if;
  if n.member_id = me then raise exception 'Someone else on the board has to do that.'; end if;
  if n.outcome is not null then raise exception 'That notice is closed.'; end if;
  if p_outcome is null or p_outcome not in ('withdrawn', 'decided') then raise exception 'Pick withdrawn or decided.'; end if;
  if char_length(note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  if p_outcome = 'decided' and private.club_date() <= n.respond_by then
    raise exception 'The board decides after % (5.5).', to_char(n.respond_by, 'DD/MM/YYYY');
  end if;
  update public.status_notices
  set outcome = p_outcome, outcome_note = nullif(note, ''), closed_on = private.club_date(), closed_by = me
  where id = p_notice;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_vote(p_vote uuid, p_casting text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  v public.votes%rowtype;
  n_yes int; n_no int; n_abstain int; n_electors int;
  res public.vote_result;
  tied boolean;
  represented boolean;
  about_member boolean;
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
  select d.result, d.tied into res, tied from private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, null, n_electors) d;
  represented := v.electorate <> 'club_patched' or private.chapters_represented(p_vote);
  if not represented then res := 'no_quorum'; tied := false; end if;
  about_member := v.subject_member_id is not null;
  chair := private.chair_of(v.chapter_id);
  if tied and about_member and p_casting is not null then
    raise exception 'No casting vote on a vote about a member (10.7): a tie is lost.';
  end if;
  -- The chair casts or declines, and a declined tie is lost (9.10).
  if tied and not about_member and chair is not null and (p_casting is null or me <> chair) then
    raise exception 'It’s a tie. The chair gives a casting vote or lets it fall.';
  end if;
  if not tied and p_casting is not null then raise exception 'There’s no tie, so no casting vote.'; end if;
  if p_casting in ('yes', 'no') and chair is null then
    raise exception 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';
  end if;
  if p_casting is not null and p_casting not in ('yes', 'no', 'decline') then raise exception 'Pick an answer.'; end if;
  if tied and not about_member then
    select d.result into res from private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, p_casting, n_electors) d;
  end if;

  -- A patch vote keeps only its result (4.9): no counts, and its ballots are blanked.
  if v.subject_member_id is not null and v.subject_role is null and v.electorate = 'chapter_patched' then
    update public.vote_ballots set choice = null where vote_id = p_vote;
    n_yes := null; n_no := null; n_abstain := null;
  end if;
  update public.votes set closed_at = now(), result = res, casting_vote = nullif(p_casting, 'decline'),
    yes_count = n_yes, no_count = n_no, abstain_count = n_abstain
  where id = p_vote;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.club_admin()
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
$function$
;

CREATE OR REPLACE FUNCTION public.club_audit()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  auditor boolean := private.is_auditor();
  nec boolean := private.is_national();
  boards boolean := private.is_any_board();
begin
  if not private.is_approved_member() then
    return jsonb_build_object('requests', '[]'::jsonb, 'reports', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'chapter_id', r.chapter_id, 'kind', r.kind, 'area', r.area, 'title', r.title, 'details', r.details,
        'due_on', r.due_on, 'ledger_entry_id', r.ledger_entry_id, 'raised_by', r.raised_by, 'raised_at', r.raised_at,
        'answer', r.answer, 'answered_by', r.answered_by, 'answered_at', r.answered_at,
        'closed_at', r.closed_at, 'closed_by', r.closed_by, 'close_note', r.close_note) order by r.raised_at desc)
      from public.audit_requests r
      where auditor or nec or private.runs_scope(r.chapter_id)), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'from_on', a.from_on, 'to_on', a.to_on, 'findings', a.findings,
        'recommendations', a.recommendations, 'written_by', a.written_by, 'saved_at', a.saved_at, 'issued_at', a.issued_at)
        order by coalesce(a.issued_at, a.saved_at) desc)
      from public.audit_reports a
      where auditor or (a.issued_at is not null and (nec or boards))), '[]'::jsonb));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.club_business()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        -- A shared draft goes to everyone who sees the meeting (10.8).
        'minutes', case when m.minutes_approved_at is not null or m.minutes_shared_at is not null
                          or private.reviews_scope(m.chapter_id) then m.minutes end,
        'minutes_shared_at', m.minutes_shared_at,
        'minutes_approved_at', m.minutes_approved_at, 'minutes_approved_by', m.minutes_approved_by,
        'cancelled_at', m.cancelled_at, 'created_by', m.created_by) order by m.starts_at, m.id)
      from public.meetings m
      where m.kind not in ('board', 'nec') or private.reviews_scope(m.chapter_id)), '[]'::jsonb),
    'action_items', coalesce((
      select jsonb_agg(to_jsonb(a) - 'created_at' - 'created_by' order by a.due_on nulls last, a.created_at)
      from public.action_items a
      where a.owner_id = me or private.reviews_scope(a.chapter_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'chapter_id', v.chapter_id, 'meeting_id', v.meeting_id, 'subject_member_id', v.subject_member_id,
        'subject_role', v.subject_role,
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
      where private.reviews_scope(v.chapter_id)
         or exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me)), '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.club_documents()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'chapter_id', d.chapter_id, 'kind', d.kind, 'title', d.title, 'asks_sign_off', d.asks_sign_off,
        'review_months', d.review_months, 'reviewed_on', d.reviewed_on, 'created_by', d.created_by, 'created_at', d.created_at)
        order by d.title)
      from public.documents d where private.reads_document(d.kind)), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'document_id', v.document_id, 'number', v.number, 'label', v.label, 'what_changed', v.what_changed,
        'fresh_sign_off', v.fresh_sign_off, 'approving_body', v.approving_body, 'approved_on', v.approved_on,
        'commences_on', v.commences_on, 'published_by', v.published_by, 'published_at', v.published_at)
        order by v.document_id, v.number)
      from public.document_versions v join public.documents d on d.id = v.document_id
      where private.reads_document(d.kind)), '[]'::jsonb),
    'signoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version_id', s.version_id, 'document_id', v.document_id, 'member_id', s.member_id, 'signed_at', s.signed_at)
        order by s.signed_at)
      from public.document_signoffs s
      join public.document_versions v on v.id = s.version_id
      join public.documents d on d.id = v.document_id
      where private.is_approved_member() and (s.member_id = auth.uid() or private.reviews_scope(d.chapter_id))), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.club_ledger()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare reads_reports boolean := exists (
  select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'legacy');
begin
  if not private.is_approved_member() then
    return jsonb_build_object('entries', '[]'::jsonb, 'openings', '[]'::jsonb, 'floats', '[]'::jsonb,
      'budgets', '[]'::jsonb, 'reports', '[]'::jsonb, 'report_totals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'chapter_id', e.chapter_id, 'code', e.code, 'description', e.description, 'amount_cents', e.amount_cents,
        'received_on', e.received_on, 'entry_on', e.entry_on, 'payee_member_id', e.payee_member_id, 'payee_name', e.payee_name,
        'payment_id', e.payment_id, 'state', e.state, 'recorded_by', e.recorded_by, 'recorded_at', e.recorded_at,
        'updated_at', e.updated_at, 'void_reason', e.void_reason, 'voided_by', e.voided_by,
        'approvals', (select coalesce(jsonb_agg(jsonb_build_object('member_id', a.member_id, 'approved_at', a.approved_at)
                                                order by a.approved_at, a.member_id), '[]'::jsonb)
                      from public.ledger_approvals a where a.entry_id = e.id)
        ) order by e.entry_on desc nulls first, e.recorded_at desc)
      from public.ledger_entries e where private.sees_ledger(e.chapter_id)), '[]'::jsonb),
    'openings', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', chapter_id, 'fy', fy, 'amount_cents', amount_cents) order by fy, chapter_id)
      from public.fund_openings), '[]'::jsonb) else '[]'::jsonb end,
    'floats', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('fy', fy, 'amount_cents', amount_cents) order by fy)
      from public.cash_floats), '[]'::jsonb) else '[]'::jsonb end,
    'budgets', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', chapter_id, 'fy', fy, 'lines', lines, 'approved_vote_id', approved_vote_id,
        'approved_at', approved_at, 'approved_by', approved_by, 'updated_at', updated_at) order by fy, chapter_id)
      from public.budgets), '[]'::jsonb) else '[]'::jsonb end,
    'reports', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'presented_at', presented_at, 'presented_by', presented_by) order by month desc)
      from public.treasurer_reports), '[]'::jsonb) else '[]'::jsonb end,
    -- Whoever reads any fund gets every month worked out over all funds, since they can't add up
    -- the funds they can't read; members get the presented months.
    'report_totals', case when exists (
        select 1 from (select null::uuid as id union all select id from public.chapters) f where private.sees_ledger(f.id)) then coalesce((
      select jsonb_agg(private.month_report(m::date) order by m desc)
      from generate_series(
        date_trunc('month', coalesce(least((select min(entry_on) from public.ledger_entries),
                                           (select make_date(min(fy), 7, 1) from public.fund_openings)), private.club_date())),
        date_trunc('month', private.club_date()), interval '1 month') m), '[]'::jsonb)
      when reads_reports then coalesce((
      select jsonb_agg(private.month_report(month) order by month desc) from public.treasurer_reports), '[]'::jsonb)
      else '[]'::jsonb end);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.club_photos(p_before timestamp with time zone, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    with msgs as (
      select m.id, m.created_at,
             (select count(*) from public.message_media mm where mm.message_id = m.id and mm.kind in ('photo', 'video')) as n
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and (p_before is null or m.created_at < p_before)
        and exists (select 1 from public.message_media mm where mm.message_id = m.id and mm.kind in ('photo', 'video'))
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
    ),
    running as (
      select msgs.*, sum(n) over (order by created_at desc, id desc) - n as before_this from msgs
    )
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from running r
    join public.messages m on m.id = r.id
    join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
    where r.before_this < least(greatest(coalesce(p_limit, 60), 1), 200)
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_payment(p_payment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.payments%rowtype;
  c public.charges%rowtype;
begin
  select * into p from public.payments where id = p_payment;
  if not found then raise exception 'No such payment.'; end if;
  select * into c from public.charges where id = p.charge_id for update;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if c.member_id = auth.uid() then raise exception 'Someone else with money rights has to handle your own fees.'; end if;
  select * into p from public.payments where id = p_payment for update;
  if p.state <> 'claimed' then raise exception 'That payment has already been dealt with.'; end if;
  if p.amount_cents > private.owing(c.id) then raise exception 'That’s more than they owe.'; end if;
  update public.payments set state = 'confirmed', decided_by = auth.uid(), decided_at = now(),
    receipt_no = private.next_receipt(c.chapter_id, c.fy)
  where id = p_payment;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.content_reports()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'target_id', r.target_id, 'author_id', r.author_id, 'reporter_id', r.reporter_id,
      'reason', r.reason, 'snapshot', r.snapshot, 'created_at', r.created_at
    ) as x
    from public.content_reports r
    where r.resolved_at is null and private.is_approved_member() and private.can_act_on_content_report(r.id)
  ) reports;
$function$
;

