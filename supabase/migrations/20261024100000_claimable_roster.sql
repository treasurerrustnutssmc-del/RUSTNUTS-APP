-- Claimable roster: people on the club's roster sign in with their own email and land straight on
-- their own record, already approved. See docs/superpowers/specs/2026-10-24-claimable-roster.md.

create table private.roster (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  chapter_id uuid not null references public.chapters (id),
  full_name text not null check (length(trim(full_name)) > 0),
  road_name text,
  status public.member_status not null,
  joined_on date,
  patched_on date,
  fng_started_on date,
  on_hiatus boolean not null default false,
  roles public.position_role[] not null default '{}',
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index roster_email on private.roster (lower(trim(email)));

-- Only an admin loads or reads it; the app never can. Row-level security with no policies is a
-- second lock in case the private schema is ever granted wholesale.
revoke all on private.roster from public, anon, authenticated;
alter table private.roster enable row level security;

-- Adds one roster position. The unique indexes enforce one holder per board seat and national
-- role, and no doubled roles; a clash (even one that appears mid-claim) is skipped, not fatal.
create or replace function private.add_roster_position(p_member uuid, p_seat uuid, p_role public.position_role)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.positions (member_id, chapter_id, role, started_on)
  values (p_member, p_seat, p_role, private.club_date());
  return true;
exception when unique_violation then
  return false;
end;
$$;
revoke all on function private.add_roster_position(uuid, uuid, public.position_role) from public, anon, authenticated;

create or replace function public.claim_roster()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_email text;
  entry private.roster%rowtype;
  wanted public.position_role;
  seat uuid;
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
  where lower(trim(email)) = my_email and claimed_by is null
  for update;
  if not found then return false; end if;

  insert into public.members (id, chapter_id, full_name, road_name, status, approval,
                              joined_on, patched_on, fng_started_on, on_hiatus, applied_on)
  values (me, entry.chapter_id, trim(entry.full_name), nullif(trim(entry.road_name), ''), entry.status, 'approved',
          entry.joined_on, entry.patched_on, entry.fng_started_on, entry.on_hiatus,
          coalesce(entry.joined_on, private.club_date()));

  insert into public.member_private (member_id, email) values (me, my_email);

  foreach wanted in array entry.roles loop
    seat := case when wanted in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder') then null else entry.chapter_id end;
    perform private.add_roster_position(me, seat, wanted);
  end loop;

  update private.roster set claimed_by = me, claimed_at = now() where id = entry.id;
  return true;
end;
$$;

revoke all on function public.claim_roster() from public, anon;
grant execute on function public.claim_roster() to authenticated;
