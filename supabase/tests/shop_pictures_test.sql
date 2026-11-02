-- Checks the club shop's product pictures: who may add and remove them, the same refusals as
-- src/domain/shopPictures.ts, the catalogue carrying them to every member, and the bucket rules.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000b0b1', 'rog@example.com', now()),   -- West President (runs the shop)
  ('00000000-0000-0000-0000-00000000b0b2', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-00000000b0b3', 'chris@example.com', now()); -- Full, named shop runner

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, null, 'full'::member_status, 'approved'::approval_state
from (values
  ('00000000-0000-0000-0000-00000000b0b1', 'west', 'Roger Pres'),
  ('00000000-0000-0000-0000-00000000b0b2', 'west', 'Nell Member'),
  ('00000000-0000-0000-0000-00000000b0b3', 'north', 'Chris Dyson')
) as v(id, slug, name)
join chapters c on c.slug = v.slug;
insert into member_private (member_id, email) select id, (select email from auth.users u where u.id = m.id) from members m;
insert into positions (member_id, chapter_id, role, started_on)
values ('00000000-0000-0000-0000-00000000b0b1', (select id from chapters where slug = 'west'), 'president', '2024-07-01');

\set rog 00000000-0000-0000-0000-00000000b0b1
\set nell 00000000-0000-0000-0000-00000000b0b2
\set chris 00000000-0000-0000-0000-00000000b0b3

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

-- A design with a two-colour tee and a hi-vis tee; another design with one tee.
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
do $$
declare d uuid; ruok uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b1', true);
  set local role authenticated;
  d := public.set_shop_design(null, 'Better with you', 'any', '', 0, true);
  ruok := public.set_shop_design(null, 'R U OK', 'any', '', 1, true);
  insert into ids values ('better', d), ('ruok', ruok);
  insert into ids values ('tee', public.set_shop_garment(null, d, 'Tee', 4500, array['M'], array['Black', 'Grey'], 0, true));
  insert into ids values ('hivis', public.set_shop_garment(null, d, 'Hi-Vis Tee', 2700, array['M'], array['Hi-Vis'], 1, true));
  insert into ids values ('ruok-tee', public.set_shop_garment(null, ruok, 'Tee', 4000, array['M'], array['Grey'], 0, true));
  perform public.name_shop_runner('00000000-0000-0000-0000-00000000b0b3');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select id as better from ids where name = 'better' \gset
select id as ruok from ids where name = 'ruok' \gset
select id as tee from ids where name = 'tee' \gset
select id as hivis from ids where name = 'hivis' \gset
select id as ruok_tee from ids where name = 'ruok-tee' \gset

-- The bucket: public to read, only the shop uploads, into a design's folder.
select pg_temp.check((select public from storage.buckets where id = 'shop-pictures'), 'the shop-pictures bucket is public');
select pg_temp.check(pg_temp.try_as(:'nell', format($$insert into storage.objects (bucket_id, name) values ('shop-pictures', '%s/x.jpg')$$, :'better'))
  like 'new row violates row-level security%', 'a member without a shop seat cannot upload');
select pg_temp.check(pg_temp.try_as(:'chris', format($$insert into storage.objects (bucket_id, name) values ('shop-pictures', '%s/front.jpg')$$, :'better')) is null,
  'a named shop runner uploads');
select pg_temp.check(pg_temp.try_as(:'rog', format($$insert into storage.objects (bucket_id, name) values ('shop-pictures', '%s/back.jpg')$$, :'better')) is null,
  'the President uploads');
select pg_temp.check(pg_temp.try_as(:'rog', $$insert into storage.objects (bucket_id, name) values ('shop-pictures', 'nowhere/x.jpg')$$)
  like 'new row violates row-level security%', 'an upload goes in a real design''s folder');

-- Every other bucket still takes a member's uploads (these policies apply to all of storage.objects).
select pg_temp.check(pg_temp.try_as(:'nell', format($$insert into storage.objects (bucket_id, name) values ('site-media', '%s/x.jpg')$$, :'nell'))
  like 'new row violates row-level security%', 'site-media still refuses a member who isn''t an editor (no error from the shop policies)');
select pg_temp.check(pg_temp.try_as(:'nell', format($$insert into storage.objects (bucket_id, name) values ('feedback-media', '%s/x.jpg')$$, :'nell')) is null,
  'a member still uploads a feedback screenshot');
select pg_temp.check(pg_temp.try_as(:'nell', format($$select count(*) from storage.objects$$)) is null, 'and still reads storage without an error');

-- Adding: the same refusals in the same order as the app.
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.add_shop_picture(%L, null, null, 'front', '%s/front.jpg')$$, :'better', :'better'))
  = 'Only the people who run the shop can do that.', 'a member cannot add a picture');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(gen_random_uuid(), null, null, 'front', '%s/front.jpg')$$, :'better'))
  = 'No such design.', 'no such design');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, %L, null, 'front', '%s/front.jpg')$$, :'better', :'ruok_tee', :'better'))
  = 'No such garment.', 'a garment of another design');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, %L, 'Hi-Vis', 'front', '%s/front.jpg')$$, :'better', :'tee', :'better'))
  = 'Pick one of its colours, or any colour.', 'a colour the garment does not come in');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, null, 'Pink', 'front', '%s/front.jpg')$$, :'better', :'better'))
  = 'Pick one of its colours, or any colour.', 'a colour the design does not come in');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, null, null, 'left', '%s/front.jpg')$$, :'better', :'better'))
  = 'Pick front or back.', 'front or back');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, null, null, 'front', '%s/missing.jpg')$$, :'better', :'better'))
  = 'Upload the picture first.', 'the upload must be there');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, null, null, 'front', '%s/front.jpg')$$, :'ruok', :'better'))
  = 'Upload the picture first.', 'from the design''s own folder');
select pg_temp.check(pg_temp.try_as(:'chris', format($$select public.add_shop_picture(%L, null, 'Black', 'front', '%s/front.jpg')$$, :'better', :'better')) is null,
  'Chris adds the design''s black front, for any colour the design comes in');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, %L, 'Hi-Vis', 'back', '%s/back.jpg')$$, :'better', :'hivis', :'better')) is null,
  'the President adds the hi-vis tee''s back');
select pg_temp.check(pg_temp.try_as(:'rog', format($$select public.add_shop_picture(%L, null, null, 'front', '%s/front.jpg')$$, :'better', :'better'))
  = 'That picture is already in the shop.', 'one upload, one picture');

-- Everyone who sees the catalogue sees the pictures, in order.
select pg_temp.check(
  (select jsonb_agg(jsonb_build_object('g', p->'garment_id', 'c', p->'colour', 's', p->'side', 'p', p->'path') order by p->>'side' desc)
   from jsonb_array_elements((select d->'pictures' from jsonb_array_elements(pg_temp.json_as(:'nell', 'select public.merch_catalogue()')->'designs') d
     where d->>'name' = 'Better with you')) p)
  = jsonb_build_array(
      jsonb_build_object('g', null, 'c', 'Black', 's', 'front', 'p', :'better' || '/front.jpg'),
      jsonb_build_object('g', :'hivis', 'c', 'Hi-Vis', 's', 'back', 'p', :'better' || '/back.jpg')),
  'a member sees both pictures with their garment, colour, side and path');
select pg_temp.check((select d->'pictures' from jsonb_array_elements(pg_temp.json_as(:'nell', 'select public.merch_catalogue()')->'designs') d
  where d->>'name' = 'R U OK') = '[]'::jsonb, 'a design with none has an empty list');
select pg_temp.check(pg_temp.try_as(:'nell', 'select * from public.shop_pictures') like 'permission denied%', 'nobody reads the table directly');

-- An upload in use can't be deleted from the bucket; removing the picture frees it.
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'shop-pictures') = 2, 'two uploads');
select pg_temp.check(pg_temp.try_as(:'rog', format($$delete from storage.objects where bucket_id = 'shop-pictures' and name = '%s/back.jpg'$$, :'better')) is null, 'a picture in the shop stays in the bucket (the delete runs)');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'shop-pictures') = 2, 'a picture in the shop stays in the bucket');
select pg_temp.check(pg_temp.try_as(:'nell', format($$select public.remove_shop_picture(%L)$$, (select id from shop_pictures where side = 'back')))
  = 'Only the people who run the shop can do that.', 'a member cannot remove one');
select pg_temp.check(pg_temp.try_as(:'rog', $$select public.remove_shop_picture(gen_random_uuid())$$) = 'No such picture.', 'no such picture');
select pg_temp.check(pg_temp.json_as(:'rog', format($$select to_jsonb(public.remove_shop_picture(%L))$$, (select id from shop_pictures where side = 'back')))
  = to_jsonb(:'better' || '/back.jpg'), 'removing gives back the path to clear');
select pg_temp.check(pg_temp.try_as(:'rog', format($$delete from storage.objects where bucket_id = 'shop-pictures' and name = '%s/back.jpg'$$, :'better')) is null, 'then the upload can go (the delete runs)');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'shop-pictures') = 1, 'then the upload can go');
select pg_temp.check(pg_temp.try_as(:'nell', format($$delete from storage.objects where bucket_id = 'shop-pictures' and name = '%s/front.jpg'$$, :'better')) is null, 'a member deletes nothing (the delete runs)');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'shop-pictures') = 1, 'a member deletes nothing');

-- A garment or design that goes takes its pictures with it.
delete from shop_garments where id = :'hivis'::uuid;
delete from shop_designs where id = :'better'::uuid;
select pg_temp.check((select count(*) from shop_pictures) = 0, 'pictures go with their design');

\o
\echo 'Club shop pictures: bucket, add, remove and catalogue behave'
