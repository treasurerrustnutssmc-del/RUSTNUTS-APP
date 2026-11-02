-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the private schema (helpers used by policies and public functions; not exposed through the API).
-- Part 2 of 2.

CREATE OR REPLACE FUNCTION private.push_ride_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t text;
  b text;
  k text;
  opens uuid := new.id;
  moved public.rides%rowtype;
begin
  if new.starts_at <= now() then return new; end if;
  if old.cancelled_at is null and new.cancelled_at is not null then
    -- A calendar sync moves an event by adding it at its new time and cancelling the old row, in one
    -- transaction: that's a time change.
    if new.feed_id is not null then
      select * into moved from public.rides x
      where x.feed_id = new.feed_id and x.external_uid = new.external_uid and x.id <> new.id and x.cancelled_at is null
        and x.xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text
      order by abs(extract(epoch from x.starts_at - new.starts_at)) limit 1;
    end if;
    if moved.id is not null then
      t := 'Ride time changed';
      b := new.title || ' · now ' || private.club_day(moved.starts_at) ||
        case when moved.all_day then '' else ' ' || private.club_time(moved.starts_at) end;
      k := 'ride-time:' || new.id || ':' || moved.starts_at;
      opens := moved.id;
    else
      t := 'Ride cancelled';
      b := new.title || ' · ' || private.club_day(new.starts_at);
      k := 'ride-cancel:' || new.id;
    end if;
  elsif new.cancelled_at is null and old.starts_at is distinct from new.starts_at then
    t := 'Ride time changed';
    b := new.title || ' · now ' || private.club_day(new.starts_at) ||
      case when new.all_day then '' else ' ' || private.club_time(new.starts_at) end;
    k := 'ride-time:' || new.id || ':' || new.starts_at;
  else
    return new;
  end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select r.member_id, k, t, b, jsonb_build_object('kind', 'ride', 'rideId', opens)
  from public.rsvps r
  left join public.notification_prefs p on p.member_id = r.member_id
  where r.ride_id = new.id and r.answer in ('going', 'maybe') and coalesce(p.ride_changes, true)
    and r.member_id is distinct from auth.uid() -- not whoever made the change
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_site_photo_up()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  picker public.members%rowtype;
begin
  begin
    if new.status <> 'live' or new.posted_by is null or new.picked_by is null or new.posted_by = new.picked_by then return null; end if;
    select * into picker from public.members where id = new.picked_by;
    if exists (select 1 from public.push_devices d where d.member_id = new.posted_by) then
      insert into private.push_outbox (member_id, dedupe_key, title, body, data)
      values (new.posted_by, 'site-photo:' || new.id, 'Your photo is on the club website',
              private.short_name(picker) || ' put one of your photos on the club website. Open the app to see it or take it down.',
              jsonb_build_object('kind', 'site_photo', 'id', new.id))
      on conflict (member_id, dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'website photo heads-up % not written: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.push_url()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select value from private.app_settings where key = 'push_url';
$function$
;

CREATE OR REPLACE FUNCTION private.raise_chat_problem(p_chat uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  problem text := private.chat_problem(p_chat);
begin
  if problem is not null then raise exception '%', problem; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reads_document(p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() or (p_kind in ('registered_rules', 'constitution') and exists (
    select 1 from public.members where id = auth.uid() and approval = 'pending'));
$function$
;

CREATE OR REPLACE FUNCTION private.refuse_forgotten()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.members where id = new.member_id and account_deleted_on is not null) then
    raise exception 'This account has been deleted.';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.refuse_forgotten_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.account_deleted_on is not null then raise exception 'This account has been deleted.'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.refuse_unagreed_bio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who uuid := coalesce(auth.uid(), new.id);
begin
  if new.bio is not null and new.bio is distinct from old.bio and not private.posting_rules_agreed(who) then
    raise exception 'Agree to the club rules for chats and posts first.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.refuse_unagreed_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who uuid := coalesce(auth.uid(), (to_jsonb(new)->>tg_argv[0])::uuid);
begin
  if who is not null and not private.posting_rules_agreed(who) then
    raise exception 'Agree to the club rules for chats and posts first.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.remove_message_now(p_message uuid, p_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.messages set body = null, removed_at = now(), removed_by = p_by, updated_at = clock_timestamp()
  where id = p_message;
  delete from public.message_reactions where message_id = p_message;
  update public.conversations set pinned_message_id = null where pinned_message_id = p_message;
  update public.message_reports set resolved_at = now(), resolved_by = p_by, outcome = 'removed'
  where message_id = p_message and resolved_at is null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.require_auditor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_auditor() then raise exception 'Only the National Auditor can do that (11.8).'; end if;
  return auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION private.require_books(p_chapter uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member();
begin
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such fund.';
  end if;
  if not private.keeps_books(p_chapter) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  return me;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.require_member()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  return auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION private.require_runs_shop()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member();
begin
  if not private.runs_shop() then raise exception 'Only the people who run the shop can do that.'; end if;
  return me;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.require_scope(p_chapter uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.runs_scope(p_chapter) then
    if p_chapter is null then raise exception 'Only the NEC can do that.'; end if;
    raise exception 'Only that chapter’s board can do that.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.require_shop_seat()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member();
begin
  if not private.shop_seat() then raise exception 'Only the NEC, Presidents and Treasurers name shop runners.'; end if;
  return me;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.reviews_chapter(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.sees_board_of(p_chapter) or private.is_auditor();
$function$
;

CREATE OR REPLACE FUNCTION private.reviews_scope(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.sees_scope(p_chapter) or private.is_auditor();
$function$
;

CREATE OR REPLACE FUNCTION private.ride_answers_close(ride rides)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when ride.all_day then private.ride_day_end(ride.starts_at) else ride.starts_at end;
$function$
;

CREATE OR REPLACE FUNCTION private.ride_chat_for_new_ride()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.conversations (kind, ride_id) values ('ride', new.id) on conflict do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.ride_day_end(p_starts timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select ((date(p_starts at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
$function$
;

CREATE OR REPLACE FUNCTION private.ride_json(r rides)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id', r.id, 'title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
                            'all_day', r.all_day, 'location', r.location, 'notes', r.notes,
                            'category', r.category, 'cancelled_at', r.cancelled_at);
$function$
;

CREATE OR REPLACE FUNCTION private.ride_last_day(r rides)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when r.ends_at is null then (r.starts_at at time zone 'Australia/Melbourne')::date
    when r.all_day then ((r.ends_at - interval '1 millisecond') at time zone 'Australia/Melbourne')::date
    else (r.ends_at at time zone 'Australia/Melbourne')::date
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.ride_sync_url()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select value from private.app_settings where key = 'ride_sync_url';
$function$
;

CREATE OR REPLACE FUNCTION private.road_rules_good_until(p_signed_at timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select ((p_signed_at at time zone 'Australia/Melbourne')::date + interval '1 year')::date;
$function$
;

CREATE OR REPLACE FUNCTION private.road_rules_signed(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce((
    select s.version >= b.base and private.club_date() <= private.road_rules_good_until(s.signed_at)
    from public.road_rules_signoffs s
    cross join (select max(number) as base from public.road_rules_versions where fresh or number = 1) b
    where s.member_id = p_member and b.base is not null
  ), false);
$function$
;

CREATE OR REPLACE FUNCTION private.runs_charity(p_ride uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.manages_ride(p_ride) or (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role = 'charity_committee'
  ));
$function$
;

CREATE OR REPLACE FUNCTION private.runs_scope(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_chapter is null then private.is_national() else private.is_board_of(p_chapter) end;
$function$
;

CREATE OR REPLACE FUNCTION private.runs_shop()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.shop_seat() or (private.is_approved_member() and exists (
    select 1 from public.shop_runners where member_id = auth.uid()));
$function$
;

CREATE OR REPLACE FUNCTION private.runs_shop_pictures()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.runs_shop();
$function$
;

CREATE OR REPLACE FUNCTION private.sees_board_of(target_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.sees_conduct(r conduct_records)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    r.member_id = auth.uid() or private.sees_board_of(private.conduct_chapter(r))
    or exists (select 1 from public.conduct_appeals a where a.record_id = r.id and auth.uid() = any (a.panel)));
$function$
;

CREATE OR REPLACE FUNCTION private.sees_ledger(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.keeps_books(p_chapter) or private.approves_for(p_chapter) or (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role = 'nec_auditor'));
$function$
;

CREATE OR REPLACE FUNCTION private.sees_merch_item(i merch_items)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (i.status in ('on_sale', 'closed') or private.sees_scope(i.chapter_id));
$function$
;

CREATE OR REPLACE FUNCTION private.sees_merch_order(o merch_orders)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.merch_items i where i.id = o.item_id
      and (o.member_id = auth.uid() or private.sees_scope(i.chapter_id) or private.keeps_books(i.chapter_id)));
$function$
;

CREATE OR REPLACE FUNCTION private.sees_scope(p_chapter uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_chapter is null then private.is_national() else private.sees_board_of(p_chapter) end;
$function$
;

CREATE OR REPLACE FUNCTION private.sees_shop_order(o shop_orders)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (o.member_id = auth.uid() or private.runs_shop() or private.keeps_books(null));
$function$
;

CREATE OR REPLACE FUNCTION private.sees_site_enquiry(target_slug text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and (
    private.is_nec_officer() or exists (
      select 1 from public.positions p
      join public.chapters c on c.id = p.chapter_id
      where p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
        and (target_slug = 'either' or c.slug = target_slug)
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION private.shop_list_ok(p_list text[], p_max integer, p_max_length integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select cardinality(p_list) <= p_max
    and (select count(distinct x) from unnest(p_list) x) = cardinality(p_list)
    and not exists (select 1 from unnest(p_list) x where x = '' or char_length(x) > p_max_length);
$function$
;

CREATE OR REPLACE FUNCTION private.shop_order(p_order uuid)
 RETURNS shop_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.shop_orders;
begin
  select * into o from public.shop_orders where id = p_order for update;
  if not found or not private.sees_shop_order(o) then raise exception 'No such order.'; end if;
  return o;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.shop_order_json(o shop_orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', o.id, 'member_id', o.member_id, 'client_ref', o.client_ref, 'buyer_name', o.buyer_name, 'road_name', o.road_name,
    'email', o.email, 'phone', o.phone, 'delivery', o.delivery, 'street', o.street, 'suburb', o.suburb, 'state', o.state,
    'postcode', o.postcode, 'shipping_method', o.shipping_method, 'subtotal_cents', o.subtotal_cents, 'shipping_cents', o.shipping_cents,
    'status', o.status, 'make_sent_at', o.make_sent_at, 'make_error', o.make_error, 'paid_on', o.paid_on, 'paid_cents', o.paid_cents,
    'ledger_entry_id', o.ledger_entry_id, 'handed_over_on', o.handed_over_on, 'cancelled_at', o.cancelled_at, 'cancelled_by', o.cancelled_by,
    'ordered_at', o.ordered_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'order_id', l.order_id, 'garment_id', l.garment_id, 'design_name', l.design_name, 'garment_name', l.garment_name,
        'size', l.size, 'colour', l.colour, 'qty', l.qty, 'unit_cents', l.unit_cents) order by l.design_name, l.garment_name, l.size, l.colour)
      from public.shop_order_lines l where l.order_id = o.id), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION private.shop_picture_unused(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.runs_shop() and not exists (select 1 from public.shop_pictures p where p.path = p_name);
$function$
;

CREATE OR REPLACE FUNCTION private.shop_picture_upload_ok(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.runs_shop() and exists (select 1 from public.shop_designs d where d.id::text = split_part(p_name, '/', 1));
$function$
;

CREATE OR REPLACE FUNCTION private.shop_seat()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'president', 'treasurer'));
$function$
;

CREATE OR REPLACE FUNCTION private.short_name(m members)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(m.road_name, split_part(m.full_name, ' ', 1));
$function$
;

CREATE OR REPLACE FUNCTION private.site_photos_message_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.site_photos p set status = 'removed', removed_at = now(), removed_by = new.removed_by
  where p.status <> 'removed'
    and p.media_id in (select mm.id from public.message_media mm where mm.message_id = new.id);
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.slug_of(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select trim(both '-' from regexp_replace(lower(private.trim_like_app(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'));
$function$
;

CREATE OR REPLACE FUNCTION private.sponsor_logo_in_use(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.sponsors where logo_path = p_name);
$function$
;

CREATE OR REPLACE FUNCTION private.swap_file_in_use(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.listings l where l.photos @> jsonb_build_array(jsonb_build_object('path', p_name)));
$function$
;

CREATE OR REPLACE FUNCTION private.trim_like_app(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select regexp_replace(p_text,
    '^[ \t\n\v\f\r   -   ]+|[ \t\n\v\f\r   -   ]+$',
    '', 'g');
$function$
;

CREATE OR REPLACE FUNCTION private.uses_app()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved');
$function$
;

CREATE OR REPLACE FUNCTION private.vote_used(p_vote uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.contribution_decisions where vote_id = p_vote)
      or exists (select 1 from public.chapter_proposals where vote_id = p_vote)
      or exists (select 1 from public.budgets where approved_vote_id = p_vote);
$function$
;

CREATE OR REPLACE FUNCTION private.website_on_bikes(p_ride uuid, p_except_email text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(w.riding::int + w.pillion::int + w.guests), 0)::int
  from public.website_signups w
  where w.ride_id = p_ride and (p_except_email is null or w.email <> p_except_email);
$function$
;

CREATE OR REPLACE FUNCTION private.writes_ride(p_ride uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.manages_ride(p_ride) or exists (
    select 1 from public.ride_crew where ride_id = p_ride and member_id = auth.uid() and role = 'road_captain'
  );
$function$
