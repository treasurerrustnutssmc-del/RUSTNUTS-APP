-- Checks the club shop beyond the shared parity cases: what the catalogue shows each member, the
-- repeat-clientRef idempotency, the held -> sent hand-off reserved for the service role, the CR-005
-- ledger line, the address on the profile, who may read orders and the account-deletion clean-up.
-- Rules in the same words and order as src/domain/shop.ts.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000a0a1', 'jeff@example.com', now()),  -- West Treasurer (keeps the books, runs the shop)
  ('00000000-0000-0000-0000-00000000a0a2', 'rog@example.com', now()),   -- West President (runs the shop)
  ('00000000-0000-0000-0000-00000000a0a3', 'chair@example.com', now()), -- NEC Chairman
  ('00000000-0000-0000-0000-00000000a0a4', 'nell@example.com', now()),  -- Full, no seat (a buyer)
  ('00000000-0000-0000-0000-00000000a0a5', 'paul@example.com', now()),  -- pending
  ('00000000-0000-0000-0000-00000000a0a6', 'fam@example.com', now()),   -- Family
  ('00000000-0000-0000-0000-00000000a0a7', 'fng@example.com', now()),   -- FNG
  ('00000000-0000-0000-0000-00000000a0a8', 'chris@example.com', now()), -- Full, named shop runner
  ('00000000-0000-0000-0000-00000000a0a9', 'kim@example.com', now());   -- National Auditor

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-00000000a0a1', 'west', 'Jeff Keeper', 'El Jefe', 'full', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a2', 'west', 'Roger Pres', 'Rockhard', 'full', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a3', 'north', 'Charlie Chair', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a4', 'west', 'Nell Member', 'Nelly', 'full', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a5', 'west', 'Paul Pending', null, 'full', 'pending'),
  ('00000000-0000-0000-0000-00000000a0a6', 'west', 'Fran Family', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a7', 'west', 'Finn New', null, 'fng', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a8', 'north', 'Chris Dyson', 'Dysco', 'full', 'approved'),
  ('00000000-0000-0000-0000-00000000a0a9', 'west', 'Kim Books', null, 'full', 'approved')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;
insert into member_private (member_id, email) select id, (select email from auth.users u where u.id = m.id) from members m;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01'
from (values
  ('00000000-0000-0000-0000-00000000a0a1', 'west', 'treasurer'),
  ('00000000-0000-0000-0000-00000000a0a2', 'west', 'president'),
  ('00000000-0000-0000-0000-00000000a0a3', null, 'nec_chair'),
  ('00000000-0000-0000-0000-00000000a0a9', null, 'nec_auditor')
) as v(id, slug, role);

\set jeff 00000000-0000-0000-0000-00000000a0a1
\set rog 00000000-0000-0000-0000-00000000a0a2
\set chair 00000000-0000-0000-0000-00000000a0a3
\set nell 00000000-0000-0000-0000-00000000a0a4
\set paul 00000000-0000-0000-0000-00000000a0a5
\set fam 00000000-0000-0000-0000-00000000a0a6
\set finn 00000000-0000-0000-0000-00000000a0a7
\set chris 00000000-0000-0000-0000-00000000a0a8
\set kim 00000000-0000-0000-0000-00000000a0a9

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt;
  exception when others then
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return null;
end $$;

create function pg_temp.json_as(who uuid, stmt text) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
end $$;

-- The catalogue, set up by the President; Chris named as a shop runner.
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.name_shop_runner(%L)$$, :'chris')) is null, 'the President names Chris');
select pg_temp.check(pg_temp.try_as(:'chris', format($$select public.name_shop_runner(%L)$$, :'nell'))
  = 'Only the NEC, Presidents and Treasurers name shop runners.', 'a named runner cannot name another');
do $$
declare member_id uuid; family_id uuid; ruok_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0a2', true);
  set local role authenticated;
  member_id := public.set_shop_design(null, 'Member', 'patched', 'Carries the patch.', 0, true);
  family_id := public.set_shop_design(null, 'Family', 'family', '', 1, true);
  ruok_id := public.set_shop_design(null, 'R U OK', 'any', '', 2, true);
  perform public.set_shop_garment(null, member_id, 'Hoodie', 7500, array['S', 'M', 'L'], array['Black', 'Grey'], 0, true);
  perform public.set_shop_garment(null, member_id, 'Tee', 4500, array['S', 'M', 'L'], array['Black'], 1, true);
  perform public.set_shop_garment(null, family_id, 'Tee', 4000, array['S', 'M', 'L'], array['Black'], 0, true);
  perform public.set_shop_garment(null, ruok_id, 'Tee', 4000, '{}', '{}', 0, true);
  perform public.set_shop_shipping('VIC', 'standard', 1200);
  perform public.set_shop_shipping('vic', 'express', 1800);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select pg_temp.check((select count(*) from shop_designs) = 3 and (select count(*) from shop_garments) = 4
  and (select cents from shop_shipping where state = 'VIC' and method = 'express') = 1800, 'the catalogue is set up');

-- What each member sees: every design on sale, with why they can't order it.
select pg_temp.check(
  (select jsonb_agg(d->>'problem' order by d->>'name') from jsonb_array_elements(pg_temp.json_as(:'finn', 'select public.merch_catalogue()')->'designs') d)
  = jsonb_build_array('That design is for Family members and patched members.', 'That design is for Full and Nomad members.', null),
  'an FNG sees why Member and Family are not for them');
select pg_temp.check(pg_temp.json_as(:'fam', 'select public.merch_catalogue()')->'designs' = '[]'::jsonb,
  'a Family account (the family view) has no shop today, whatever the Family design says');
select pg_temp.check(
  (select count(*) from jsonb_array_elements(pg_temp.json_as(:'nell', 'select public.merch_catalogue()')->'designs') d where d->>'problem' is null) = 3,
  'a Full member may order all three');
select pg_temp.check(pg_temp.json_as(:'paul', 'select public.merch_catalogue()')->'designs' = '[]'::jsonb, 'pending members see no catalogue');
select pg_temp.check(pg_temp.try_as(null, 'select public.merch_catalogue()') like 'permission denied%', 'nobody signed in is refused the catalogue');
select pg_temp.check((pg_temp.json_as(:'chris', 'select public.merch_catalogue()')->>'runs_shop')::boolean
  and not (pg_temp.json_as(:'nell', 'select public.merch_catalogue()')->>'runs_shop')::boolean, 'runs_shop says who runs it');
select pg_temp.check(pg_temp.try_as(:'nell', 'select * from public.shop_designs') like 'permission denied%', 'nobody reads the tables directly');

-- Nell orders a hoodie and a tee, shipped, and saves her address.
create temp table ids (name text primary key, id uuid);
insert into ids select 'tee', id from shop_garments where name = 'Tee' and design_id = (select id from shop_designs where name = 'Member');
insert into ids select 'hoodie', id from shop_garments where name = 'Hoodie';
insert into ids select 'ruok', id from shop_garments where design_id = (select id from shop_designs where name = 'R U OK');
insert into ids values ('ref1', '11111111-1111-1111-1111-111111111111'), ('ref2', '22222222-2222-2222-2222-222222222222');

create temp table placed as
select pg_temp.json_as(:'nell', format(
  $$select public.place_shop_order(%L, %L::jsonb, '', '0400 000 000', 'ship', ' 1 Main St ', 'Sunshine', 'vic', '3020', 'standard', true)$$,
  (select id from ids where name = 'ref1'),
  jsonb_build_array(
    jsonb_build_object('garment_id', (select id from ids where name = 'hoodie'), 'size', 'L', 'colour', 'Grey', 'qty', 1),
    jsonb_build_object('garment_id', (select id from ids where name = 'tee'), 'size', 'M', 'colour', 'Black', 'qty', 2),
    jsonb_build_object('garment_id', (select id from ids where name = 'tee'), 'size', 'M', 'colour', 'Black', 'qty', 1)))) as o;
select pg_temp.check((select o->>'status' from placed) = 'held', 'a new order is held until Make takes it');
select pg_temp.check((select (o->>'created')::boolean from placed), 'and says it was just created');
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.place_shop_order(%L, %L::jsonb, '', '', 'collect', '', '', '', '', null, false)$$,
  gen_random_uuid(), jsonb_build_array(jsonb_build_object('garment_id', (select id from ids where name = 'tee'), 'size', 'M', 'colour', 'Black', 'qty', 'two'))))
  = 'Order 1 to 10 of each.', 'a quantity that is not a number');
select pg_temp.check((select (o->>'subtotal_cents')::int from placed) = 7500 + 3 * 4500, 'the subtotal uses the catalogue prices');
select pg_temp.check((select (o->>'shipping_cents')::int from placed) = 1200, 'shipping from the table');
select pg_temp.check((select jsonb_array_length(o->'lines') from placed) = 2, 'the same line twice merged');
select pg_temp.check((select o->>'email' from placed) = 'nell@example.com' and (select o->>'buyer_name' from placed) = 'Nell Member'
  and (select o->>'road_name' from placed) = 'Nelly' and (select o->>'street' from placed) = '1 Main St' and (select o->>'state' from placed) = 'VIC',
  'name and email from the member record, address trimmed and the state upper-cased');
select pg_temp.check((select street from member_private where member_id = :'nell'::uuid) = '1 Main St'
  and (select postcode from member_private where member_id = :'nell'::uuid) = '3020', 'the address is saved on the profile');
select pg_temp.check((pg_temp.json_as(:'nell', 'select public.merch_catalogue()')->'address'->>'suburb') = 'Sunshine', 'the catalogue carries the saved address');

-- The same clientRef again is the same order, whatever the cart says now.
select pg_temp.check(
  (pg_temp.json_as(:'nell', format($$select public.place_shop_order(%L, '[]'::jsonb, '', '', 'collect', '', '', '', '', null, false)$$,
    (select id from ids where name = 'ref1')))->>'id') = (select o->>'id' from placed), 'a repeat clientRef returns the first order');
select pg_temp.check(not (pg_temp.json_as(:'nell', format($$select public.place_shop_order(%L, '[]'::jsonb, '', '', 'collect', '', '', '', '', null, false)$$,
    (select id from ids where name = 'ref1')))->>'created')::boolean, 'and says it was not created this time');
select pg_temp.check((select count(*) from shop_orders) = 1, 'and makes no second order');

-- Only the service role moves held to sent.
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.shop_order_sent(%L, true, null)$$, (select o->>'id' from placed))) like 'permission denied%',
  'a member cannot mark an order sent');
select pg_temp.check(pg_temp.try_as(:'jeff', format($$select public.pay_shop_order(%L, current_date, 21000)$$, (select o->>'id' from placed)))
  = 'Mark it paid once it has been sent to Make.', 'a held order cannot be paid');
do $$ declare oid uuid := (select (o->>'id')::uuid from placed); begin
  set local role service_role;
  perform public.shop_order_sent(oid, false, 'HTTP 500 from Make');
  reset role;
end $$;
select pg_temp.check((select status from shop_orders) = 'held' and (select make_error from shop_orders) = 'HTTP 500 from Make', 'a failed post keeps it held with the error');
select pg_temp.check(pg_temp.try_as(:'chris', format($$select public.resend_shop_order(%L)$$, (select o->>'id' from placed))) is null, 'a shop runner may resend a held order');
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.resend_shop_order(%L)$$, (select o->>'id' from placed)))
  = 'Only the people who run the shop can do that.', 'the buyer cannot resend');
do $$ declare oid uuid := (select (o->>'id')::uuid from placed); begin
  set local role service_role;
  perform public.shop_order_sent(oid, true, null);
  reset role;
end $$;
select pg_temp.check((select status from shop_orders) = 'sent' and (select make_error from shop_orders) is null and (select make_sent_at from shop_orders) is not null,
  'Make accepting it makes it sent');
select pg_temp.check(pg_temp.try_as(:'chris', format($$select public.resend_shop_order(%L)$$, (select o->>'id' from placed))) = 'Only a held order can be resent.',
  'a sent order is not resent');

-- Who reads orders.
select pg_temp.check(jsonb_array_length(pg_temp.json_as(:'nell', 'select public.shop_orders()')) = 1, 'the buyer sees her order');
select pg_temp.check(jsonb_array_length(pg_temp.json_as(:'chris', 'select public.shop_orders()')) = 1, 'a shop runner sees it');
select pg_temp.check(jsonb_array_length(pg_temp.json_as(:'jeff', 'select public.shop_orders()')) = 1, 'the treasurer sees it');
select pg_temp.check(jsonb_array_length(pg_temp.json_as(:'chair', 'select public.shop_orders()')) = 1, 'the NEC Chair sees it');
select pg_temp.check(jsonb_array_length(pg_temp.json_as(:'finn', 'select public.shop_orders()')) = 0, 'another member does not');
select pg_temp.check(jsonb_array_length(pg_temp.json_as(:'kim', 'select public.shop_orders()')) = 0, 'nor the Auditor');
select pg_temp.check(pg_temp.try_as(:'finn', format($$select public.cancel_shop_order(%L)$$, (select o->>'id' from placed))) = 'No such order.',
  'an order you cannot see does not exist for you');

-- The treasurer marks it paid for what landed: one CR-005 line in the Club fund.
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.pay_shop_order(%L, current_date, 21000)$$, (select o->>'id' from placed)))
  = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'a President does not keep the books');
select pg_temp.check(pg_temp.try_as(:'jeff', format($$select public.pay_shop_order(%L, current_date, 22200)$$, (select o->>'id' from placed))) is null,
  'the treasurer marks it paid');
select pg_temp.check((select status from shop_orders) = 'paid' and (select paid_cents from shop_orders) = 22200, 'paid, for the amount received');
select pg_temp.check((select count(*) from ledger_entries where code = 'CR-005' and chapter_id is null and amount_cents = 22200 and state = 'paid') = 1,
  'one CR-005 line in the Club fund for the amount received');
select pg_temp.check((select description from ledger_entries where code = 'CR-005')
  = 'Shop order ' || upper(left((select o->>'id' from placed), 8)) || ': Member Hoodie (L, Grey) ×1, Member Tee (M, Black) ×3 for Nelly',
  'the ledger line names the items and the buyer');
select pg_temp.check((select ledger_entry_id from shop_orders) = (select id from ledger_entries where code = 'CR-005'), 'the order points at its line');
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.cancel_shop_order(%L)$$, (select o->>'id' from placed))) = 'That order can’t be cancelled now.',
  'a paid order cannot be cancelled');
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.hand_over_shop_order(%L)$$, (select o->>'id' from placed))) = 'Only the people who run the shop can do that.',
  'the buyer does not mark it posted');
select pg_temp.check(pg_temp.try_as(:'chris', format($$select public.hand_over_shop_order(%L)$$, (select o->>'id' from placed))) is null, 'Chris marks it posted');
select pg_temp.check((select status from shop_orders) = 'posted' and (select handed_over_on from shop_orders) = private.club_date(), 'shipped orders become posted');

-- A collect order, cancelled by the buyer; the daily limit.
select pg_temp.check(pg_temp.try_as(:'finn', format($$select public.place_shop_order(%L, %L::jsonb, '', '', 'collect', '', '', '', '', null, false)$$,
  (select id from ids where name = 'ref2'),
  jsonb_build_array(jsonb_build_object('garment_id', (select id from ids where name = 'ruok'), 'size', null, 'colour', null, 'qty', 1)))) is null,
  'an FNG orders R U OK to collect');
select pg_temp.check((select shipping_cents from shop_orders where member_id = :'finn'::uuid) = 0 and (select street from shop_orders where member_id = :'finn'::uuid) is null,
  'collect: no shipping, no address');
select pg_temp.check(pg_temp.try_as(:'finn', format($$select public.cancel_shop_order(%L)$$, (select id from shop_orders where member_id = :'finn'::uuid))) is null,
  'the buyer cancels a held order');
select pg_temp.check((select status from shop_orders where member_id = :'finn'::uuid) = 'cancelled' and (select cancelled_by from shop_orders where member_id = :'finn'::uuid) = :'finn'::uuid,
  'cancelled, by her');
do $limit$
declare i int; r text;
begin
  for i in 1..4 loop
    r := pg_temp.try_as('00000000-0000-0000-0000-00000000a0a7', format($$select public.place_shop_order(%L, %L::jsonb, '', '', 'collect', '', '', '', '', null, false)$$,
      gen_random_uuid(), jsonb_build_array(jsonb_build_object('garment_id', (select id from ids where name = 'ruok'), 'size', null, 'colour', null, 'qty', 1))));
    if r is not null then raise exception 'order % refused: %', i, r; end if;
  end loop;
end $limit$;
select pg_temp.check(pg_temp.try_as(:'finn', format($$select public.place_shop_order(%L, %L::jsonb, '', '', 'collect', '', '', '', '', null, false)$$,
  gen_random_uuid(), jsonb_build_array(jsonb_build_object('garment_id', (select id from ids where name = 'ruok'), 'size', null, 'colour', null, 'qty', 1))))
  = 'That’s enough orders for one day. Try again tomorrow.', 'a sixth order today is refused (cancelled ones count)');

-- The saved address: the member and their board see it, nobody else.
select pg_temp.check((pg_temp.json_as(:'nell', format($$select to_jsonb(mp) from public.member_private mp where mp.member_id = %L$$, :'nell'))->>'street') = '1 Main St',
  'the member reads their own address');
select pg_temp.check((pg_temp.json_as(:'rog', format($$select to_jsonb(mp) from public.member_private mp where mp.member_id = %L$$, :'nell'))->>'street') = '1 Main St',
  'their chapter board reads it');
select pg_temp.check(pg_temp.json_as(:'finn', format($$select to_jsonb(mp) from public.member_private mp where mp.member_id = %L$$, :'nell')) is null,
  'another member does not');
select pg_temp.check(pg_temp.try_as(:'nell', $$select public.save_delivery_address('', '', '', '')$$) is null, 'the member clears their address');
select pg_temp.check((select street from member_private where member_id = :'nell'::uuid) is null, 'and it is gone');
select pg_temp.check(pg_temp.try_as(:'nell', $$select public.save_delivery_address('2 High St', 'Footscray', 'VIC', '301')$$) = 'Postcode is four digits.',
  'a bad postcode');

-- Deleting an account: the address goes, the orders stay for the books without address or phone.
select pg_temp.check(pg_temp.try_as(:'nell', $$select public.save_delivery_address('2 High St', 'Footscray', 'VIC', '3011')$$) is null, 'address saved again');
do $$ begin perform private.forget_member('00000000-0000-0000-0000-00000000a0a4', 'nell@example.com'); end $$;
select pg_temp.check((select count(*) from member_private where member_id = :'nell'::uuid) = 0, 'member_private (with the address) is gone');
select pg_temp.check((select count(*) from shop_orders where member_id = :'nell'::uuid) = 1
  and (select street from shop_orders where member_id = :'nell'::uuid) is null and (select phone from shop_orders where member_id = :'nell'::uuid) is null
  and (select email from shop_orders where member_id = :'nell'::uuid) = '' and (select buyer_name from shop_orders where member_id = :'nell'::uuid) = 'Former member'
  and (select road_name from shop_orders where member_id = :'nell'::uuid) is null,
  'the order stays, without name, email, address or phone');
select pg_temp.check((select count(*) from ledger_entries where code = 'CR-005') = 1, 'the books keep the line');
do $$ begin perform private.forget_member('00000000-0000-0000-0000-00000000a0a8', 'chris@example.com'); end $$;
select pg_temp.check((select count(*) from shop_runners) = 0, 'a deleted account is no longer a shop runner');

\o
\echo 'Club shop: catalogue, orders, Make hand-off, books, address and deletion behave'
