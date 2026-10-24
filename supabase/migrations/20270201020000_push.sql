-- Push notifications, held until launch. See docs/superpowers/specs/2026-10-24-phone-superpowers-design.md,
-- section 3. Triggers write one row per recipient into private.push_outbox; the send-push Edge Function
-- takes them every minute. While private.app_settings 'push_enabled' isn't 'true' it marks them held
-- and sends nothing, and a held row is never sent later, so switching on doesn't send a backlog.

-- Each phone's Expo push token, saved by the app on sign-in and removed on sign-out.
create table public.push_devices (
  token text primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_devices_member on public.push_devices (member_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public, anon, authenticated;

create table private.push_outbox (
  id bigserial primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  -- What the row is about, so the same event never reaches the same member twice.
  dedupe_key text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'held', 'sending', 'sent', 'failed', 'skipped')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (member_id, dedupe_key)
);
create index push_outbox_queued on private.push_outbox (id) where status = 'queued';
revoke all on private.push_outbox from public, anon, authenticated;
alter table private.push_outbox enable row level security;

-- The master switch. Rows written while it's off are held the moment they're written, so switching on
-- (or setting the send address) never sends a backlog.
create or replace function private.push_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true' from private.app_settings where key = 'push_enabled'), false);
$$;

create or replace function private.push_hold_when_off()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.push_enabled() then new.status := 'held'; end if;
  return new;
end;
$$;
create trigger push_outbox_hold before insert on private.push_outbox for each row execute function private.push_hold_when_off();

-- "Sat 07/11/2026" and "8:30 am", in Melbourne time.
create or replace function private.club_day(t timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(t at time zone 'Australia/Melbourne', 'Dy DD/MM/YYYY');
$$;
create or replace function private.club_time(t timestamptz)
returns text language sql immutable set search_path = '' as $$
  select ltrim(to_char(t at time zone 'Australia/Melbourne', 'HH12:MI am'), '0');
$$;
create or replace function private.short_name(m public.members)
returns text language sql immutable set search_path = '' as $$
  select coalesce(m.road_name, split_part(m.full_name, ' ', 1));
$$;

-- A ride cancelled, or its start moved, while it's still ahead: the riders going or maybe hear about it.
create or replace function private.push_ride_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t text;
  b text;
  k text;
  opens uuid := new.id;
  moved public.rides%rowtype;
begin
  if new.starts_at <= now() then return new; end if;
  if old.cancelled_at is null and new.cancelled_at is not null then
    -- A calendar sync moves an event by adding it at its new time and cancelling the old row, in one
    -- transaction: that's a time change.
    if new.feed_id is not null then
      select * into moved from public.rides x
      where x.feed_id = new.feed_id and x.external_uid = new.external_uid and x.id <> new.id and x.cancelled_at is null
        and x.xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text
      order by abs(extract(epoch from x.starts_at - new.starts_at)) limit 1;
    end if;
    if moved.id is not null then
      t := 'Ride time changed';
      b := new.title || ' · now ' || private.club_day(moved.starts_at) ||
        case when moved.all_day then '' else ' ' || private.club_time(moved.starts_at) end;
      k := 'ride-time:' || new.id || ':' || moved.starts_at;
      opens := moved.id;
    else
      t := 'Ride cancelled';
      b := new.title || ' · ' || private.club_day(new.starts_at);
      k := 'ride-cancel:' || new.id;
    end if;
  elsif new.cancelled_at is null and old.starts_at is distinct from new.starts_at then
    t := 'Ride time changed';
    b := new.title || ' · now ' || private.club_day(new.starts_at) ||
      case when new.all_day then '' else ' ' || private.club_time(new.starts_at) end;
    k := 'ride-time:' || new.id || ':' || new.starts_at;
  else
    return new;
  end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select r.member_id, k, t, b, jsonb_build_object('kind', 'ride', 'rideId', opens)
  from public.rsvps r
  left join public.notification_prefs p on p.member_id = r.member_id
  where r.ride_id = new.id and r.answer in ('going', 'maybe') and coalesce(p.ride_changes, true)
    and r.member_id is distinct from auth.uid() -- not whoever made the change
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

-- A new ride in the next 60 days: approved members in its colours who asked (club and supported rides
-- are everyone's).
create or replace function private.push_ride_added()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null or new.starts_at <= now() or new.starts_at > now() + interval '60 days' then
    return new;
  end if;
  -- A calendar event at a new time (or the next of a repeating one) isn't a new ride.
  if new.feed_id is not null and exists (
    select 1 from public.rides x
    where x.feed_id = new.feed_id and x.external_uid = new.external_uid and x.id <> new.id and x.cancelled_at is null
  ) then
    return new;
  end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select m.id, 'ride-new:' || new.id, 'New ride',
    new.title || ' · ' || private.club_day(new.starts_at) ||
      case when new.all_day then '' else ' ' || private.club_time(new.starts_at) end,
    jsonb_build_object('kind', 'ride', 'rideId', new.id)
  from public.members m
  join public.chapters c on c.id = m.chapter_id
  left join public.notification_prefs p on p.member_id = m.id
  where m.approval = 'approved' and coalesce(p.new_rides, false) and m.id is distinct from auth.uid()
    and (new.category in ('club', 'supported') or c.slug = new.category::text)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

-- Someone asks to join: that chapter's board hears about it.
create or replace function private.push_applicant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.approval <> 'pending' then return new; end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select distinct pos.member_id, 'applicant:' || new.id, 'Waiting for approval',
    new.full_name || ' asked to join ' || c.name, jsonb_build_object('kind', 'applicant', 'memberId', new.id)
  from public.positions pos
  join public.members b on b.id = pos.member_id
  join public.chapters c on c.id = new.chapter_id
  left join public.notification_prefs p on p.member_id = pos.member_id
  where pos.chapter_id = new.chapter_id and pos.ended_on is null and b.approval = 'approved'
    and pos.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    and coalesce(p.approvals, true)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

-- A live ride alert: everyone sharing on that ride, whatever their settings (it's about safety).
create or replace function private.push_ride_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select lr.member_id, 'alert:' || new.id,
    case new.kind
      when 'emergency' then 'EMERGENCY: ' || who || ' needs help'
      when 'out' then who || ' is out of the ride'
      else 'Regroup pin set'
    end,
    'Open live ride', jsonb_build_object('kind', 'live-alert', 'rideId', new.ride_id)
  from public.live_riders lr
  where lr.ride_id = new.ride_id and lr.member_id <> new.member_id and lr.stops_at > now()
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

revoke all on function private.push_enabled(), private.push_hold_when_off(), private.club_day(timestamptz), private.club_time(timestamptz), private.short_name(public.members),
  private.push_ride_changed(), private.push_ride_added(), private.push_applicant(), private.push_ride_alert()
  from public, anon, authenticated;

create trigger rides_push_changed after update on public.rides for each row execute function private.push_ride_changed();
create trigger rides_push_added after insert on public.rides for each row execute function private.push_ride_added();
create trigger members_push_applicant after insert on public.members for each row execute function private.push_applicant();
create trigger ride_alerts_push after insert on public.ride_alerts for each row execute function private.push_ride_alert();

-- The app saves this phone's token on sign-in. A phone belongs to whoever signed in on it last.
create or replace function public.register_push_device(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.push_devices (token, member_id, platform, updated_at) values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update set member_id = auth.uid(), platform = excluded.platform, updated_at = now();
end;
$$;

-- On sign-out: this phone stops getting pushes. Only the phone itself knows its token, so it may do this
-- signed out too (a sign-out with no signal finishes the next time the app opens).
create or replace function public.forget_push_device(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = p_token;
$$;

revoke all on function public.register_push_device(text, text), public.forget_push_device(text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;
grant execute on function public.forget_push_device(text) to anon, authenticated;

-- For the send-push function only. Claims up to p_limit queued rows with their phones. With the
-- switch off, it holds them all and returns nothing to send. Rows for members with no phone are skipped.
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
      'tokens', (select jsonb_agg(d.token order by d.token) from public.push_devices d where d.member_id = o.member_id))
      order by o.id)
    from private.push_outbox o where o.id = any (taken) and o.status = 'sending'), '[]'::jsonb));
end;
$$;

-- For the send-push function only: what went, what didn't, and tokens Expo says are gone.
create or replace function public.push_done(p_sent bigint[], p_failed bigint[], p_dead_tokens text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.push_outbox set status = 'sent', sent_at = now() where id = any (p_sent);
  update private.push_outbox set status = 'failed', sent_at = now() where id = any (p_failed);
  delete from public.push_devices where token = any (p_dead_tokens);
end;
$$;

revoke all on function public.push_take(int), public.push_done(bigint[], bigint[], text[]) from public, anon, authenticated;
grant execute on function public.push_take(int), public.push_done(bigint[], bigint[], text[]) to service_role;

create or replace function private.push_url()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'push_url';
$$;
revoke all on function private.push_url() from public, anon, authenticated;

-- Every minute where pg_cron and pg_net exist (Supabase). Until an admin sets 'push_url' it does
-- nothing. Outbox rows are cleared after 90 days (they're what stops a repeat, so they stay a while).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('send-push', '* * * * *',
      $job$select net.http_post(url := u, body := '{}'::jsonb) from private.push_url() as u where u is not null$job$);
    perform cron.schedule('push-outbox-cleanup', '17 3 * * *',
      $job$delete from private.push_outbox where created_at < now() - interval '90 days'$job$);
  end if;
end $$;
