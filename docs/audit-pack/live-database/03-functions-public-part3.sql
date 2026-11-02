-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the public schema (these are callable through the API as RPCs if granted; see 02 for grants).
-- Part 3 of 5.

CREATE OR REPLACE FUNCTION public.post_site_news(p_title text, p_body text, p_link text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can post club news.'; end if;
  if v_title = '' then raise exception 'Give the notice a title.'; end if;
  if length(v_title) > 80 then raise exception 'Keep the title to 80 characters.'; end if;
  if v_body = '' then raise exception 'Write what members of the public should know.'; end if;
  if length(v_body) > 400 then raise exception 'Keep the notice to 400 characters.'; end if;
  if v_link is not null and (length(v_link) > 300 or v_link !~ '^https://\S+$') then
    raise exception 'The link must start with https://.';
  end if;
  insert into public.site_news (title, body, link, posted_by)
  values (v_title, v_body, v_link, auth.uid())
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.present_meeting_report(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(null);
begin
  if not exists (select 1 from public.treasurer_meeting_reports where id = p_id) then raise exception 'No such report.'; end if;
  update public.treasurer_meeting_reports set presented_by = me, presented_at = now()
    where id = p_id and presented_at is null;
  if not found then raise exception 'That report is already presented.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.present_report(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(null);
begin
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Pick a month.'; end if;
  if (p_month + interval '1 month' - interval '1 day')::date >= private.club_date() then
    raise exception 'Wait until the month is over.';
  end if;
  if exists (select 1 from public.treasurer_reports where month = p_month) then
    raise exception 'That month is already presented.';
  end if;
  insert into public.treasurer_reports (month, presented_by) values (p_month, me);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.propose_chapter(p_name text, p_area text, p_state text, p_location text, p_membership text, p_leadership text, p_budget text, p_operations text, p_founders uuid[], p_president uuid, p_saa uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  n text := private.trim_like_app(coalesce(p_name, ''));
  a text := private.trim_like_app(coalesce(p_area, ''));
  f uuid[] := coalesce(p_founders, '{}');
  parts text[] := array[p_location, p_membership, p_leadership, p_budget, p_operations];
  labels text[] := array['location', 'membership', 'leadership', 'budget', 'operations'];
  part text;
  problem text;
  new_id uuid;
begin
  if not private.is_national() and not (me = any (f)) then
    raise exception 'Only the NEC or one of the founders can put it forward.';
  end if;
  if n = '' or private.slug_of(n) = '' then raise exception 'Name the chapter.'; end if;
  if char_length(n) > 40 then raise exception 'Keep the name to 40 characters at most.'; end if;
  if private.chapter_name_taken(n, null) then raise exception 'There’s already a chapter called that.'; end if;
  if a = '' then raise exception 'Say where it’s based.'; end if;
  if char_length(a) > 80 then raise exception 'Keep the area to 80 characters at most.'; end if;
  if p_state is null or p_state not in ('VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT') then raise exception 'Pick a state.'; end if;
  for i in 1 .. 5 loop
    part := private.trim_like_app(coalesce(parts[i], ''));
    if part = '' then raise exception 'Cover the % in the proposal (12.1).', labels[i]; end if;
    if char_length(part) > 2000 then raise exception 'Keep each part to 2000 characters at most.'; end if;
  end loop;
  problem := private.founders_problem(f, p_president, p_saa);
  if problem is not null then raise exception '%', problem; end if;
  insert into public.chapter_proposals (name, area, state, plan, founder_ids, president_id, saa_id, proposed_by)
  values (n, a, p_state, jsonb_build_object(
            'location', private.trim_like_app(p_location), 'membership', private.trim_like_app(p_membership),
            'leadership', private.trim_like_app(p_leadership), 'budget', private.trim_like_app(p_budget),
            'operations', private.trim_like_app(p_operations)),
          f, p_president, p_saa, me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.propose_contribution(p_title text, p_purpose text, p_total_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member();
  t text := private.trim_like_app(coalesce(p_title, '')); p text := private.trim_like_app(coalesce(p_purpose, ''));
  sh jsonb; new_id uuid;
begin
  if not private.is_national() then raise exception 'Only the NEC can propose a national contribution (13.6).'; end if;
  if t = '' then raise exception 'Give it a title.'; end if;
  if char_length(t) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
  if p = '' then raise exception 'Say what it’s for.'; end if;
  if char_length(p) > 1000 then raise exception 'Keep it to 1000 characters at most.'; end if;
  if p_total_cents is null or p_total_cents < 100 or p_total_cents > 10000000 then
    raise exception 'Enter a total from $1 to $100,000.';
  end if;
  sh := private.contribution_shares(p_total_cents);
  if not exists (select 1 from jsonb_array_elements(sh) e where (e->>'voting_members')::int > 0) then
    raise exception 'There are no Voting Members to share it between.';
  end if;
  insert into public.national_contributions (title, purpose, total_cents, proposed_by, shares)
  values (t, p, p_total_cents, me, sh) returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.propose_merch(p_chapter uuid, p_name text, p_details text, p_sizes text[], p_price_cents integer, p_patched_only boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  n text := private.trim_like_app(coalesce(p_name, ''));
  d text := private.trim_like_app(coalesce(p_details, ''));
  sz text[] := array(select private.trim_like_app(x) from unnest(coalesce(p_sizes, '{}')) with ordinality as t(x, i) order by i);
  new_id uuid;
begin
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  perform private.require_scope(p_chapter);
  if n = '' then raise exception 'Name it.'; end if;
  if char_length(n) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if char_length(d) > 500 then raise exception 'Keep the details to 500 characters at most.'; end if;
  if cardinality(sz) > 12 or (select count(distinct x) from unnest(sz) x) <> cardinality(sz)
     or exists (select 1 from unnest(sz) x where x is null or x = '' or char_length(x) > 10) then
    raise exception 'Keep sizes to 10 characters, no repeats, 12 at most.';
  end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000 then
    raise exception 'Enter a price from $0.01 to $1,000.';
  end if;
  insert into public.merch_items (chapter_id, name, details, sizes, price_cents, patched_only, proposed_by)
  values (p_chapter, n, nullif(d, ''), sz, p_price_cents, coalesce(p_patched_only, false), me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.public_charity_rides()
 RETURNS TABLE(ride_id uuid, title text, starts_at timestamp with time zone, all_day boolean, location text, cause text, about text, closes_on date, jobs text[], places integer, places_left integer, open boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, r.title, r.starts_at, r.all_day, r.location, c.cause, c.about, c.closes_on, c.jobs, c.places,
    case when c.places is null then null else greatest(0, c.places
      - (select coalesce(sum(s.riding::int + s.pillion::int + s.guests), 0)::int from public.charity_signups s
         where s.ride_id = r.id and s.withdrawn_at is null)
      - private.website_on_bikes(r.id)) end,
    now() < private.ride_answers_close(r) and (c.closes_on is null or private.club_date() <= c.closes_on)
  from public.charity_rides c
  join public.rides r on r.id = c.ride_id
  where c.website and r.cancelled_at is null
    and r.starts_at >= now() - interval '1 day'
    and r.starts_at <  now() + interval '1 year'
  order by r.starts_at, r.id;
$function$
;

CREATE OR REPLACE FUNCTION public.public_documents()
 RETURNS TABLE(kind text, title text, label text, approving_body text, approved_on date, commences_on date, published_at timestamp with time zone, body text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.kind, d.title, v.label, v.approving_body, v.approved_on, v.commences_on, v.published_at, v.body
  from public.documents d
  join public.document_versions v on v.id = coalesce(
    private.document_in_force(d.id, private.club_date()),
    (select n.id from public.document_versions n where n.document_id = d.id order by n.number desc limit 1))
  where d.kind = 'constitution';
$function$
;

CREATE OR REPLACE FUNCTION public.public_rides()
 RETURNS TABLE(id uuid, title text, starts_at timestamp with time zone, ends_at timestamp with time zone, all_day boolean, category ride_category, location text, notes text, cancelled_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, r.title, r.starts_at, r.ends_at, r.all_day, r.category, r.location,
         case when r.source = 'app' then null else r.notes end as notes,
         r.cancelled_at
  from public.rides r
  where (r.source = 'feed' or r.website)
    and r.starts_at >= now() - interval '1 year'
    and r.starts_at <  now() + interval '2 years'
  order by r.starts_at, r.id;
$function$
;

CREATE OR REPLACE FUNCTION public.public_site_news()
 RETURNS TABLE(id uuid, title text, body text, link text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select n.id, n.title, n.body, n.link, n.created_at
  from public.site_news n
  where n.removed_at is null and n.created_at > now() - interval '60 days'
  order by n.created_at desc, n.id
  limit 5;
$function$
;

CREATE OR REPLACE FUNCTION public.public_site_photos()
 RETURNS TABLE(id uuid, bucket text, path text, width integer, height integer, caption text, taken_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.bucket, p.path, p.width, p.height, p.caption,
         coalesce((select m.created_at from public.message_media mm join public.messages m on m.id = mm.message_id where mm.id = p.media_id), p.picked_at) as taken_at
  from public.site_photos p
  where p.status = 'live'
  order by taken_at desc, p.id
  limit 60;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_document_version(p_document uuid, p_expected integer, p_label text, p_body text, p_what_changed text, p_fresh_sign_off boolean, p_approving_body text, p_approved_on date, p_commences_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  doc public.documents;
  latest int;
  label text := coalesce(private.trim_like_app(p_label), '');
  body text := coalesce(private.trim_like_app(p_body), '');
  changes text := coalesce(private.trim_like_app(p_what_changed), '');
  new_id uuid;
begin
  -- Two publishers at once: the second waits here, then sees the first one's version.
  select * into doc from public.documents where id = p_document for update;
  if not found then raise exception 'That document isn’t in the library.'; end if;
  perform private.require_scope(doc.chapter_id);
  select coalesce(max(number), 0) into latest from public.document_versions where document_id = p_document;
  if latest is distinct from p_expected then
    raise exception 'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the document again.';
  end if;
  if label = '' then raise exception 'Give the version a label, like v2.'; end if;
  if char_length(label) > 20 then raise exception 'Keep the label to 20 characters at most.'; end if;
  if body = '' then raise exception 'Write the document’s text first.'; end if;
  if char_length(body) > 200000 then raise exception 'That’s too long (200000 characters at most).'; end if;
  if char_length(changes) > 500 then raise exception 'Keep what changed to 500 characters at most.'; end if;
  perform private.check_document_approval(p_approving_body, p_approved_on, p_commences_on);
  insert into public.document_versions (document_id, number, label, body, what_changed, fresh_sign_off,
    approving_body, approved_on, commences_on, published_by)
  values (p_document, latest + 1, label, body, changes, latest = 0 or coalesce(p_fresh_sign_off, true),
    p_approving_body, p_approved_on, p_commences_on, me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_road_rules(p_body text, p_changes text, p_fresh boolean, p_seen integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  current_number int;
  next_number int;
  clean_body text;
  clean_changes text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The publish lock first, so the number read below can't change until this commits.
  perform pg_advisory_xact_lock(hashtext('road_rules_publish'));
  if not private.is_national() then raise exception 'Only the NEC can publish the Road Rules.'; end if;
  select coalesce(max(number), 0) into current_number from public.road_rules_versions;
  if p_seen is null or current_number <> p_seen then
    raise exception 'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the Road Rules again.';
  end if;

  clean_body := coalesce(private.trim_like_app(p_body), '');
  clean_changes := nullif(private.trim_like_app(p_changes), '');
  if clean_body = '' then raise exception 'Write the Road Rules first.'; end if;
  if char_length(clean_body) > 20000 then raise exception 'That’s too long (20000 characters at most).'; end if;
  if char_length(clean_changes) > 500 then raise exception 'Keep what changed to 500 characters at most.'; end if;

  next_number := current_number + 1;
  insert into public.road_rules_versions (number, body, changes, fresh, published_by, published_at)
  values (next_number, clean_body, clean_changes, next_number = 1 or coalesce(p_fresh, true), me, now());
  return next_number;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_done(p_done bigint[], p_failed jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update private.storage_purge set done_at = now(), error = null where id = any (coalesce(p_done, '{}'::bigint[]));
  update private.storage_purge p set taken_at = null, error = left(f.error, 500)
  from jsonb_to_recordset(coalesce(p_failed, '[]'::jsonb)) as f(id bigint, error text)
  where p.id = f.id and p.done_at is null;
end $function$
;

CREATE OR REPLACE FUNCTION public.purge_take(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare taken bigint[];
begin
  update private.storage_purge set taken_at = null
  where done_at is null and taken_at is not null and taken_at < now() - interval '10 minutes';
  select array_agg(id) into taken from (
    select id from private.storage_purge
    where done_at is null and taken_at is null and attempts < 5
    order by id limit greatest(coalesce(p_limit, 100), 1) for update skip locked
  ) q;
  if taken is null then return '[]'::jsonb; end if;
  update private.storage_purge set taken_at = now(), attempts = attempts + 1 where id = any (taken);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'bucket', bucket, 'path', path) order by id)
                   from private.storage_purge where id = any (taken)), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.push_done(p_sent bigint[], p_failed bigint[], p_dead_tokens text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update private.push_outbox set status = 'sent', sent_at = now() where id = any (p_sent);
  update private.push_outbox set status = 'failed', sent_at = now() where id = any (p_failed);
  delete from public.push_devices where token = any (p_dead_tokens);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.push_take(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  enabled boolean := private.push_enabled();
  taken bigint[];
begin
  -- A run that died after claiming rows (a timeout, a failed hand-back): count them as failed.
  update private.push_outbox set status = 'failed', sent_at = now()
  where status = 'sending' and created_at < now() - interval '10 minutes';
  if not enabled then
    update private.push_outbox set status = 'held' where status = 'queued';
    return jsonb_build_object('enabled', false, 'messages', '[]'::jsonb);
  end if;
  select array_agg(id) into taken from (
    select id from private.push_outbox where status = 'queued' order by id limit p_limit for update skip locked
  ) q;
  if taken is null then return jsonb_build_object('enabled', true, 'messages', '[]'::jsonb); end if;
  update private.push_outbox o set status = 'skipped', sent_at = now()
  where o.id = any (taken) and not exists (select 1 from public.push_devices d where d.member_id = o.member_id);
  update private.push_outbox set status = 'sending' where id = any (taken) and status = 'queued';
  return jsonb_build_object('enabled', true, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'body', o.body, 'data', o.data,
      'tokens', (select jsonb_agg(d.token order by d.token) from public.push_devices d where d.member_id = o.member_id),
      'rev', coalesce((select p.rev_sound from public.notification_prefs p where p.member_id = o.member_id), true))
      order by o.id)
    from private.push_outbox o where o.id = any (taken) and o.status = 'sending'), '[]'::jsonb));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.raise_audit_request(p_chapter uuid, p_kind text, p_area text, p_title text, p_details text, p_due date, p_ledger_entry uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_auditor();
  line public.ledger_entries%rowtype;
  t text;
  d text;
  new_id uuid;
begin
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'Pick a chapter, or the NEC.';
  end if;
  if p_kind is null or p_kind not in ('information', 'correction') then raise exception 'Pick information or correction.'; end if;
  if p_area is null or p_area not in ('policy', 'membership', 'attendance', 'event_funds', 'bank', 'transactions', 'controls') then
    raise exception 'Pick what it’s about.';
  end if;
  t := private.audit_text(p_title, 'Give it a title.', 120);
  d := private.audit_text(p_details, 'Say what you need.', 4000);
  if p_due is not null and p_due < private.club_date() then raise exception 'Pick a due date from today on, or none.'; end if;
  if p_ledger_entry is not null then
    select * into line from public.ledger_entries where id = p_ledger_entry;
    if not found then raise exception 'That line isn’t in the books.'; end if;
    if line.chapter_id is distinct from p_chapter then raise exception 'That line is in another fund.'; end if;
  end if;
  insert into public.audit_requests (chapter_id, kind, area, title, details, due_on, ledger_entry_id, raised_by)
  values (p_chapter, p_kind, p_area, t, d, p_due, p_ledger_entry, me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.raise_charge(p_member uuid, p_description text, p_amount_cents integer, p_due_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.members%rowtype;
  new_id uuid;
begin
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.can_manage_fees(target.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Add what it’s for.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_due_on is null then raise exception 'Pick a due date.'; end if;
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  values (p_member, target.chapter_id, private.club_year_of(private.club_date()), 'other', trim(p_description), p_amount_cents, p_due_on, auth.uid())
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.raise_fees(p_chapter uuid, p_fy integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if not exists (select 1 from public.fee_rates where chapter_id = p_chapter and fy = p_fy) then
    raise exception 'Set this year’s fees first.';
  end if;
  -- A Full member patched after this year's AGM pays for the months left (Jeff, 25 Oct 2026).
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  select m.id, p_chapter, p_fy, 'annual', private.pro_rata_note(pr.months), private.pro_rata_cents(r.amount_cents, pr.months),
         r.due_on, auth.uid()
  from public.members m
  join public.fee_rates r on r.chapter_id = m.chapter_id and r.fy = p_fy and r.status = m.status
  cross join lateral (select case when m.status = 'full' then private.pro_rata_months(m.patched_on, p_fy) else 12 end as months) pr
  where m.chapter_id = p_chapter and m.approval = 'approved' and not m.on_hiatus
    and pr.months > 0 -- patched after that year ended
  on conflict (member_id, fy, kind) where kind in ('annual', 'continuation') do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.raise_ride_alert(p_ride uuid, p_kind ride_alert_kind, p_lat double precision, p_lng double precision, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  problem text := private.live_problem(p_ride);
  pressed timestamptz := least(now(), greatest(coalesce(p_at, now()), now() - interval '12 hours'));
  new_id uuid;
begin
  if problem is not null then raise exception '%', problem; end if;
  if p_kind = 'regroup' then
    if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
    if not private.is_ride_leader(me) then raise exception 'Only ride leaders can set a regroup pin.'; end if;
  end if;
  problem := private.fix_problem(p_lat, p_lng);
  if problem is not null then raise exception '%', problem; end if;

  if p_kind = 'regroup' then
    update public.ride_alerts set resolved_at = now(), resolved_by = me
    where ride_id = p_ride and kind = 'regroup' and resolved_at is null;
    insert into public.ride_alerts (ride_id, member_id, kind, lat, lng) values (p_ride, me, p_kind, p_lat, p_lng)
    returning id into new_id;
  else
    -- A phone that lost the answer sends the same press again: that's the same alert, even if a
    -- leader has cleared it since.
    if p_at is not null then
      select id into new_id from public.ride_alerts
      where ride_id = p_ride and member_id = me and kind = p_kind and created_at = pressed and resolved_at is not null;
      if found then return new_id; end if;
    end if;
    insert into public.ride_alerts as a (ride_id, member_id, kind, lat, lng, created_at)
    values (p_ride, me, p_kind, p_lat, p_lng, pressed)
    on conflict (ride_id, member_id, kind) where resolved_at is null and kind <> 'regroup'
    do update set lat = coalesce(excluded.lat, a.lat), lng = coalesce(excluded.lng, a.lng)
    returning id into new_id;
  end if;

  if p_kind = 'out' then
    delete from public.live_riders where ride_id = p_ride and member_id = me;
  end if;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rate_route(p_route uuid, p_stars integer, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  r public.routes%rowtype;
  clean_comment text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.routes where id = p_route;
  if not found then raise exception 'That route no longer exists.'; end if;
  if r.archived_at is not null then raise exception 'That route is archived.'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'Pick 1 to 5 stars.'; end if;
  clean_comment := nullif(private.trim_like_app(p_comment), '');
  if char_length(clean_comment) > 280 then raise exception 'Keep the comment to 280 characters at most.'; end if;
  insert into public.route_ratings (route_id, member_id, stars, comment, rated_at)
  values (p_route, me, p_stars, clean_comment, now())
  on conflict (route_id, member_id) do update
    set stars = excluded.stars, comment = excluded.comment, rated_at = excluded.rated_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.read_briefing(p_ride uuid, p_seen timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  stored timestamptz;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.rides where id = p_ride) then raise exception 'No such ride.'; end if;
  -- Shared, so a save still in progress finishes first and this checks the version it leaves.
  select updated_at into stored from public.ride_briefings where ride_id = p_ride for share;
  if not found then raise exception 'There’s no briefing for this ride yet.'; end if;
  if p_seen is null or stored > p_seen + interval '1 millisecond' then
    raise exception 'The briefing changed while you had it open. Read the new version, then tap Got it.';
  end if;

  insert into public.ride_briefing_reads (ride_id, member_id, read_at) values (p_ride, me, now())
  on conflict (ride_id, member_id) do update set read_at = excluded.read_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_agm(p_held_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role in ('nec_chair', 'nec_secretary')
  )) then
    raise exception 'Only the National Chairman or Secretary records the AGM.';
  end if;
  if p_held_on is null then raise exception 'Pick the AGM date.'; end if;
  if extract(month from p_held_on) < 7 then raise exception 'The AGM is held between July and December.'; end if;
  insert into public.agms (year, held_on, recorded_by) values (extract(year from p_held_on)::int, p_held_on, auth.uid())
  on conflict (year) do update set held_on = excluded.held_on, recorded_by = excluded.recorded_by, recorded_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_conduct(p_member uuid, p_kind text, p_summary text, p_rule text, p_decided date, p_notice date, p_suspended date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_credit(p_chapter uuid, p_code text, p_description text, p_amount_cents integer, p_received_on date, p_entry_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(p_chapter); new_id uuid;
begin
  if not exists (select 1 from public.ledger_codes where code = p_code and direction = 'credit') then
    raise exception 'Pick a money-in code.';
  end if;
  if coalesce(private.trim_like_app(p_description), '') = '' then raise exception 'Say what it’s for.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_entry_on is null then raise exception 'Pick the date it was banked.'; end if;
  if p_entry_on > private.club_date() then raise exception 'That date hasn’t happened yet.'; end if;
  if p_received_on > p_entry_on then raise exception 'It can’t be banked before it came in.'; end if;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, state, recorded_by)
  values (p_chapter, p_code, private.trim_like_app(p_description), p_amount_cents, coalesce(p_received_on, p_entry_on),
          p_entry_on, 'paid', me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_debit(p_chapter uuid, p_code text, p_description text, p_amount_cents integer, p_payee_member uuid, p_payee_name text, p_paid_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(p_chapter); new_id uuid; bank boolean := p_code = 'DB-004';
begin
  if not exists (select 1 from public.ledger_codes where code = p_code and direction = 'debit') then
    raise exception 'Pick a money-out code.';
  end if;
  if coalesce(private.trim_like_app(p_description), '') = '' then raise exception 'Say what it’s for.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if bank then
    if p_paid_on is null then raise exception 'Pick the date the bank took it.'; end if;
    if p_paid_on > private.club_date() then raise exception 'That date hasn’t happened yet.'; end if;
  elsif p_payee_member is not null then
    if not private.is_approved(p_payee_member) then raise exception 'No such member.'; end if;
  elsif coalesce(private.trim_like_app(p_payee_name), '') = '' then
    raise exception 'Say who’s being paid.';
  end if;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, entry_on, payee_member_id, payee_name, state, recorded_by)
  values (p_chapter, p_code, private.trim_like_app(p_description), p_amount_cents, case when bank then p_paid_on end,
          case when bank then null else p_payee_member end,
          case when bank then coalesce(nullif(private.trim_like_app(p_payee_name), ''), 'Bank')
               else nullif(private.trim_like_app(p_payee_name), '') end,
          case when bank then 'paid' else 'awaiting' end, me)
  returning id into new_id;
  if not bank and private.approves_for(p_chapter) and p_payee_member is distinct from me then
    insert into public.ledger_approvals (entry_id, member_id) values (new_id, me);
  end if;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_document_approval(p_version uuid, p_approving_body text, p_approved_on date, p_commences_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); v public.document_versions; doc public.documents;
begin
  select * into v from public.document_versions where id = p_version for update;
  if not found then raise exception 'That version isn’t in the library.'; end if;
  select * into doc from public.documents where id = v.document_id;
  perform private.require_scope(doc.chapter_id);
  if v.approved_on is not null then raise exception 'Its approval is already recorded.'; end if;
  if p_approving_body is null and p_approved_on is null and p_commences_on is null then
    raise exception 'Give the approving body, the approval date and the commencement date together.';
  end if;
  perform private.check_document_approval(p_approving_body, p_approved_on, p_commences_on);
  update public.document_versions
  set approving_body = p_approving_body, approved_on = p_approved_on, commences_on = p_commences_on
  where id = p_version;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_fng_review(p_member uuid, p_at_months integer, p_outcome text, p_for integer, p_against integer, p_abstained integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  due record;
  today date := private.club_date();
  full_fee int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_member = me then raise exception 'You can’t record your own review.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can record this review.'; end if;
  select * into due from private.fng_due(p_member);
  if due.at_months is null then raise exception 'They’re not an FNG.'; end if;
  if p_at_months is distinct from due.at_months then raise exception 'Record the review that’s due.'; end if;
  if due.due_on - today > 30 then raise exception 'That review isn’t due yet.'; end if;
  perform private.check_votes(p_for, p_against, p_abstained);
  if p_outcome not in ('continue', 'patch', 'not_continuing') then raise exception 'Pick an outcome.'; end if;
  -- Patching in is the chapter's Full Members' call, by a patch vote, not the board's tally (4.9).
  if p_outcome = 'patch' then
    if target.fng_started_on is not null and target.fng_started_on + interval '9 months' > today then
      raise exception 'Full Membership can’t be granted before nine months (4.7).';
    end if;
    if not private.has_carried_patch_vote(p_member) then
      raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
    end if;
  end if;

  insert into public.member_decisions (member_id, kind, at_months, outcome, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'fng_review', p_at_months, p_outcome, p_for, p_against, p_abstained, nullif(trim(p_note), ''),
          today, me);

  if p_outcome = 'patch' then
    update public.members set status = 'full', patched_on = coalesce(patched_on, today), updated_at = now() where id = p_member;
  elsif p_outcome = 'not_continuing' then
    update public.members set status = 'supporter', updated_at = now() where id = p_member;
  elsif p_at_months >= 12 and not target.on_hiatus then
    -- Past twelve months, carrying on as an FNG costs half the chapter's Full fee for the club year
    -- (Jeff, 25 Oct 2026: "half the full member fee"),
    -- once ever (4.11). Members on hiatus don't pay.
    select amount_cents into full_fee from public.fee_rates
    where chapter_id = target.chapter_id and fy = private.club_year_of(today) and status = 'full';
    if full_fee / 2 > 0 and not exists (
      select 1 from public.charges where member_id = p_member and kind = 'continuation'
    ) then
      insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
      values (p_member, target.chapter_id, private.club_year_of(today), 'continuation', 'FNG continuation fee', full_fee / 2,
              today + 30, me);
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_payment(p_charge uuid, p_amount_cents integer, p_paid_on date, p_method text, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.charges%rowtype;
  new_id uuid;
begin
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'No such charge.'; end if;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if c.member_id = auth.uid() then raise exception 'Someone else with money rights has to handle your own fees.'; end if;
  perform private.check_payment(c, p_amount_cents, p_paid_on, p_method, 'That’s more than they owe.');
  insert into public.payments (charge_id, amount_cents, paid_on, method, reference, state, decided_by, decided_at, receipt_no)
  values (p_charge, p_amount_cents, p_paid_on, p_method, nullif(trim(p_reference), ''), 'confirmed', auth.uid(), now(),
          private.next_receipt(c.chapter_id, c.fy))
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_ride_sync_error(p_feed uuid, p_error text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update private.ride_feeds set last_error = left(p_error, 500) where id = p_feed;
$function$
;

CREATE OR REPLACE FUNCTION public.register_hub(p_ride uuid, p_staying hub_staying, p_pillion boolean, p_share_with text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  hub public.ride_hubs%rowtype;
  clean_share text;
  clean_notes text;
  taken int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  select * into hub from public.ride_hubs where ride_id = p_ride;
  if not found then raise exception 'This ride doesn’t take registrations.'; end if;
  if now() >= private.ride_answers_close(ride) or (hub.closes_on is not null and private.club_date() > hub.closes_on) then
    raise exception 'Registrations have closed.';
  end if;
  if hub.members_only and not exists (
    select 1 from public.members where id = me and status in ('fng', 'full', 'nomad')
  ) then
    raise exception 'This one’s for FNG, Full and Nomad members.';
  end if;
  clean_share := nullif(private.trim_like_app(p_share_with), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_share) > 80 or char_length(clean_notes) > 200 then
    raise exception 'Keep it short: 80 characters for who you’re sharing with, 200 for notes.';
  end if;
  if p_staying is null then p_staying := 'group'; end if;
  if p_staying = 'group' and hub.beds is not null then
    select coalesce(sum(1 + pillion::int), 0) into taken from public.hub_registrations
    where ride_id = p_ride and staying = 'group' and withdrawn_at is null and member_id <> me;
    if taken + 1 + coalesce(p_pillion, false)::int > hub.beds then raise exception 'The group booking is full.'; end if;
  end if;
  insert into public.hub_registrations (ride_id, member_id, staying, pillion, share_with, notes, registered_at, withdrawn_at)
  values (p_ride, me, p_staying, coalesce(p_pillion, false), clean_share, clean_notes, now(), null)
  on conflict (ride_id, member_id) do update
    set staying = excluded.staying, pillion = excluded.pillion, share_with = excluded.share_with,
        notes = excluded.notes, registered_at = excluded.registered_at, withdrawn_at = null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_push_device(p_token text, p_platform text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.push_devices (token, member_id, platform, updated_at) values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update set member_id = auth.uid(), platform = excluded.platform, updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_payment(p_payment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.payments%rowtype;
  c public.charges%rowtype;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'No such payment.'; end if;
  select * into c from public.charges where id = p.charge_id;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if c.member_id = auth.uid() then raise exception 'Someone else with money rights has to handle your own fees.'; end if;
  if p.state <> 'claimed' then raise exception 'That payment has already been dealt with.'; end if;
  update public.payments set state = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_payment;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_bike(p_bike uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  delete from public.bikes where id = p_bike and member_id = auth.uid();
  if not found then raise exception 'You can only remove your own bikes.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_conduct(p_record uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.conduct_records;
begin
  perform private.require_member();
  perform private.purge_conduct();
  r := private.conduct_board_record(p_record);
  delete from public.conduct_records where id = r.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_contact(p_contact uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  delete from public.emergency_contacts where id = p_contact and member_id = auth.uid();
  if not found then raise exception 'You can only remove your own contacts.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_message(p_message uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if m.author_id <> auth.uid() and not private.can_moderate(m.conversation_id) then
    raise exception 'You can only remove your own messages.';
  end if;
  perform private.remove_message_now(p_message, auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_shop_picture(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pth text;
begin
  perform private.require_runs_shop();
  delete from public.shop_pictures where id = p_id returning path into pth;
  if pth is null then raise exception 'No such picture.'; end if;
  return pth;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_site_news(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n public.site_news%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can post club news.'; end if;
  select * into n from public.site_news where id = p_id for update;
  if not found then raise exception 'No such notice.'; end if;
  if n.removed_at is not null then raise exception 'That notice has already been taken down.'; end if;
  update public.site_news set removed_at = now(), removed_by = auth.uid() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_site_photo(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  p public.site_photos%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into p from public.site_photos where id = p_id for update;
  if not found then raise exception 'No such photo.'; end if;
  if not private.is_site_photo_editor() and p.posted_by is distinct from me then
    raise exception 'Only the website photo crew or the member who posted it can take it down.';
  end if;
  if p.status = 'removed' then raise exception 'That photo has already been taken down.'; end if;
  update public.site_photos set status = 'removed', removed_at = now(), removed_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_website_signup(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  w public.website_signups%rowtype;
  ride public.rides%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into w from public.website_signups where id = p_id;
  if not found or not private.runs_charity(w.ride_id) then raise exception 'No such sign-up.'; end if;
  select * into ride from public.rides where id = w.ride_id for no key update;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'Sign-ups can’t change after the ride day.'; end if;
  delete from public.website_signups where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.renew_auditor()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  seat public.positions%rowtype;
  unfit text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_chairman() then raise exception 'Only the National Chairman renews the National Auditor.'; end if;
  select * into seat from public.positions where role = 'nec_auditor' and ended_on is null for update;
  if not found then raise exception 'There’s no sitting National Auditor to renew.'; end if;
  if seat.member_id = me then raise exception 'You can’t renew yourself.'; end if;
  if (seat.started_on + interval '1 year')::date - private.club_date() > 60 then
    raise exception 'The Auditor’s term isn’t ending yet. Renew in its last 60 days.';
  end if;
  unfit := private.hold_problem(seat.member_id, 'nec_auditor');
  if unfit is not null then raise exception '%', unfit; end if;
  if not private.has_carried_auditor_vote(seat.member_id) then
    raise exception 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).';
  end if;
  update public.positions set ended_on = greatest(private.club_date(), seat.started_on), ended_by = me where id = seat.id;
  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (seat.member_id, null, 'nec_auditor', private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reopen_budget(p_chapter uuid, p_fy integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_member();
  if not private.approves_for(p_chapter) then
    raise exception 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.';
  end if;
  update public.budgets set approved_vote_id = null, approved_at = null, approved_by = null, updated_at = now()
  where chapter_id is not distinct from p_chapter and fy = p_fy and approved_at is not null;
  if not found then raise exception 'That budget isn’t approved.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_content(p_kind text, p_target uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  t record;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  out uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_kind is null or p_kind not in ('listing', 'build_update', 'nomination', 'mechanic', 'profile') then
    raise exception 'Pick what you’re reporting.';
  end if;
  select * into t from private.content_report_target(p_kind, p_target);
  if not t.present then
    raise exception '%', case p_kind
      when 'listing' then 'No such listing.' when 'build_update' then 'No such update.'
      when 'nomination' then 'No such nomination.' when 'mechanic' then 'No such workshop.'
      else 'That member no longer exists.' end;
  end if;
  if t.gone then
    raise exception '%', case p_kind
      when 'listing' then 'That listing has been taken down.' when 'build_update' then 'That update has been taken down.'
      when 'nomination' then 'That nomination has been withdrawn.' when 'mechanic' then 'That workshop is off the list.'
      else 'They’re not an approved member.' end;
  end if;
  if t.author = me then
    raise exception '%', case p_kind
      when 'listing' then 'You can’t report your own listing.' when 'build_update' then 'You can’t report your own update.'
      when 'nomination' then 'You can’t report your own nomination.' when 'mechanic' then 'You can’t report your own workshop.'
      else 'You can’t report your own profile.' end;
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Keep the reason under 500 characters.'; end if;

  insert into public.content_reports (kind, target_id, author_id, reporter_id, reason, snapshot)
  values (p_kind, p_target, t.author, me, reason, t.snapshot)
  -- Reporting again changes the reason of an open report.
  on conflict (kind, target_id, reporter_id) where resolved_at is null do update
    set reason = excluded.reason, snapshot = excluded.snapshot, author_id = excluded.author_id
  returning id into out;
  return out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_message(p_message uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.messages%rowtype;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  out uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if m.author_id = auth.uid() then raise exception 'You can’t report your own message.'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Keep the reason under 500 characters.'; end if;

  insert into public.message_reports (message_id, reporter_id, reason, body, media_count)
  values (p_message, auth.uid(), reason, m.body, (select count(*) from public.message_media where message_id = p_message))
  on conflict (message_id, reporter_id) do update
    set reason = excluded.reason
  returning id into out;
  return out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resend_shop_order(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.shop_orders;
begin
  perform private.require_member();
  o := private.shop_order(p_order);
  if not private.runs_shop() then raise exception 'Only the people who run the shop can do that.'; end if;
  if o.status <> 'held' then raise exception 'Only a held order can be resent.'; end if;
  return private.shop_order_json(o);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_content_report(p_report uuid, p_remove boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  r public.content_reports%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.content_reports where id = p_report for update;
  if not found then raise exception 'No such report.'; end if;
  if not private.can_act_on_content_report(p_report) then
    raise exception '%', case when r.kind = 'profile' then 'Only that member’s chapter board can do that.' else 'Only the board can do that.' end;
  end if;
  if r.resolved_at is not null then raise exception 'That report was already dealt with.'; end if;
  if p_remove then
    if r.kind = 'listing' then
      update public.listings set taken_down_at = now(), taken_down_by = me, updated_at = now() where id = r.target_id and taken_down_at is null;
    elsif r.kind = 'build_update' then
      update public.build_updates set taken_down_at = now(), taken_down_by = me where id = r.target_id and taken_down_at is null;
    elsif r.kind = 'nomination' then
      update public.brag_nominations set withdrawn_at = now(), withdrawn_by = me where id = r.target_id and withdrawn_at is null;
    elsif r.kind = 'mechanic' then
      update public.mechanics set archived_at = now(), archived_by = me, updated_at = now() where id = r.target_id and archived_at is null;
    elsif r.kind = 'profile' then
      update public.members set bio = null, updated_at = now() where id = r.target_id and bio is not null;
    end if;
  end if;
  update public.content_reports set resolved_at = now(), resolved_by = me, outcome = case when p_remove then 'removed' else 'dismissed' end::public.report_outcome
  where kind = r.kind and target_id = r.target_id and resolved_at is null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_report(p_report uuid, p_remove boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.message_reports%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.message_reports where id = p_report;
  if not found then raise exception 'No such report.'; end if;
  if not private.can_act_on_report(p_report) then raise exception 'Only moderators can do that.'; end if;
  if r.resolved_at is not null then raise exception 'That report was already dealt with.'; end if;
  if p_remove then
    perform private.remove_message_now(r.message_id, auth.uid());
  else
    update public.message_reports set resolved_at = now(), resolved_by = auth.uid(), outcome = 'dismissed'
    where message_id = r.message_id and resolved_at is null;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_ride_alert(p_alert uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  a public.ride_alerts%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into a from public.ride_alerts where id = p_alert;
  if not found then raise exception 'That alert has gone.'; end if;
  if a.resolved_at is not null then raise exception 'Already cleared.'; end if;
  if a.member_id <> me and not (private.is_ride_leader(me) and private.is_sharing(a.ride_id)) then
    raise exception 'Only the rider or a ride leader can clear this.';
  end if;
  update public.ride_alerts set resolved_at = now(), resolved_by = me where id = p_alert;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_notice(p_notice uuid, p_response text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  n public.status_notices%rowtype;
  reply text := private.trim_like_app(coalesce(p_response, ''));
begin
  select * into n from public.status_notices where id = p_notice for update;
  if not found then raise exception 'No such notice.'; end if;
  if me is null or n.member_id <> me then raise exception 'Only the member can reply to their notice.'; end if;
  if n.outcome is not null then raise exception 'That notice is closed.'; end if;
  if reply = '' then raise exception 'Write your reply.'; end if;
  if char_length(reply) > 2000 then raise exception 'Keep your reply under 2000 characters.'; end if;
  update public.status_notices set response = reply, responded_at = now() where id = p_notice;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_member_access(p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  t public.members%rowtype;
begin
  select * into t from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.id = me then raise exception 'You can’t restore your own access.'; end if;
  if not private.is_board_of(t.chapter_id) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if t.approval <> 'suspended' then raise exception 'Their access isn’t suspended.'; end if;
  update public.members set approval = 'approved', updated_at = now() where id = p_member;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ride_calendar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
begin
  if not private.is_approved_member() then
    return jsonb_build_object('rides', '[]'::jsonb, 'rsvps', '[]'::jsonb, 'synced_at', null);
  end if;
  return (
    with shown as (
      select * from public.rides
      where starts_at >= today_start or ends_at > today_start
    )
    select jsonb_build_object(
      'rides', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at, s.id) from shown s), '[]'::jsonb),
      'rsvps', coalesce((select jsonb_agg(to_jsonb(a) order by a.ride_id, a.member_id)
                         from public.rsvps a where a.ride_id in (select id from shown)), '[]'::jsonb),
      'crew', coalesce((select jsonb_agg(to_jsonb(k) order by k.ride_id, k.role, k.assigned_at)
                        from public.ride_crew k where k.ride_id in (select id from shown)), '[]'::jsonb),
      'ride_routes', coalesce((select jsonb_agg(jsonb_build_object('ride_id', rr.ride_id, 'route_id', rr.route_id)
                                                order by rr.ride_id)
                               from public.ride_routes rr
                               where rr.ride_id in (select id from shown) and rr.route_id is not null), '[]'::jsonb),
      'briefings', coalesce((select jsonb_agg(jsonb_build_object('ride_id', b.ride_id, 'hazards', to_jsonb(b.hazards),
                                                                 'changes', b.changes, 'notes', b.notes,
                                                                 'updated_by', b.updated_by, 'updated_at', b.updated_at)
                                              order by b.ride_id)
                             from public.ride_briefings b where b.ride_id in (select id from shown)), '[]'::jsonb),
      'briefing_reads', coalesce((select jsonb_agg(jsonb_build_object('ride_id', br.ride_id, 'member_id', br.member_id,
                                                                      'read_at', br.read_at)
                                                   order by br.ride_id, br.member_id)
                                  from public.ride_briefing_reads br where br.ride_id in (select id from shown)),
                                 '[]'::jsonb),
      'synced_at', (select case when bool_and(last_ok_at is not null) then min(last_ok_at) end from private.ride_feeds)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ride_chat(p_ride uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  chat uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.rides where id = p_ride) then raise exception 'No such ride.'; end if;
  insert into public.conversations (kind, ride_id) values ('ride', p_ride) on conflict do nothing;
  select id into chat from public.conversations where kind = 'ride' and ride_id = p_ride;
  return chat;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ride_feeds_for_sync()
 RETURNS TABLE(id uuid, url text, category ride_category)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select f.id, f.url, f.category from private.ride_feeds f order by f.id;
$function$
;

CREATE OR REPLACE FUNCTION public.ride_voice_room(p_ride uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  problem text := private.live_problem(p_ride);
begin
  if problem is not null then raise exception '%', problem; end if;
  return jsonb_build_object(
    'room', 'ride-' || p_ride::text,
    -- The token is cut to end here, so it never outlives the live window.
    'closes', (select w.closes from public.rides r, private.live_window(r) w where r.id = p_ride),
    'name', (select private.short_name(m) from public.members m where m.id = auth.uid())
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ride_wall(p_ride uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  r public.rides%rowtype;
  chat uuid;
begin
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.rides where id = p_ride;
  if not found then raise exception 'No such ride.'; end if;
  select id into chat from public.conversations where kind = 'ride' and ride_id = p_ride;
  return jsonb_build_object(
    'ride', private.ride_json(r),
    'chat_id', chat,
    'media', coalesce((
      select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, mm.position)
      from public.messages m join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
      where m.conversation_id = chat and m.removed_at is null
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
    ), '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ride_walls()
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
    select jsonb_agg(wall order by (wall->'ride'->>'starts_at')::timestamptz desc)
    from (
      select jsonb_build_object(
        'ride', private.ride_json(r),
        'chat_id', c.id,
        'count', count(*),
        'cover', (array_agg(private.media_json(mm, m) order by m.created_at desc, mm.position))[1]
      ) as wall
      from public.conversations c
      join public.rides r on r.id = c.ride_id
      join public.messages m on m.conversation_id = c.id and m.removed_at is null
      join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
      where c.kind = 'ride'
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
      group by c.id, r.*
    ) walls
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.route_gpx(p_route uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  file text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select gpx into file from public.routes where id = p_route;
  if not found then raise exception 'That route no longer exists.'; end if;
  return file;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_action_item(p_id uuid, p_chapter uuid, p_meeting uuid, p_title text, p_owner uuid, p_due date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_audit_report(p_id uuid, p_title text, p_from date, p_to date, p_findings text, p_recommendations text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_auditor();
  t text;
  f text;
  saved uuid;
begin
  if p_id is not null then perform private.audit_draft(p_id); end if;
  t := private.audit_text(p_title, 'Give the report a title.', 120);
  if p_from is null or p_to is null then raise exception 'Pick the period it covers.'; end if;
  if p_from > p_to then raise exception 'The period has to start before it ends.'; end if;
  if p_to > private.club_date() then raise exception 'The period can’t run past today.'; end if;
  f := private.audit_text(p_findings, 'Write the findings first.', 20000);
  if char_length(trim(p_recommendations)) > 20000 then raise exception 'Keep it to 20000 characters at most.'; end if;
  if p_id is null then
    insert into public.audit_reports (title, from_on, to_on, findings, recommendations, written_by)
    values (t, p_from, p_to, f, nullif(trim(p_recommendations), ''), me)
    returning id into saved;
  else
    update public.audit_reports
    set title = t, from_on = p_from, to_on = p_to, findings = f, recommendations = nullif(trim(p_recommendations), ''),
        written_by = me, saved_at = now()
    where id = p_id
    returning id into saved;
  end if;
  return saved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_bike(p_bike uuid, p_make text, p_model text, p_year integer, p_nickname text, p_is_project boolean, p_rego text, p_rego_expiry date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  saved uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if nullif(trim(p_make), '') is null or nullif(trim(p_model), '') is null then
    raise exception 'Add the make and model.';
  end if;
  perform private.check_bike_year(p_year);

  if p_bike is null then
    insert into public.bikes (member_id, make, model, year, nickname, is_project)
    values (auth.uid(), trim(p_make), trim(p_model), p_year, nullif(trim(p_nickname), ''), coalesce(p_is_project, false))
    returning id into saved;
  else
    update public.bikes set
      make = trim(p_make),
      model = trim(p_model),
      year = p_year,
      nickname = nullif(trim(p_nickname), ''),
      is_project = coalesce(p_is_project, false)
    where id = p_bike and member_id = auth.uid()
    returning id into saved;
    if saved is null then raise exception 'You can only edit your own bikes.'; end if;
  end if;

  insert into public.bike_registrations (bike_id, rego, rego_expiry)
  values (saved, nullif(upper(trim(p_rego)), ''), p_rego_expiry)
  on conflict (bike_id) do update set rego = excluded.rego, rego_expiry = excluded.rego_expiry;
  return saved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_briefing(p_ride uuid, p_hazards text[], p_changes text, p_notes text, p_seen timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  stored timestamptz;
  first_day_end timestamptz;
  clean_hazards text[];
  clean_changes text;
  clean_notes text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The ride row first, the same lock as set_crew, leave_crew, set_rsvp and set_ride_route take (see set_crew).
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  first_day_end := ((date(ride.starts_at at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
  if now() >= first_day_end then raise exception 'The briefing can’t change after the ride day.'; end if;
  if not (private.manages_ride(p_ride) or exists (
    select 1 from public.ride_crew where ride_id = p_ride and member_id = me and role = 'road_captain'
  )) then
    raise exception 'Only the board, ride committee or this ride’s Road Captain can write the briefing.';
  end if;
  -- The ride row is locked, so another save of this briefing has finished and this sees it.
  select updated_at into stored from public.ride_briefings where ride_id = p_ride;
  if found and (p_seen is null or stored > p_seen + interval '1 millisecond') then
    raise exception 'Someone else saved this briefing while you were editing. Your changes aren’t saved: copy them, then open the briefing again.';
  end if;

  select coalesce(array_agg(t.line order by t.n), '{}') into clean_hazards
  from unnest(p_hazards) with ordinality as h(raw, n)
  cross join lateral (select private.trim_like_app(h.raw) as line, h.n) t
  where t.line is not null and t.line <> '';
  clean_changes := nullif(private.trim_like_app(p_changes), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');

  if cardinality(clean_hazards) > 12 then raise exception 'That’s too many hazards (12 at most).'; end if;
  if exists (select 1 from unnest(clean_hazards) line where char_length(line) > 120) then
    raise exception 'Keep each hazard to one short line (120 characters at most).';
  end if;
  if char_length(clean_changes) > 2000 or char_length(clean_notes) > 2000 then
    raise exception 'That’s too long (2000 characters at most).';
  end if;
  if cardinality(clean_hazards) = 0 and clean_changes is null and clean_notes is null then
    raise exception 'Write at least one hazard, change or note.';
  end if;

  insert into public.ride_briefings (ride_id, hazards, changes, notes, updated_by, updated_at)
  values (p_ride, clean_hazards, clean_changes, clean_notes, me, now())
  on conflict (ride_id) do update
    set hazards = excluded.hazards, changes = excluded.changes, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.ride_briefing_reads (ride_id, member_id, read_at) values (p_ride, me, now())
  on conflict (ride_id, member_id) do update set read_at = excluded.read_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_budget(p_chapter uuid, p_fy integer, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(p_chapter); line record;
begin
  if p_fy is null or p_fy < 2019 or p_fy > 2100 then raise exception 'Pick a financial year.'; end if;
  if exists (select 1 from public.budgets where chapter_id is not distinct from p_chapter and fy = p_fy and approved_at is not null) then
    raise exception 'That budget is approved and locked. Reopen it to change it.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'object' then raise exception 'Pick a payment code.'; end if;
  for line in select key, value from jsonb_each(p_lines) loop
    if not exists (select 1 from public.ledger_codes where code = line.key) then raise exception 'Pick a payment code.'; end if;
    if jsonb_typeof(line.value) <> 'number' or line.value::text::numeric < 0 or line.value::text::numeric <> floor(line.value::text::numeric) then
      raise exception 'Budget amounts must be $0 or more.';
    end if;
  end loop;
  update public.budgets set lines = p_lines, updated_by = me, updated_at = now()
  where chapter_id is not distinct from p_chapter and fy = p_fy;
  if not found then
    insert into public.budgets (chapter_id, fy, lines, updated_by) values (p_chapter, p_fy, p_lines, me);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_charity(p_ride uuid, p_cause text, p_about text, p_closes_on date, p_places integer, p_jobs text[], p_website boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  clean_cause text;
  clean_about text;
  clean_jobs text[];
  dropped text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'Sign-ups can’t change after the ride day.'; end if;
  if not private.runs_charity(p_ride) then
    raise exception 'Only the board, ride committee, charity committee or NEC can run sign-ups.';
  end if;
  clean_cause := nullif(private.trim_like_app(p_cause), '');
  clean_about := nullif(private.trim_like_app(p_about), '');
  if clean_cause is null then raise exception 'Say who the ride is raising money for.'; end if;
  if char_length(clean_cause) > 120 or char_length(clean_about) > 1000 then
    raise exception 'That’s too long: 120 characters for the cause, 1000 for the rest.';
  end if;
  if p_places is not null and (p_places < 1 or p_places > 2000) then
    raise exception 'Places: 1 to 2000, or leave it blank.';
  end if;
  clean_jobs := array(
    select t from unnest(coalesce(p_jobs, '{}')) with ordinality as j(job, n), private.trim_like_app(j.job) as t
    where t <> '' order by j.n
  );
  if cardinality(clean_jobs) > 8 or exists (select 1 from unnest(clean_jobs) as j(job) where char_length(j.job) > 40) then
    raise exception 'Up to 8 helper jobs, 40 characters each.';
  end if;
  if (select count(distinct lower(j.job)) from unnest(clean_jobs) as j(job)) <> cardinality(clean_jobs) then
    raise exception 'Each job once.';
  end if;
  -- A job stays while someone's signed up for it, from the app or the website.
  select j.job into dropped
  from public.charity_rides c, unnest(c.jobs) with ordinality as j(job, n)
  where c.ride_id = p_ride and j.job <> all (clean_jobs)
    and (exists (select 1 from public.charity_signups s where s.ride_id = p_ride and s.withdrawn_at is null and s.job = j.job)
         or exists (select 1 from public.website_signups w where w.ride_id = p_ride and w.job = j.job))
  order by j.n limit 1;
  if dropped is not null then raise exception 'Someone’s helping with “%”, so keep that job.', dropped; end if;
  if p_closes_on is not null
     and p_closes_on is distinct from (select c.closes_on from public.charity_rides c where c.ride_id = p_ride)
     and (p_closes_on < private.club_date()
          or p_closes_on > (ride.starts_at at time zone 'Australia/Melbourne')::date) then
    raise exception 'Pick a closing day from today up to the ride day.';
  end if;
  insert into public.charity_rides (ride_id, cause, about, closes_on, places, jobs, website, updated_by, updated_at)
  values (p_ride, clean_cause, clean_about, p_closes_on, p_places, clean_jobs, coalesce(p_website, false), me, now())
  on conflict (ride_id) do update
    set cause = excluded.cause, about = excluded.about, closes_on = excluded.closes_on, places = excluded.places,
        jobs = excluded.jobs, website = excluded.website, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_contact(p_contact uuid, p_name text, p_relationship text, p_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  saved uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception 'Add their name and number.';
  end if;
  if p_contact is null then
    insert into public.emergency_contacts (member_id, name, relationship, phone)
    values (auth.uid(), trim(p_name), coalesce(trim(p_relationship), ''), trim(p_phone))
    returning id into saved;
  else
    update public.emergency_contacts set
      name = trim(p_name),
      relationship = coalesce(trim(p_relationship), ''),
      phone = trim(p_phone)
    where id = p_contact and member_id = auth.uid()
    returning id into saved;
    if saved is null then raise exception 'You can only edit your own contacts.'; end if;
  end if;
  return saved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_delivery_address(p_street text, p_suburb text, p_state text, p_postcode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  v_street text := private.trim_like_app(coalesce(p_street, ''));
  v_suburb text := private.trim_like_app(coalesce(p_suburb, ''));
  v_state text := upper(private.trim_like_app(coalesce(p_state, '')));
  v_postcode text := private.trim_like_app(coalesce(p_postcode, ''));
  problem text;
begin
  if v_street = '' and v_suburb = '' and v_state = '' and v_postcode = '' then
    update public.member_private mp set street = null, suburb = null, state = null, postcode = null, updated_at = now() where mp.member_id = me;
    return;
  end if;
  problem := private.address_problem(v_street, v_suburb, v_state, v_postcode);
  if problem is not null then raise exception '%', problem; end if;
  update public.member_private mp set street = v_street, suburb = v_suburb, state = v_state, postcode = v_postcode, updated_at = now()
    where mp.member_id = me;
  if not found then
    insert into public.member_private (member_id, street, suburb, state, postcode) values (me, v_street, v_suburb, v_state, v_postcode);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_history_entry(p_id uuid, p_happened_on text, p_precision text, p_title text, p_story text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  e public.club_history%rowtype;
  c_title text := coalesce(private.trim_like_app(p_title), '');
  c_story text := nullif(private.trim_like_app(p_story), '');
  c_on date;
  new_id uuid;
begin
  perform private.check_history_keeper();
  if p_id is not null then
    select * into e from public.club_history where id = p_id for update;
    if not found then raise exception 'No such entry.'; end if;
    if e.archived_at is not null then raise exception 'That entry has been taken off.'; end if;
  end if;
  if p_happened_on is null or p_happened_on !~ '^\d{4}-\d{2}-\d{2}$'
     or p_precision is null or p_precision not in ('day', 'month', 'year') then
    raise exception 'Pick a date.';
  end if;
  begin
    c_on := p_happened_on::date;
  exception when others then
    raise exception 'Pick a date.';
  end;
  -- A cast that rolls a date over (it shouldn't) would come back different.
  if to_char(c_on, 'YYYY-MM-DD') <> p_happened_on or c_on > private.club_date() then
    raise exception 'Pick a date.';
  end if;
  if c_title = '' then raise exception 'Give it a title.'; end if;
  if char_length(c_title) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
  if char_length(c_story) > 1000 then raise exception 'Keep the story to 1,000 characters at most.'; end if;

  if p_id is null then
    insert into public.club_history (happened_on, precision, title, story, added_by)
    values (c_on, p_precision::public.history_precision, c_title, c_story, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.club_history
  set happened_on = c_on, precision = p_precision::public.history_precision, title = c_title,
      story = c_story, updated_at = now()
  where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_honour(p_id uuid, p_member uuid, p_name text, p_honour text, p_year integer, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  h public.club_honours%rowtype;
  c_name text := nullif(private.trim_like_app(p_name), '');
  c_honour text := coalesce(private.trim_like_app(p_honour), '');
  c_note text := nullif(private.trim_like_app(p_note), '');
  new_id uuid;
begin
  perform private.check_history_keeper();
  if p_id is not null then
    select * into h from public.club_honours where id = p_id for update;
    if not found then raise exception 'No such honour.'; end if;
    if h.archived_at is not null then raise exception 'That honour has been taken off.'; end if;
  end if;
  if (p_member is null) = (c_name is null) then raise exception 'Pick a member or type a name.'; end if;
  if p_member is not null and not exists (select 1 from public.members where id = p_member) then
    raise exception 'No such member.';
  end if;
  if char_length(c_name) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if c_honour = '' then raise exception 'Name the honour.'; end if;
  if char_length(c_honour) > 60 then raise exception 'Keep the honour to 60 characters at most.'; end if;
  if p_year is null or p_year < 2019 or p_year > extract(year from private.club_date())::int then
    raise exception 'Pick a year from 2019 on.';
  end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  if p_id is null then
    insert into public.club_honours (member_id, name, honour, year, note, added_by)
    values (p_member, c_name, c_honour, p_year, c_note, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.club_honours
  set member_id = p_member, name = c_name, honour = c_honour, year = p_year, note = c_note, updated_at = now()
  where id = p_id;
  return p_id;
end;
$function$
;

