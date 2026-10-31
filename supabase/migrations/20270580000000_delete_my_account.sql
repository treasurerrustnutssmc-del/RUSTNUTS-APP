-- Delete my account (Apple and Google Play both require it in the app).
-- The sign-in and the member's own details and doings go. The club's records (books, attendance,
-- minutes, votes, 5.5 notices, conduct records, past seats) stay against the same member id, now a
-- nameless "Former member", so they still add up. Deleting a user from the Supabase dashboard (how
-- the board answers an emailed request) does exactly the same, through the trigger.
-- Spec: docs/superpowers/specs/2026-10-31-delete-my-account-design.md

do $$
begin
  if not has_table_privilege(current_user, 'auth.users', 'delete') then
    raise exception 'This role can''t delete sign-ins (auth.users), so Delete my account wouldn''t work. Nothing was changed.';
  end if;
end $$;

-- The member row outlives the sign-in. Its link to auth.users wiped club records with the member,
-- or, where the books hold on (restrict), stopped the sign-in being deleted at all. Every insert into
-- members takes auth.uid(), so nothing relied on the link.
alter table public.members drop constraint if exists members_id_fkey;
alter table public.members add column if not exists account_deleted_on date;

-- Forgets a member whose sign-in has gone: personal and social rows are deleted, open roles end
-- today, and the member row becomes "Former member", declined, so it drops out of the directory,
-- approvals, counts and every member check. Their roster place (the copy of the board's sheet the
-- app loads from) loses its phone, emergency contact, bike and seats, so coming back with the same
-- email brings back their status but none of that, and no seat.
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
  update private.roster
     set phone = null, emergency_name = null, emergency_relationship = null, emergency_phone = null,
         bike_make = null, bike_model = null, bike_rego = null, roles = '{}'
   where claimed_by = p_member or (p_email is not null and lower(trim(email)) = lower(trim(p_email)));

  delete from public.positions where member_id = p_member and ended_on is null and started_on > today;
  update public.positions set ended_on = today where member_id = p_member and ended_on is null;
  update public.members
     set full_name = 'Former member', road_name = null, bio = null, share_phone = false, on_hiatus = false,
         approval = 'declined', account_deleted_on = today, updated_at = now()
   where id = p_member;
end $$;
revoke all on function private.forget_member(uuid, text) from public, anon, authenticated;

-- A login stays valid for up to an hour after its account is deleted (another phone, say). It can't
-- put anything personal back on a forgotten member.
create or replace function private.refuse_forgotten()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.members where id = new.member_id and account_deleted_on is not null) then
    raise exception 'This account has been deleted.';
  end if;
  return new;
end $$;
revoke all on function private.refuse_forgotten() from public, anon, authenticated;

create or replace function private.refuse_forgotten_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.account_deleted_on is not null then raise exception 'This account has been deleted.'; end if;
  return new;
end $$;
revoke all on function private.refuse_forgotten_member() from public, anon, authenticated;

drop trigger if exists refuse_forgotten on public.members;
create trigger refuse_forgotten before update on public.members
  for each row execute function private.refuse_forgotten_member();
do $$
declare t text;
begin
  foreach t in array array['member_private', 'bikes', 'emergency_contacts', 'push_devices', 'notification_prefs',
                           'member_birthdays', 'member_skills'] loop
    execute format('drop trigger if exists refuse_forgotten on public.%I', t);
    execute format('create trigger refuse_forgotten before insert or update on public.%I
                      for each row execute function private.refuse_forgotten()', t);
  end loop;
end $$;

create or replace function private.forget_deleted_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.forget_member(old.id, old.email);
  return old;
end $$;
revoke all on function private.forget_deleted_user() from public, anon, authenticated;

drop trigger if exists forget_deleted_member on auth.users;
create trigger forget_deleted_member after delete on auth.users
  for each row execute function private.forget_deleted_user();

-- The member deletes their own account. A sitting board or national seat holder steps down first
-- (the app says the same, src/domain/account.ts); other roles just end today.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if exists (
    select 1 from public.positions
    where member_id = me and ended_on is null
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                   'nec_chair', 'nec_secretary', 'nec_auditor')
  ) then
    raise exception 'Step down from your seat first, so the club can fill it. Then you can delete your account.';
  end if;
  delete from auth.users where id = me; -- the trigger forgets the member
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
