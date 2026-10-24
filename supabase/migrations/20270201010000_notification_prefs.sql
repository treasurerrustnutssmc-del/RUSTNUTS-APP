-- Notification settings, one row per member. See docs/superpowers/specs/2026-10-24-phone-superpowers-design.md,
-- section 3. No row means the defaults, which the app applies. Members read their own row and save it
-- through save_notification_prefs; nobody writes the table directly.

create table public.notification_prefs (
  member_id uuid primary key references public.members (id) on delete cascade,
  ride_reminders boolean not null default true,
  ride_changes boolean not null default true,
  new_rides boolean not null default false,
  approvals boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from public, anon, authenticated;
grant select on public.notification_prefs to authenticated;
create policy notification_prefs_own on public.notification_prefs
  for select to authenticated using (member_id = auth.uid());

create or replace function public.save_notification_prefs(
  p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes,
    new_rides = excluded.new_rides, approvals = excluded.approvals, updated_at = now();
end;
$$;
revoke all on function public.save_notification_prefs(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_notification_prefs(boolean, boolean, boolean, boolean) to authenticated;
