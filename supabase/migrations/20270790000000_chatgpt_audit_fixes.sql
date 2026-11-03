-- Fixes from the independent (ChatGPT) audit of 3 Nov 2026, checked against the live database first.
-- Report: docs/audit-pack/chatgpt-audit-2026-11-03-register.md.
--   F01 A deleted account can't claim its roster place again (a suspended member could delete, sign up
--       again with the same email and come back approved). claimed_at outlives the sign-in, and
--       deleting an account stamps it.
--   F04 The website sign-up form never overwrites an existing sign-up for the same email.
--   F05 A shop order holds the prices it reads until the order and its lines are written.
--   F07 Ask the club counts a question before checking the daily limit.
--   F08 Every change to a fund's opening balance is kept: old and new amount, who and when.
--   F10 Anyone can step down from their own seat, even while suspended, and the National Chairman's
--       Delete my account points to the club's email instead of a dead end.

create or replace function public.claim_roster()
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
  where lower(trim(email)) = my_email and claimed_by is null and claimed_at is null
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
$function$;


create or replace function public.website_signup(p_ride uuid, p_name text, p_email text, p_phone text, p_riding boolean, p_pillion boolean, p_guests integer, p_guest_names text, p_job text, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ride public.rides%rowtype;
  charity public.charity_rides%rowtype;
  v_name text := private.trim_like_app(p_name);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := nullif(private.trim_like_app(p_phone), '');
  riding boolean := coalesce(p_riding, false);
  pillion boolean := coalesce(p_pillion, false);
  guests int := coalesce(p_guests, 0);
  clean_job text;
  clean_names text;
  clean_notes text;
  on_bikes int;
  taken int;
  new_id uuid;
begin
  select * into ride from public.rides where id = p_ride for no key update;
  if found then select * into charity from public.charity_rides where ride_id = p_ride; end if;
  if ride.id is null or charity.ride_id is null or not charity.website or ride.cancelled_at is not null then
    raise exception 'This ride isn’t taking sign-ups from the website.';
  end if;
  if now() >= private.ride_answers_close(ride) or (charity.closes_on is not null and private.club_date() > charity.closes_on) then
    raise exception 'Sign-ups have closed.';
  end if;
  if coalesce(v_name, '') = '' then raise exception 'Tell us your name.'; end if;
  if char_length(v_name) > 80 then raise exception 'Keep your name to 80 characters.'; end if;
  if char_length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'That email address does not look right.';
  end if;
  if char_length(v_phone) > 30 then raise exception 'Keep the phone number to 30 characters.'; end if;
  clean_job := nullif(private.trim_like_app(p_job), '');
  if not riding and clean_job is null then raise exception 'Say you’re riding, or pick a job to help with.'; end if;
  if not riding and pillion then raise exception 'A pillion needs a rider: say you’re riding too.'; end if;
  if guests < 0 or guests > 10 then raise exception 'Guests: 0 to 10.'; end if;
  if clean_job is not null and clean_job <> all (charity.jobs) then raise exception 'That job isn’t on the list.'; end if;
  clean_names := nullif(private.trim_like_app(p_guest_names), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_names) > 200 or char_length(clean_notes) > 200 then
    raise exception 'Keep it short: 200 characters for guests’ names, 200 for notes.';
  end if;

  -- One at a time, so two sign-ups landing together can't both squeeze under a limit.
  perform pg_advisory_xact_lock(hashtext('website_signup'));
  -- A website form can't prove it owns an email, so it never overwrites someone's sign-up
  -- (ChatGPT audit F04). A change goes through the club.
  if exists (select 1 from public.website_signups w where w.ride_id = p_ride and w.email = v_email) then
    raise exception 'That email is already on the list for this ride. To change it, email the club.';
  end if;
  if (select count(*) from public.website_signups w where w.email = v_email and w.created_at > now() - interval '1 day') >= 5
     or (select count(*) from public.website_signups w where w.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many sign-ups just now. Try again later, or email the club.';
  end if;

  on_bikes := riding::int + pillion::int + guests;
  if charity.places is not null and on_bikes > 0 then
    select coalesce(sum(s.riding::int + s.pillion::int + s.guests), 0) into taken from public.charity_signups s
    where s.ride_id = p_ride and s.withdrawn_at is null;
    taken := taken + private.website_on_bikes(p_ride, v_email);
    if taken + on_bikes > charity.places then raise exception 'The ride’s full.'; end if;
  end if;

  insert into public.website_signups (ride_id, name, email, phone, riding, pillion, guests, guest_names, job, notes)
  values (p_ride, v_name, v_email, v_phone, riding, pillion, guests, clean_names, clean_job, clean_notes)
  returning id into new_id;
  return new_id;
end;
$function$;


create or replace function public.place_shop_order(p_client_ref uuid, p_lines jsonb, p_email text, p_phone text, p_delivery text, p_street text, p_suburb text, p_state text, p_postcode text, p_shipping_method text, p_save_address boolean)
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
  -- Each garment and design read below is held (for share) until the order is written, so a price
  -- changed mid-checkout can't make the total and the lines disagree (ChatGPT audit F05).
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
    select sg.* into g from public.shop_garments sg where sg.id::text = l.garment_id for share;
    if found then select sd.* into d from public.shop_designs sd where sd.id = g.design_id for share; end if;
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
$function$;


create or replace function public.assistant_start()
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

  -- Counted first and checked after (as catchup_start does), so questions sent at the same moment
  -- can't all slip under the limit before the day's row exists; a refusal rolls its count back
  -- (ChatGPT audit F07).
  insert into private.assistant_days as d (member_id, day, questions) values (auth.uid(), today, 1)
  on conflict (member_id, day) do update set questions = d.questions + 1
  returning questions into asked;
  if asked > daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  -- Locked, so questions asked at the same moment near the cap queue here rather than all slip through.
  select spent_microusd into spent from private.assistant_months where month = this_month for update;
  if coalesce(spent, 0) >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(today), 'DD/MM/YYYY');
  end if;

  insert into private.assistant_months as m (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = m.questions + 1;

  select jsonb_build_object('label', v.label, 'body', v.body) into constitution
  from public.document_versions v join public.documents d on d.id = v.document_id
  where d.kind = 'constitution' order by v.number desc limit 1;
  select jsonb_build_object('number', r.number, 'body', r.body) into road_rules
  from public.road_rules_versions r order by r.number desc limit 1;

  return jsonb_build_object('constitution', constitution, 'road_rules', road_rules);
end;
$function$;


create or replace function public.end_position(p_position uuid)
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
  select * into pos from public.positions where id = p_position for update;
  if not found then raise exception 'That position no longer exists.'; end if;
  -- Stepping down from your own seat needs no standing, so a suspended office holder can still step
  -- down and then delete their account (ChatGPT audit F10). Ending anyone else's needs approval.
  if pos.member_id <> me and not private.is_approved_member() then
    raise exception 'Only approved members can do that.';
  end if;
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
$function$;

create or replace function private.forget_member(p_member uuid, p_email text)
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
         bike_make = null, bike_model = null, bike_rego = null, roles = '{}',
         -- Used for good: claim_roster only takes a place never claimed (ChatGPT audit F01).
         claimed_at = coalesce(claimed_at, now())
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
end $function$;

-- F10: the National Chairman can't step down in the app (the seat changes by the club's vote), so
-- Delete my account tells them where to go instead of a dead end.
create or replace function public.delete_my_account()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.positions where member_id = me and ended_on is null and role = 'nec_chair') then
    raise exception 'The National Chairman’s seat changes by the club’s vote. To delete your account, email apps@rustnutssmc.com.au.';
  end if;
  if exists (
    select 1 from public.positions
    where member_id = me and ended_on is null
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                   'nec_chair', 'nec_secretary', 'nec_auditor')
  ) then
    raise exception 'Step down from your seat first, so the club can fill it. Then you can delete your account.';
  end if;
  delete from auth.users where id = me; -- the trigger forgets the member
end $function$;

-- F08 -------------------------------------------------------------------------------------------
create table if not exists public.fund_opening_changes (
  id bigint generated always as identity primary key,
  chapter_id uuid references public.chapters (id),
  fy int not null,
  old_cents int,
  new_cents int,
  changed_by uuid references public.members (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists fund_opening_changes_chapter_id_idx on public.fund_opening_changes (chapter_id);
create index if not exists fund_opening_changes_changed_by_idx on public.fund_opening_changes (changed_by);
alter table public.fund_opening_changes enable row level security;
revoke all on public.fund_opening_changes from anon, authenticated;

create or replace function private.log_fund_opening()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.fund_opening_changes (chapter_id, fy, old_cents, new_cents, changed_by)
    values (old.chapter_id, old.fy, old.amount_cents, null, auth.uid());
    return old;
  end if;
  if tg_op = 'UPDATE' and new.amount_cents is not distinct from old.amount_cents
     and new.chapter_id is not distinct from old.chapter_id and new.fy = old.fy then
    return new;
  end if;
  insert into public.fund_opening_changes (chapter_id, fy, old_cents, new_cents, changed_by)
  values (new.chapter_id, new.fy, case when tg_op = 'UPDATE' then old.amount_cents end, new.amount_cents,
          coalesce(new.set_by, auth.uid()));
  return new;
end;
$$;
revoke all on function private.log_fund_opening() from public, anon, authenticated;

drop trigger if exists fund_openings_log on public.fund_openings;
create trigger fund_openings_log after insert or update or delete on public.fund_openings
  for each row execute function private.log_fund_opening();

-- Openings already set have no earlier history; record where each one stands now.
insert into public.fund_opening_changes (chapter_id, fy, old_cents, new_cents, changed_by, changed_at)
select o.chapter_id, o.fy, null, o.amount_cents, o.set_by, o.set_at
from public.fund_openings o
where not exists (select 1 from public.fund_opening_changes c
                  where c.chapter_id is not distinct from o.chapter_id and c.fy = o.fy);

-- The history, for whoever can read that fund's books.
create or replace function public.fund_opening_history()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'chapter_id', c.chapter_id, 'fy', c.fy, 'old_cents', c.old_cents, 'new_cents', c.new_cents,
    'changed_by', c.changed_by, 'changed_at', c.changed_at) order by c.changed_at, c.id), '[]'::jsonb)
  from public.fund_opening_changes c
  where private.is_approved_member() and private.sees_ledger(c.chapter_id);
$$;
revoke all on function public.fund_opening_history() from public, anon;
grant execute on function public.fund_opening_history() to authenticated;
