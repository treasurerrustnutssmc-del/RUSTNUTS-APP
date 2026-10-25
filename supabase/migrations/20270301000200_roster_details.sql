-- The roster can carry a phone, an emergency contact and a bike from the club's sheet. They land in
-- the member's own profile when they first sign in, where they can change them.

alter table private.roster
  add column phone text,
  add column emergency_name text,
  add column emergency_relationship text,
  add column emergency_phone text,
  add column bike_make text,
  add column bike_model text,
  add column bike_rego text,
  -- Half a contact or half a bike (blank counts as missing) would fail the profile's own checks
  -- mid-claim and stop the member signing in, so refuse it here.
  add constraint roster_emergency_whole check (
    (nullif(trim(emergency_name), '') is null) = (nullif(trim(emergency_phone), '') is null)
    and (nullif(trim(emergency_relationship), '') is null or nullif(trim(emergency_name), '') is not null)),
  add constraint roster_bike_whole check (
    (nullif(trim(bike_make), '') is null) = (nullif(trim(bike_model), '') is null)
    and (nullif(trim(bike_rego), '') is null or nullif(trim(bike_make), '') is not null));

create or replace function public.claim_roster()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_email text;
  entry private.roster%rowtype;
  wanted public.position_role;
  seat uuid;
  bike uuid;
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
          entry.joined_on, entry.patched_on, entry.fng_started_on, entry.on_hiatus and entry.status <> 'legacy',
          coalesce(entry.joined_on, private.club_date()));

  insert into public.member_private (member_id, email, phone) values (me, my_email, nullif(trim(entry.phone), ''));

  -- The sheet doesn't say how they know their contact; the member can fix the label.
  if nullif(trim(entry.emergency_name), '') is not null then
    insert into public.emergency_contacts (member_id, name, relationship, phone)
    values (me, trim(entry.emergency_name), coalesce(nullif(trim(entry.emergency_relationship), ''), 'Emergency contact'),
            trim(entry.emergency_phone));
  end if;

  if nullif(trim(entry.bike_make), '') is not null then
    insert into public.bikes (member_id, make, model) values (me, trim(entry.bike_make), trim(entry.bike_model))
    returning id into bike;
    if nullif(trim(entry.bike_rego), '') is not null then
      insert into public.bike_registrations (bike_id, rego) values (bike, upper(trim(entry.bike_rego)));
    end if;
  end if;

  foreach wanted in array entry.roles loop
    continue when entry.status = 'legacy' and wanted <> 'founder';
    seat := case when wanted in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder') then null else entry.chapter_id end;
    perform private.add_roster_position(me, seat, wanted);
  end loop;

  update private.roster set claimed_by = me, claimed_at = now() where id = entry.id;
  return true;
end;
$$;
