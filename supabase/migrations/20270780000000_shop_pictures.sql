-- Product pictures in the club shop (Jeff, 2 Nov 2026: "pictures for all the items in each tier").
-- A picture belongs to a design (shown on every garment of it) or to one garment, for one colour or
-- any colour, front or back. The files sit in a public bucket (the same artwork is public on the
-- club website's shop); the shop runners upload into the design's folder and record the picture
-- with add_shop_picture(). merch_catalogue() now carries each design's pictures. Rules in the same
-- words and order as src/domain/shopPictures.ts. Spec: docs/superpowers/specs/2026-11-02-shop-pictures-design.md.

create table public.shop_pictures (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.shop_designs (id) on delete cascade,
  garment_id uuid references public.shop_garments (id) on delete cascade,
  colour text check (char_length(colour) between 1 and 20),
  side text not null check (side in ('front', 'back')),
  path text not null unique check (char_length(path) between 3 and 200),
  sort int not null default 0,
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now()
);
create index shop_pictures_design on public.shop_pictures (design_id);
create index shop_pictures_garment on public.shop_pictures (garment_id);
create index shop_pictures_added_by on public.shop_pictures (added_by);
alter table public.shop_pictures enable row level security;
revoke all on public.shop_pictures from public, anon, authenticated;

-- The bucket: anyone may look (public URLs, like the website's shop images); only the people who
-- run the shop upload, into a design's folder; an upload in use is only cleared after its picture.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-pictures', 'shop-pictures', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- The policies ask through these (members can't read the shop tables themselves).
create or replace function private.shop_picture_upload_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.runs_shop() and exists (select 1 from public.shop_designs d where d.id::text = split_part(p_name, '/', 1));
$$;
create or replace function private.shop_picture_unused(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.runs_shop() and not exists (select 1 from public.shop_pictures p where p.path = p_name);
$$;
create or replace function private.runs_shop_pictures()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.runs_shop();
$$;
revoke all on function private.shop_picture_upload_ok(text), private.shop_picture_unused(text), private.runs_shop_pictures() from public, anon;
grant execute on function private.shop_picture_upload_ok(text), private.shop_picture_unused(text), private.runs_shop_pictures() to authenticated;

create policy shop_pictures_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-pictures' and private.shop_picture_upload_ok(name));
create policy shop_pictures_read on storage.objects for select to authenticated
  using (bucket_id = 'shop-pictures' and private.runs_shop_pictures());
create policy shop_pictures_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'shop-pictures' and private.shop_picture_unused(name));

create or replace function public.add_shop_picture(p_design uuid, p_garment uuid, p_colour text, p_side text, p_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
  if (select count(*) from public.shop_pictures where design_id = p_design) >= 40 then raise exception 'Up to 40 pictures a design.'; end if;
  if exists (select 1 from public.shop_pictures where path = pth) then raise exception 'That picture is already in the shop.'; end if;
  insert into public.shop_pictures (design_id, garment_id, colour, side, path, sort, added_by)
  values (p_design, p_garment, c, p_side, pth,
          coalesce((select max(sort) + 1 from public.shop_pictures where design_id = p_design), 0), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Takes the picture out of the shop; gives back the file's path so the app clears the upload.
create or replace function public.remove_shop_picture(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare pth text;
begin
  perform private.require_runs_shop();
  delete from public.shop_pictures where id = p_id returning path into pth;
  if pth is null then raise exception 'No such picture.'; end if;
  return pth;
end;
$$;

revoke all on function public.add_shop_picture(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.remove_shop_picture(uuid) from public, anon;
grant execute on function public.add_shop_picture(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.remove_shop_picture(uuid) to authenticated;

-- The catalogue, as before, with each design's pictures.
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
          from public.shop_garments g where g.design_id = d.id and (g.on_sale or private.runs_shop())), '[]'::jsonb),
        'pictures', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'garment_id', p.garment_id, 'colour', p.colour, 'side', p.side, 'path', p.path, 'sort', p.sort)
            order by p.sort, p.id)
          from public.shop_pictures p where p.design_id = d.id), '[]'::jsonb)
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
