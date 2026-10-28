-- Social extras (Stage 7): swap and sell. Members list parts and gear for sale, to swap, free, or
-- wanted, with up to six photos. Listings change only through save_listing, mark_listing_sold and
-- take_down_listing, which apply the same checks with the same words as src/domain/social/swap.ts,
-- in the same order. Nothing is ever deleted: a listing taken down keeps its row, with who took it
-- down, and its photos are kept in the listing itself so changing them never removes a row.

create type public.listing_kind as enum ('sell', 'swap', 'free', 'wanted');

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.members (id) on delete cascade,
  kind public.listing_kind not null,
  title text not null check (char_length(title) between 1 and 80),
  -- Whole dollars, on a sale only.
  price_dollars int check (price_dollars between 1 and 100000),
  details text check (char_length(details) <= 1000),
  -- [{path, width, height}], the first is the cover. Paths are in the seller's swap-media folder.
  photos jsonb not null default '[]' check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 6),
  listed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sold_at timestamptz,
  taken_down_at timestamptz,
  taken_down_by uuid references public.members (id) on delete set null,
  constraint listings_price_on_sales check ((kind = 'sell') = (price_dollars is not null))
);
create index listings_seller on public.listings (seller_id);

-- Approved members read what's up from approved sellers; nobody writes through the API.
alter table public.listings enable row level security;
revoke all on public.listings from public, anon, authenticated;
grant select on public.listings to authenticated;
create policy listings_for_members on public.listings for select to authenticated
  using (
    private.is_approved_member()
    and taken_down_at is null
    and exists (select 1 from public.members m where m.id = seller_id and m.approval = 'approved')
  );

-- ---------------------------------------------------------------------------------------------
-- Photos: a private bucket. Approved members upload into their own folder (`<member id>/...`) and
-- read the photos of listings they can see, plus their own uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('swap-media', 'swap-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.can_read_swap_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.listings l join public.members m on m.id = l.seller_id
      where l.taken_down_at is null and m.approval = 'approved'
        and l.photos @> jsonb_build_array(jsonb_build_object('path', p_name))
    )
  );
$$;
revoke all on function private.can_read_swap_file(text) from public, anon;
grant execute on function private.can_read_swap_file(text) to authenticated;

create policy swap_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'swap-media' and split_part(name, '/', 1) = auth.uid()::text and private.is_approved_member());
create policy swap_media_read on storage.objects for select to authenticated
  using (bucket_id = 'swap-media' and private.can_read_swap_file(name));
-- An upload that never made it onto a listing can be cleared away by whoever uploaded it.
create policy swap_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'swap-media' and owner_id = auth.uid()::text
         and not exists (select 1 from public.listings l where l.photos @> jsonb_build_array(jsonb_build_object('path', name))));

-- ---------------------------------------------------------------------------------------------
-- Actions

-- Lists something (p_id null) or changes your listing, returning its id. Texts are trimmed like
-- the app trims them; blank details are stored as none; a price sent with anything but a sale is
-- ignored. Photos: [{path, width, height}], up to six, each already uploaded by you into your own
-- folder, not on another listing, and not twice.
create or replace function public.save_listing(
  p_id uuid, p_kind text, p_title text, p_price numeric, p_details text, p_photos jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.listings%rowtype;
  c_title text := coalesce(private.trim_like_app(p_title), '');
  c_details text := nullif(private.trim_like_app(p_details), '');
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  c_kind public.listing_kind;
  c_price int;
  bad boolean;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into l from public.listings where id = p_id for update;
    if not found then raise exception 'No such listing.'; end if;
    if l.seller_id <> me then raise exception 'Only whoever listed it can change it.'; end if;
    if l.taken_down_at is not null then raise exception 'That listing has been taken down.'; end if;
  end if;
  if p_kind is null or p_kind not in (select unnest(enum_range(null::public.listing_kind))::text) then
    raise exception 'Pick what kind of listing it is.';
  end if;
  c_kind := p_kind::public.listing_kind;
  if c_title = '' then raise exception 'Give it a title.'; end if;
  if char_length(c_title) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
  if c_kind = 'sell' then
    if p_price is null or p_price <> trunc(p_price) or p_price < 1 or p_price > 100000 then
      raise exception 'Put a price on it, in whole dollars.';
    end if;
    c_price := p_price::int;
  end if;
  if char_length(c_details) > 1000 then raise exception 'Keep the details to 1,000 characters at most.'; end if;
  if jsonb_typeof(v_photos) <> 'array' then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  if jsonb_array_length(v_photos) > 6 then raise exception 'Up to 6 photos.'; end if;

  select exists (
    select 1 from jsonb_array_elements(v_photos) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'path') is distinct from 'string'
       or split_part(item->>'path', '/', 1) <> me::text
       or not exists (select 1 from storage.objects o
                      where o.bucket_id = 'swap-media' and o.name = item->>'path' and o.owner_id = me::text)
       or exists (select 1 from public.listings other
                  where other.id is distinct from p_id
                    and other.photos @> jsonb_build_array(jsonb_build_object('path', item->>'path')))
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

  if p_id is null then
    insert into public.listings (seller_id, kind, title, price_dollars, details, photos)
    values (me, c_kind, c_title, c_price, c_details, v_photos)
    returning id into new_id;
    return new_id;
  end if;
  update public.listings
  set kind = c_kind, title = c_title, price_dollars = c_price, details = c_details, photos = v_photos,
      updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

-- Marks your listing sold (p_sold true) or puts it back on.
create or replace function public.mark_listing_sold(p_id uuid, p_sold boolean)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

-- Takes a listing down: whoever listed it, or the board or NEC. It's kept, with who took it down.
create or replace function public.take_down_listing(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.listings%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into l from public.listings where id = p_id for update;
  if not found then raise exception 'No such listing.'; end if;
  if l.seller_id <> me and not private.is_any_board() then
    raise exception 'Only whoever listed it or the board can take it down.';
  end if;
  if l.taken_down_at is not null then raise exception 'That listing has already been taken down.'; end if;
  update public.listings set taken_down_at = now(), taken_down_by = me where id = p_id;
end;
$$;

revoke all on function public.save_listing(uuid, text, text, numeric, text, jsonb),
  public.mark_listing_sold(uuid, boolean), public.take_down_listing(uuid) from public, anon;
grant execute on function public.save_listing(uuid, text, text, numeric, text, jsonb),
  public.mark_listing_sold(uuid, boolean), public.take_down_listing(uuid) to authenticated;
