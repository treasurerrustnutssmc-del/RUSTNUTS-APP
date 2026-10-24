-- The Road Rules (constitution 7.10, 15.4): the versions the NEC publishes, and each member's
-- latest sign-off. Both are locked: members change them only through publish_road_rules and
-- sign_road_rules, which apply the same rules with the same words as src/domain/roadRules.ts,
-- checked in the same order. Versions are never edited or taken back: a correction is a new version.

-- One published text. The current version is the highest number. fresh says whether everyone
-- signs again (version 1 always does). The publisher is kept loosely: a member leaving the club
-- leaves their versions. The limits mirror publish_road_rules's.
create table public.road_rules_versions (
  number int primary key check (number >= 1),
  body text not null check (char_length(body) <= 20000 and private.trim_like_app(body) <> ''),
  changes text check (char_length(changes) <= 500),
  fresh boolean not null,
  published_by uuid references public.members (id) on delete set null,
  published_at timestamptz not null default now()
);

-- Each member's latest sign-off: which version, and when. It goes with its member.
create table public.road_rules_signoffs (
  member_id uuid primary key references public.members (id) on delete cascade,
  version int not null references public.road_rules_versions (number),
  signed_at timestamptz not null
);
create index road_rules_signoffs_version on public.road_rules_signoffs (version);

-- Approved members read both; nobody writes either through the API.
alter table public.road_rules_versions enable row level security;
alter table public.road_rules_signoffs enable row level security;
revoke all on public.road_rules_versions, public.road_rules_signoffs from public, anon, authenticated;
grant select on public.road_rules_versions, public.road_rules_signoffs to authenticated;
create policy road_rules_versions_for_members on public.road_rules_versions for select to authenticated
  using (private.is_approved_member());
create policy road_rules_signoffs_for_members on public.road_rules_signoffs for select to authenticated
  using (private.is_approved_member());

-- Publishes a new version and returns its number. Publishers are the NEC (private.is_national: a
-- national role or a sitting chapter President, the app's isNational). p_seen is the current
-- number the editor opened on (0 when there were none): a publish on top of someone else's newer
-- version is refused rather than quietly replacing it. Publishes take one lock, so two of them
-- queue and the second sees the first's version. Texts are trimmed like the app trims, a blank
-- What changed is stored as none, and lengths count characters. Version 1 always needs a fresh
-- sign-off, and no answer means the default, yes.
create or replace function public.publish_road_rules(p_body text, p_changes text, p_fresh boolean, p_seen int)
returns int language plpgsql security definer set search_path = '' as $$
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
$$;

-- Signs the current version, now. p_version is the number on screen: signing an older one is
-- refused, so a sign-off always means the current text. Signing again while signed moves the date
-- on, so a member can renew early. It shares the publish lock, so a publish in progress finishes
-- first and this checks the version it leaves.
create or replace function public.sign_road_rules(p_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  current_number int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock_shared(hashtext('road_rules_publish'));
  select max(number) into current_number from public.road_rules_versions;
  if current_number is null then raise exception 'There are no Road Rules to sign yet.'; end if;
  if p_version is null or p_version <> current_number then
    raise exception 'The Road Rules changed while you had them open. Read the new version, then sign.';
  end if;

  insert into public.road_rules_signoffs (member_id, version, signed_at) values (me, current_number, now())
  on conflict (member_id) do update set version = excluded.version, signed_at = excluded.signed_at;
end;
$$;

revoke all on function public.publish_road_rules(text, text, boolean, int), public.sign_road_rules(int)
  from public, anon;
grant execute on function public.publish_road_rules(text, text, boolean, int), public.sign_road_rules(int)
  to authenticated;

-- The last day a sign-off counts: the same Melbourne date one year after signing. A sign-off on
-- 29 February is good until 28 February. The app's goodUntil.
create or replace function private.road_rules_good_until(p_signed_at timestamptz)
returns date language sql stable set search_path = '' as $$
  select ((p_signed_at at time zone 'Australia/Melbourne')::date + interval '1 year')::date;
$$;
revoke all on function private.road_rules_good_until(timestamptz) from public, anon, authenticated;

-- Whether a member is signed today (in Melbourne): something is published, their sign-off is on
-- the sign-off base (the newest version that needed a fresh sign-off) or later, and today is on or
-- before its good-until date. The app's current or due_soon. For later use, such as a gate.
create or replace function private.road_rules_signed(p_member uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select s.version >= b.base and private.club_date() <= private.road_rules_good_until(s.signed_at)
    from public.road_rules_signoffs s
    cross join (select max(number) as base from public.road_rules_versions where fresh or number = 1) b
    where s.member_id = p_member and b.base is not null
  ), false);
$$;
revoke all on function private.road_rules_signed(uuid) from public, anon, authenticated;
