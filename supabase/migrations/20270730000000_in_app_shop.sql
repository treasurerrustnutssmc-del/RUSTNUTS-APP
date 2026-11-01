-- The club shop: ordering members' merch inside the app, into Chris's Make.com pipeline (the same
-- webhook his Discord /buy bot posts to). Spec: docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md.
-- Jeff's rulings (1 Nov 2026): both routes; Member design = Full and Nomad, Family design = Family
-- plus Full and Nomad, the rest any approved member, Legacy nothing; the price list lives here;
-- orders go into the books as CR-005 in the Club fund when the treasurer marks them paid; the
-- delivery address is saved on the profile; bank transfer only.
-- Nobody reaches these tables directly: merch_catalogue() and shop_orders() read, place_shop_order()
-- saves an order as `held`, the shop-order Edge Function posts it to Make and calls shop_order_sent()
-- with the service role. Every rule here mirrors src/domain/shop.ts, refusing with the same words in
-- the same order; the shared cases in supabase/tests/parity.json check that.
-- The Stage 5D board-run "club gear" (merch_items, merch_orders) is untouched.

-- Tables ---------------------------------------------------------------------------------------

create table public.shop_designs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  eligibility text not null check (eligibility in ('any', 'patched', 'family')),
  blurb text check (char_length(blurb) <= 300),
  sort int not null default 0,
  on_sale boolean not null default true,
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.shop_garments (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.shop_designs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price_cents int not null check (price_cents between 1 and 100000),
  sizes text[] not null default '{}',
  colours text[] not null default '{}',
  sort int not null default 0,
  on_sale boolean not null default true
);
create index shop_garments_design on public.shop_garments (design_id);

-- The app's copy of Make's shipping datastore (keyed STATE_METHOD there), so the cart can show a
-- total. If the two drift the invoice wins; the treasurer's "amount received" catches it.
create table public.shop_shipping (
  state text not null check (state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
  method text not null check (method in ('standard', 'express')),
  cents int not null check (cents between 0 and 100000),
  primary key (state, method)
);

-- People named to run the shop alongside the office-bearers (Chris).
create table public.shop_runners (
  member_id uuid primary key references public.members (id) on delete cascade,
  named_by uuid references public.members (id) on delete set null,
  named_on date not null default (now() at time zone 'Australia/Melbourne')::date
);

alter table public.member_private
  add column street text check (char_length(street) between 1 and 120),
  add column suburb text check (char_length(suburb) between 1 and 60),
  add column state text check (state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
  add column postcode text check (postcode ~ '^\d{4}$');

create table public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  client_ref uuid not null,
  buyer_name text not null,
  road_name text,
  email text not null check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 30),
  delivery text not null check (delivery in ('ship', 'collect')),
  street text check (char_length(street) <= 120),
  suburb text check (char_length(suburb) <= 60),
  state text,
  postcode text,
  shipping_method text check (shipping_method in ('standard', 'express')),
  subtotal_cents int not null check (subtotal_cents > 0),
  shipping_cents int not null default 0 check (shipping_cents >= 0),
  status text not null default 'held' check (status in ('held', 'sent', 'paid', 'posted', 'collected', 'cancelled')),
  make_sent_at timestamptz,
  make_error text,
  paid_on date,
  paid_cents int check (paid_cents between 1 and 1000000),
  ledger_entry_id uuid references public.ledger_entries (id),
  handed_over_on date,
  cancelled_at timestamptz,
  cancelled_by uuid references public.members (id) on delete set null,
  ordered_at timestamptz not null default now(),
  unique (member_id, client_ref),
  -- place_shop_order fills the address for a shipped order; forget_member blanks it later, so only the method is checked here.
  check (delivery = 'collect' or shipping_method is not null)
);
create index shop_orders_member_ordered on public.shop_orders (member_id, ordered_at);
create index shop_orders_status on public.shop_orders (status);

-- Names and prices are copied when ordered, so the history survives catalogue edits.
create table public.shop_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders (id) on delete cascade,
  garment_id uuid references public.shop_garments (id) on delete set null,
  design_name text not null,
  garment_name text not null,
  size text,
  colour text,
  qty int not null check (qty between 1 and 10),
  unit_cents int not null check (unit_cents > 0)
);
create index shop_order_lines_order on public.shop_order_lines (order_id);
create index shop_order_lines_garment on public.shop_order_lines (garment_id);
-- Covering indexes for the remaining foreign keys (the performance check asks for them).
create index shop_designs_updated_by on public.shop_designs (updated_by);
create index shop_runners_named_by on public.shop_runners (named_by);
create index shop_orders_ledger_entry on public.shop_orders (ledger_entry_id);
create index shop_orders_cancelled_by on public.shop_orders (cancelled_by);

alter table public.shop_designs enable row level security;
alter table public.shop_garments enable row level security;
alter table public.shop_shipping enable row level security;
alter table public.shop_runners enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_lines enable row level security;
revoke all on public.shop_designs, public.shop_garments, public.shop_shipping, public.shop_runners, public.shop_orders,
  public.shop_order_lines from public, anon, authenticated;

-- Helpers --------------------------------------------------------------------------------------

-- Holds a seat that runs the shop: NEC Chair or Secretary, a President or a Treasurer. Mirrors holdsShopSeat.
create or replace function private.shop_seat()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'president', 'treasurer'));
$$;

-- Runs the shop: a shop seat, or named as a shop runner. Mirrors runsShop.
create or replace function private.runs_shop()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.shop_seat() or (private.is_approved_member() and exists (
    select 1 from public.shop_runners where member_id = auth.uid()));
$$;

-- Why the signed-in member can't order the design, or null. Mirrors designProblem (after the
-- sign-in checks, which every action does first).
create or replace function private.design_problem(d public.shop_designs)
returns text language plpgsql stable security definer set search_path = '' as $$
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
$$;

-- The buyer, the people who run the shop and whoever keeps the Club fund's books. Mirrors seesShopOrder.
create or replace function private.sees_shop_order(o public.shop_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (o.member_id = auth.uid() or private.runs_shop() or private.keeps_books(null));
$$;

create or replace function private.require_runs_shop()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.require_member();
begin
  if not private.runs_shop() then raise exception 'Only the people who run the shop can do that.'; end if;
  return me;
end;
$$;

-- A trimmed list with no blanks, repeats or long entries. Mirrors listProblem.
create or replace function private.shop_list_ok(p_list text[], p_max int, p_max_length int)
returns boolean language sql immutable set search_path = '' as $$
  select cardinality(p_list) <= p_max
    and (select count(distinct x) from unnest(p_list) x) = cardinality(p_list)
    and not exists (select 1 from unnest(p_list) x where x = '' or char_length(x) > p_max_length);
$$;

-- The address checks shared by checkout and the saved address. Mirrors addressProblem.
create or replace function private.address_problem(p_street text, p_suburb text, p_state text, p_postcode text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_street = '' or char_length(p_street) > 120 or p_suburb = '' or char_length(p_suburb) > 60 then 'Fill in the delivery address.'
    when p_state not in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA') then 'Pick a state.'
    when p_postcode !~ '^\d{4}$' then 'Postcode is four digits.'
  end;
$$;

-- A visible order, locked.
create or replace function private.shop_order(p_order uuid)
returns public.shop_orders language plpgsql security definer set search_path = '' as $$
declare o public.shop_orders;
begin
  select * into o from public.shop_orders where id = p_order for update;
  if not found or not private.sees_shop_order(o) then raise exception 'No such order.'; end if;
  return o;
end;
$$;

-- The order as the phone and the Edge Function see it, with its lines.
create or replace function private.shop_order_json(o public.shop_orders)
returns jsonb language sql stable security definer set search_path = '' as $$
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
$$;

revoke all on function private.shop_seat(), private.runs_shop(), private.design_problem(public.shop_designs),
  private.sees_shop_order(public.shop_orders), private.require_runs_shop(), private.shop_list_ok(text[], int, int),
  private.address_problem(text, text, text, text), private.shop_order(uuid), private.shop_order_json(public.shop_orders)
  from public, anon, authenticated;

-- Reading --------------------------------------------------------------------------------------

-- The catalogue for the signed-in member: every design on sale with why they can't order it (or
-- null), its garments on sale, the shipping table and their saved address. Empty for anyone else.
create or replace function public.merch_catalogue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
          from public.shop_garments g where g.design_id = d.id and (g.on_sale or private.runs_shop())), '[]'::jsonb)
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
$$;

-- The orders this person may see, newest first.
create or replace function public.shop_orders()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_agg(private.shop_order_json(o) order by o.ordered_at desc)
    from public.shop_orders o where private.sees_shop_order(o)), '[]'::jsonb);
$$;

-- Ordering -------------------------------------------------------------------------------------

-- Saves an order as `held` and returns it (with its lines) as JSON; the shop-order Edge Function
-- then posts it to Make and calls shop_order_sent(). The same member sending the same client_ref
-- again gets the first order back. Mirrors placeShopOrderProblem.
create or replace function public.place_shop_order(
  p_client_ref uuid, p_lines jsonb, p_email text, p_phone text, p_delivery text,
  p_street text, p_suburb text, p_state text, p_postcode text, p_shipping_method text, p_save_address boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;

-- For the shop-order Edge Function only (service role): Make accepted the order, or didn't.
create or replace function public.shop_order_sent(p_order uuid, p_ok boolean, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.shop_orders set status = 'sent', make_sent_at = now(), make_error = null where id = p_order and status = 'held';
  else
    update public.shop_orders set make_error = left(coalesce(p_error, 'Make did not accept the order.'), 500) where id = p_order and status = 'held';
  end if;
  if not found then raise exception 'No such order.'; end if;
end;
$$;

-- The money in: the amount received as a CR-005 line in the Club fund, banked that day. Returns the
-- line's id. Mirrors payShopOrderProblem.
create or replace function public.pay_shop_order(p_order uuid, p_paid_on date, p_cents int)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

-- Posted (shipped orders) or collected (collect orders), by the people who run the shop, once paid.
create or replace function public.hand_over_shop_order(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.shop_orders;
begin
  perform private.require_member();
  o := private.shop_order(p_order);
  if not private.runs_shop() then raise exception 'Only the people who run the shop can do that.'; end if;
  if o.status <> 'paid' then raise exception 'Mark it paid first.'; end if;
  update public.shop_orders set status = case when o.delivery = 'ship' then 'posted' else 'collected' end,
    handed_over_on = private.club_date() where id = o.id;
end;
$$;

-- The buyer, or the people who run the shop, before it is paid. Make has already made the invoice:
-- telling Chris is the buyer's job (the screen says so).
create or replace function public.cancel_shop_order(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); o public.shop_orders;
begin
  o := private.shop_order(p_order);
  if o.member_id <> me and not private.runs_shop() then raise exception 'Only whoever ordered it or the shop can cancel it.'; end if;
  if o.status not in ('held', 'sent') then raise exception 'That order can’t be cancelled now.'; end if;
  update public.shop_orders set status = 'cancelled', cancelled_at = now(), cancelled_by = me where id = o.id;
end;
$$;

-- Checks a held order may be sent to Make again and returns it; the Edge Function does the posting.
create or replace function public.resend_shop_order(p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.shop_orders;
begin
  perform private.require_member();
  o := private.shop_order(p_order);
  if not private.runs_shop() then raise exception 'Only the people who run the shop can do that.'; end if;
  if o.status <> 'held' then raise exception 'Only a held order can be resent.'; end if;
  return private.shop_order_json(o);
end;
$$;

-- The catalogue ------------------------------------------------------------------------------------

create or replace function public.set_shop_design(p_id uuid, p_name text, p_eligibility text, p_blurb text, p_sort int, p_on_sale boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_runs_shop();
  n text := private.trim_like_app(coalesce(p_name, ''));
  b text := private.trim_like_app(coalesce(p_blurb, ''));
  new_id uuid;
begin
  if p_id is not null and not exists (select 1 from public.shop_designs where id = p_id) then raise exception 'No such design.'; end if;
  if n = '' then raise exception 'Name it.'; end if;
  if char_length(n) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if p_eligibility is null or p_eligibility not in ('any', 'patched', 'family') then raise exception 'Pick who the design is for.'; end if;
  if char_length(b) > 300 then raise exception 'Keep the blurb to 300 characters at most.'; end if;
  if p_sort is null then raise exception 'Sort order is a whole number.'; end if;
  if p_id is null then
    insert into public.shop_designs (name, eligibility, blurb, sort, on_sale, updated_by)
    values (n, p_eligibility, nullif(b, ''), p_sort, coalesce(p_on_sale, true), me) returning id into new_id;
    return new_id;
  end if;
  update public.shop_designs set name = n, eligibility = p_eligibility, blurb = nullif(b, ''), sort = p_sort,
    on_sale = coalesce(p_on_sale, true), updated_by = me, updated_at = now() where id = p_id;
  return p_id;
end;
$$;

create or replace function public.set_shop_garment(
  p_id uuid, p_design uuid, p_name text, p_price_cents int, p_sizes text[], p_colours text[], p_sort int, p_on_sale boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  n text := private.trim_like_app(coalesce(p_name, ''));
  sz text[] := array(select private.trim_like_app(x) from unnest(coalesce(p_sizes, '{}')) with ordinality as t(x, i) order by i);
  co text[] := array(select private.trim_like_app(x) from unnest(coalesce(p_colours, '{}')) with ordinality as t(x, i) order by i);
  new_id uuid;
begin
  perform private.require_runs_shop();
  if not exists (select 1 from public.shop_designs where id = p_design) then raise exception 'No such design.'; end if;
  if p_id is not null and not exists (select 1 from public.shop_garments where id = p_id and design_id = p_design) then
    raise exception 'No such garment.';
  end if;
  if n = '' then raise exception 'Name it.'; end if;
  if char_length(n) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000 then raise exception 'Enter a price from $0.01 to $1,000.'; end if;
  if not private.shop_list_ok(sz, 12, 10) then raise exception 'Keep sizes to 10 characters, no repeats, 12 at most.'; end if;
  if not private.shop_list_ok(co, 12, 20) then raise exception 'Keep colours to 20 characters, no repeats, 12 at most.'; end if;
  if p_sort is null then raise exception 'Sort order is a whole number.'; end if;
  if p_id is null then
    insert into public.shop_garments (design_id, name, price_cents, sizes, colours, sort, on_sale)
    values (p_design, n, p_price_cents, sz, co, p_sort, coalesce(p_on_sale, true)) returning id into new_id;
    return new_id;
  end if;
  update public.shop_garments set name = n, price_cents = p_price_cents, sizes = sz, colours = co, sort = p_sort,
    on_sale = coalesce(p_on_sale, true) where id = p_id;
  return p_id;
end;
$$;

create or replace function public.set_shop_shipping(p_state text, p_method text, p_cents int)
returns void language plpgsql security definer set search_path = '' as $$
declare st text := upper(private.trim_like_app(coalesce(p_state, '')));
begin
  perform private.require_runs_shop();
  if st not in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA') then raise exception 'Pick a state.'; end if;
  if p_method is null or p_method not in ('standard', 'express') then raise exception 'Pick Standard or Express.'; end if;
  if p_cents is null or p_cents < 0 or p_cents > 100000 then raise exception 'Enter a shipping cost from $0 to $1,000.'; end if;
  insert into public.shop_shipping (state, method, cents) values (st, p_method, p_cents)
  on conflict (state, method) do update set cents = excluded.cents;
end;
$$;

-- Naming shop runners: the office-bearers who run the shop, not a named runner.
create or replace function private.require_shop_seat()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.require_member();
begin
  if not private.shop_seat() then raise exception 'Only the NEC, Presidents and Treasurers name shop runners.'; end if;
  return me;
end;
$$;
revoke all on function private.require_shop_seat() from public, anon, authenticated;

create or replace function public.name_shop_runner(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_shop_seat();
begin
  if not exists (select 1 from public.members where id = p_member and approval = 'approved' and status::text <> 'legacy') then
    raise exception 'No such member.';
  end if;
  if exists (select 1 from public.shop_runners where member_id = p_member) then raise exception 'Already a shop runner.'; end if;
  insert into public.shop_runners (member_id, named_by, named_on) values (p_member, me, private.club_date());
end;
$$;

create or replace function public.unname_shop_runner(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_shop_seat();
  delete from public.shop_runners where member_id = p_member;
  if not found then raise exception 'Not a shop runner.'; end if;
end;
$$;

-- The member's own saved delivery address: all four parts, or all empty to clear it.
create or replace function public.save_delivery_address(p_street text, p_suburb text, p_state text, p_postcode text)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

-- Grants ---------------------------------------------------------------------------------------

revoke all on function
  public.merch_catalogue(), public.shop_orders(),
  public.place_shop_order(uuid, jsonb, text, text, text, text, text, text, text, text, boolean),
  public.shop_order_sent(uuid, boolean, text), public.pay_shop_order(uuid, date, int), public.hand_over_shop_order(uuid),
  public.cancel_shop_order(uuid), public.resend_shop_order(uuid),
  public.set_shop_design(uuid, text, text, text, int, boolean), public.set_shop_garment(uuid, uuid, text, int, text[], text[], int, boolean),
  public.set_shop_shipping(text, text, int), public.name_shop_runner(uuid), public.unname_shop_runner(uuid),
  public.save_delivery_address(text, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.merch_catalogue(), public.shop_orders(),
  public.place_shop_order(uuid, jsonb, text, text, text, text, text, text, text, text, boolean),
  public.pay_shop_order(uuid, date, int), public.hand_over_shop_order(uuid),
  public.cancel_shop_order(uuid), public.resend_shop_order(uuid),
  public.set_shop_design(uuid, text, text, text, int, boolean), public.set_shop_garment(uuid, uuid, text, int, text[], text[], int, boolean),
  public.set_shop_shipping(text, text, int), public.name_shop_runner(uuid), public.unname_shop_runner(uuid),
  public.save_delivery_address(text, text, text, text)
  to authenticated;
grant execute on function public.shop_order_sent(uuid, boolean, text) to service_role;

-- Deleting an account ----------------------------------------------------------------------------

-- forget_member, as before (storage purge), plus the shop: the saved address goes with member_private;
-- the orders stay for the books but lose their address and phone.
create or replace function private.forget_member(p_member uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
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
end $$;

revoke all on function private.forget_member(uuid, text) from public, anon, authenticated;
