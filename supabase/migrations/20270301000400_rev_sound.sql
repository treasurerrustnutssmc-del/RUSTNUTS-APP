-- The Harley rev: notifications play a V-twin rev (assets/sounds/v_twin_rev.wav) unless a member
-- switches it off in Me > Notifications. Live ride alerts always keep the urgent sound.
-- The setting is saved with the other notification settings, and push_take tells the sender which
-- sound each member wants, so pushes match the phone's own reminders.

alter table public.notification_prefs add column if not exists rev_sound boolean not null default true;

-- Five settings now. The four-setting version stays for app builds from before the rev, and leaves
-- the rev as it was.
create or replace function public.save_notification_prefs(
  p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, rev_sound, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, p_rev_sound, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes,
    new_rides = excluded.new_rides, approvals = excluded.approvals, rev_sound = excluded.rev_sound, updated_at = now();
end;
$$;
revoke all on function public.save_notification_prefs(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_notification_prefs(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- As before, plus 'rev': whether this member wants the Harley rev (no saved settings means yes).
create or replace function public.push_take(p_limit int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  enabled boolean := private.push_enabled();
  taken bigint[];
begin
  -- A run that died after claiming rows (a timeout, a failed hand-back): count them as failed.
  update private.push_outbox set status = 'failed', sent_at = now()
  where status = 'sending' and created_at < now() - interval '10 minutes';
  if not enabled then
    update private.push_outbox set status = 'held' where status = 'queued';
    return jsonb_build_object('enabled', false, 'messages', '[]'::jsonb);
  end if;
  select array_agg(id) into taken from (
    select id from private.push_outbox where status = 'queued' order by id limit p_limit for update skip locked
  ) q;
  if taken is null then return jsonb_build_object('enabled', true, 'messages', '[]'::jsonb); end if;
  update private.push_outbox o set status = 'skipped', sent_at = now()
  where o.id = any (taken) and not exists (select 1 from public.push_devices d where d.member_id = o.member_id);
  update private.push_outbox set status = 'sending' where id = any (taken) and status = 'queued';
  return jsonb_build_object('enabled', true, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'body', o.body, 'data', o.data,
      'tokens', (select jsonb_agg(d.token order by d.token) from public.push_devices d where d.member_id = o.member_id),
      'rev', coalesce((select p.rev_sound from public.notification_prefs p where p.member_id = o.member_id), true))
      order by o.id)
    from private.push_outbox o where o.id = any (taken) and o.status = 'sending'), '[]'::jsonb));
end;
$$;
revoke all on function public.push_take(int) from public, anon, authenticated;
grant execute on function public.push_take(int) to service_role;
