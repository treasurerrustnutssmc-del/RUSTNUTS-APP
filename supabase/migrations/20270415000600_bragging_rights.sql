-- Social extras (Stage 7): bragging rights, the club's yearly awards. The board opens an award;
-- members nominate a ride, a photo or a story, then vote, one vote each, never for their own.
-- Everything changes only through open_award, archive_award, nominate, withdraw_nomination and
-- cast_brag_vote, which apply the same checks with the same words as src/domain/social/brag.ts, in
-- the same order. Nothing is ever deleted: an award taken off is archived, a nomination withdrawn
-- is kept with who withdrew it, and a changed vote is changed in place.

create type public.brag_kind as enum ('ride', 'photo', 'story');

create table public.brag_awards (
  id uuid primary key default gen_random_uuid(),
  kind public.brag_kind not null,
  title text not null check (char_length(title) between 1 and 60),
  year int not null check (year >= 2019),
  -- Nominations are open until the end of this day (Melbourne), voting until the end of the next.
  nominations_close date not null,
  voting_close date not null,
  opened_by uuid references public.members (id) on delete set null,
  opened_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null,
  constraint brag_awards_dates check (voting_close > nominations_close)
);

create table public.brag_nominations (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.brag_awards (id) on delete cascade,
  nominated_by uuid references public.members (id) on delete set null,
  -- A ride award's ride; a photo award's title and photo; a story award's title and story.
  ride_id uuid references public.rides (id) on delete set null,
  title text check (char_length(title) between 1 and 80),
  -- {path, width, height}, in the nominator's brag-media folder.
  photo jsonb check (photo is null or jsonb_typeof(photo) = 'object'),
  story text check (char_length(story) between 1 and 1000),
  reason text check (char_length(reason) between 1 and 300),
  nominated_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.members (id) on delete set null
);
create index brag_nominations_award on public.brag_nominations (award_id);

create table public.brag_votes (
  award_id uuid not null references public.brag_awards (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  nomination_id uuid not null references public.brag_nominations (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (award_id, member_id)
);

-- Approved members read awards that are up and nominations that stand; each reads only their own
-- vote. Nobody writes through the API.
alter table public.brag_awards enable row level security;
alter table public.brag_nominations enable row level security;
alter table public.brag_votes enable row level security;
revoke all on public.brag_awards, public.brag_nominations, public.brag_votes from public, anon, authenticated;
grant select on public.brag_awards, public.brag_nominations, public.brag_votes to authenticated;
create policy brag_awards_for_members on public.brag_awards for select to authenticated
  using (private.is_approved_member() and archived_at is null);
create policy brag_nominations_for_members on public.brag_nominations for select to authenticated
  using (
    private.is_approved_member() and withdrawn_at is null
    and exists (select 1 from public.brag_awards a where a.id = award_id and a.archived_at is null)
  );
create policy brag_votes_own on public.brag_votes for select to authenticated
  using (private.is_approved_member() and member_id = auth.uid());

-- An award's phase on the club's date: nominating, voting or closed.
create or replace function private.award_phase(p_nominations_close date, p_voting_close date)
returns text language sql stable set search_path = '' as $$
  select case
    when private.club_date() <= p_nominations_close then 'nominating'
    when private.club_date() <= p_voting_close then 'voting'
    else 'closed'
  end;
$$;
revoke all on function private.award_phase(date, date) from public, anon, authenticated;

-- Vote counts, for awards that have closed only, so nobody sees how it's going while it's open.
create or replace function public.brag_tallies()
returns table (nomination_id uuid, votes int) language sql stable security definer set search_path = '' as $$
  select n.id, (select count(*)::int from public.brag_votes v where v.nomination_id = n.id)
  from public.brag_nominations n
  join public.brag_awards a on a.id = n.award_id
  where private.is_approved_member()
    and a.archived_at is null and n.withdrawn_at is null
    and private.award_phase(a.nominations_close, a.voting_close) = 'closed';
$$;

-- ---------------------------------------------------------------------------------------------
-- Photos: a private bucket, like build-media. Approved members upload into their own folder and
-- read the photos of nominations that stand, plus their own uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brag-media', 'brag-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.can_read_brag_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.brag_nominations n join public.brag_awards a on a.id = n.award_id
      where n.withdrawn_at is null and a.archived_at is null and n.photo->>'path' = p_name
    )
  );
$$;

-- Whether a file is on any nomination, withdrawn ones included (the caller can't see those).
create or replace function private.brag_file_in_use(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.brag_nominations n where n.photo->>'path' = p_name);
$$;
revoke all on function private.can_read_brag_file(text), private.brag_file_in_use(text) from public, anon;
grant execute on function private.can_read_brag_file(text), private.brag_file_in_use(text) to authenticated;

create policy brag_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'brag-media' and split_part(name, '/', 1) = auth.uid()::text and private.is_approved_member());
create policy brag_media_read on storage.objects for select to authenticated
  using (bucket_id = 'brag-media' and private.can_read_brag_file(name));
-- An upload that never made it onto a nomination can be cleared away by whoever uploaded it.
create policy brag_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'brag-media' and owner_id = auth.uid()::text and not private.brag_file_in_use(name));

-- ---------------------------------------------------------------------------------------------
-- Actions

-- Opens an award, returning its id. Dates come as text so one that isn't real gets the app's words.
create or replace function public.open_award(
  p_kind text, p_title text, p_year int, p_nominations_close text, p_voting_close text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

-- Takes an award off. It's kept, archived, with who took it off.
create or replace function public.archive_award(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

-- Nominates something for an award, returning the nomination's id. Only the parts the award's kind
-- uses are kept: a ride; a title and a photo; or a title and a story. Words are trimmed like the
-- app trims them.
create or replace function public.nominate(
  p_award uuid, p_ride uuid, p_title text, p_photo jsonb, p_story text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

-- Withdraws a nomination while nominations are open: whoever nominated it, or the board or NEC.
create or replace function public.withdraw_nomination(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n public.brag_nominations%rowtype;
  a public.brag_awards%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into n from public.brag_nominations where id = p_id for update;
  if not found then raise exception 'No such nomination.'; end if;
  select * into a from public.brag_awards where id = n.award_id;
  if n.nominated_by is distinct from me and not private.is_any_board() then
    raise exception 'Only whoever nominated it or the board can withdraw it.';
  end if;
  if private.award_phase(a.nominations_close, a.voting_close) <> 'nominating' then
    raise exception 'Nominations are closed.';
  end if;
  if n.withdrawn_at is not null then raise exception 'That nomination has already been withdrawn.'; end if;
  update public.brag_nominations set withdrawn_at = now(), withdrawn_by = me where id = p_id;
end;
$$;

-- Casts (or changes) my vote in a nomination's award while voting is open.
create or replace function public.cast_brag_vote(p_nomination uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

revoke all on function
  public.brag_tallies(), public.open_award(text, text, int, text, text), public.archive_award(uuid),
  public.nominate(uuid, uuid, text, jsonb, text, text), public.withdraw_nomination(uuid), public.cast_brag_vote(uuid)
from public, anon;
grant execute on function
  public.brag_tallies(), public.open_award(text, text, int, text, text), public.archive_award(uuid),
  public.nominate(uuid, uuid, text, jsonb, text, text), public.withdraw_nomination(uuid), public.cast_brag_vote(uuid)
to authenticated;
