-- A Legacy roster row (left the club in good standing) never seats its holder or puts them on
-- hiatus, even if the sheet says so. An honour such as Founder stays. The loader
-- (src/data/rosterSql.ts) refuses such rows too; this is the backstop. Grants are kept.

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
          entry.joined_on, entry.patched_on, entry.fng_started_on, entry.on_hiatus and entry.status <> 'legacy',
          coalesce(entry.joined_on, private.club_date()));

  insert into public.member_private (member_id, email) values (me, my_email);

  foreach wanted in array entry.roles loop
    continue when entry.status = 'legacy' and wanted <> 'founder';
    seat := case when wanted in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder') then null else entry.chapter_id end;
    perform private.add_roster_position(me, seat, wanted);
  end loop;

  update private.roster set claimed_by = me, claimed_at = now() where id = entry.id;
  return true;
end;
$$;
