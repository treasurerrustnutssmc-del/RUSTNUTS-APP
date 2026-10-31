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
-- approvals, counts and every member check.
create or replace function private.forget_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.member_private where member_id = p_member;
  delete from public.bikes where member_id = p_member; -- regos go with them
  delete from public.emergency_contacts where member_id = p_member;
  delete from public.notification_prefs where member_id = p_member;
  delete from public.push_devices where member_id = p_member;
  delete from private.push_outbox where member_id = p_member;
  -- Chat
  delete from public.messages where author_id = p_member; -- with their photos, reactions and reports
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
  delete from public.brag_votes where member_id = p_member;

  update public.positions set ended_on = greatest(current_date, started_on) where member_id = p_member and ended_on is null;
  update public.members
     set full_name = 'Former member', road_name = null, bio = null, share_phone = false, on_hiatus = false,
         approval = 'declined', account_deleted_on = current_date, updated_at = now()
   where id = p_member;
end $$;
revoke all on function private.forget_member(uuid) from public, anon, authenticated;

create or replace function private.forget_deleted_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.forget_member(old.id);
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
