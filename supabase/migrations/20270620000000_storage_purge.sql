-- Deep audit (31 Oct 2026), finding F1: deleting an account removed the rows but left the member's
-- files in Storage, while the privacy policy says their photo files are cleared. The database can't
-- delete files itself (Storage keeps the bytes and guards its table), so forget_member queues the
-- paths and the purge-files Edge Function removes them with the service key, every ten minutes.
-- Spec: docs/superpowers/specs/2026-10-31-storage-purge-design.md. Safe to run twice, also after the
-- shared secret (20270630000000_cron_secret.sql) is in place.

create table if not exists private.storage_purge (
  id bigserial primary key,
  bucket text not null,
  path text not null,
  member_id uuid,
  queued_at timestamptz not null default now(),
  taken_at timestamptz,
  done_at timestamptz,
  attempts int not null default 0,
  error text
);
revoke all on private.storage_purge from public, anon, authenticated;
alter table private.storage_purge enable row level security;
create index if not exists storage_purge_pending on private.storage_purge (id) where done_at is null;

-- forget_member, as before, plus the queue insert at the end of the personal deletions.
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

  -- Their files (deep audit F1): everything they uploaded to the personal buckets that no surviving
  -- row still names. A file on a reported message stays with the message, for the board. The
  -- purge-files Edge Function deletes what's queued; the database can't reach Storage itself.
  insert into private.storage_purge (bucket, path, member_id)
  select o.bucket_id, o.name, p_member
  from storage.objects o
  where o.owner_id = p_member::text
    and o.bucket_id in ('chat-media', 'swap-media', 'build-media', 'brag-media')
    and not exists (select 1 from public.message_media mm where mm.path = o.name or mm.poster_path = o.name)
    and not exists (select 1 from public.listings l where l.photos @> jsonb_build_array(jsonb_build_object('path', o.name)))
    and not exists (select 1 from public.build_updates u where u.photos @> jsonb_build_array(jsonb_build_object('path', o.name)))
    and not exists (select 1 from public.brag_nominations n where n.photo->>'path' = o.name);

  delete from public.positions where member_id = p_member and ended_on is null and started_on > today;
  update public.positions set ended_on = today where member_id = p_member and ended_on is null;
  update public.members
     set full_name = 'Former member', road_name = null, bio = null, share_phone = false, on_hiatus = false,
         approval = 'declined', account_deleted_on = today, updated_at = now()
   where id = p_member;
end $$;

revoke all on function private.forget_member(uuid, text) from public, anon, authenticated;

-- For the purge-files function only. Rows a run took more than ten minutes ago and never finished go
-- back first (a timeout, a failed hand-back); then up to p_limit untaken rows with fewer than five
-- attempts are marked taken and handed out. Two runs can't take the same row (skip locked).
create or replace function public.purge_take(p_limit int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare taken bigint[];
begin
  update private.storage_purge set taken_at = null
  where done_at is null and taken_at is not null and taken_at < now() - interval '10 minutes';
  select array_agg(id) into taken from (
    select id from private.storage_purge
    where done_at is null and taken_at is null and attempts < 5
    order by id limit greatest(coalesce(p_limit, 100), 1) for update skip locked
  ) q;
  if taken is null then return '[]'::jsonb; end if;
  update private.storage_purge set taken_at = now(), attempts = attempts + 1 where id = any (taken);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'bucket', bucket, 'path', path) order by id)
                   from private.storage_purge where id = any (taken)), '[]'::jsonb);
end $$;

-- For the purge-files function only: what's gone, and what to try again with its error.
create or replace function public.purge_done(p_done bigint[], p_failed jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.storage_purge set done_at = now(), error = null where id = any (coalesce(p_done, '{}'::bigint[]));
  update private.storage_purge p set taken_at = null, error = left(f.error, 500)
  from jsonb_to_recordset(coalesce(p_failed, '[]'::jsonb)) as f(id bigint, error text)
  where p.id = f.id and p.done_at is null;
end $$;

revoke all on function public.purge_take(int), public.purge_done(bigint[], jsonb) from public, anon, authenticated;
grant execute on function public.purge_take(int), public.purge_done(bigint[], jsonb) to service_role;

create or replace function private.purge_url()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'purge_url';
$$;
revoke all on function private.purge_url() from public, anon, authenticated;

-- Every ten minutes where pg_cron and pg_net exist (Supabase). Until an admin sets 'purge_url' it does
-- nothing. Finished rows are cleared after 90 days.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    -- Once the shared secret exists (20270630000000_cron_secret.sql) the call carries its headers, so
    -- running this file again keeps them.
    if to_regprocedure('private.cron_headers()') is not null then
      perform cron.schedule('purge-files', '*/10 * * * *',
        $job$select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.purge_url() as u where u is not null$job$);
    else
      perform cron.schedule('purge-files', '*/10 * * * *',
        $job$select net.http_post(url := u, body := '{}'::jsonb) from private.purge_url() as u where u is not null$job$);
    end if;
    perform cron.schedule('storage-purge-cleanup', '23 3 * * *',
      $job$delete from private.storage_purge where done_at < now() - interval '90 days'$job$);
  end if;
end $$;
