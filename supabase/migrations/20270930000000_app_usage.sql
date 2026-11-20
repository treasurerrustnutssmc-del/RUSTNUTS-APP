-- App usage counts, for making the app easier to use (Jeff, 21 Nov 2026; he chose anonymous).
-- The app sends which screens a visit went through and the error messages shown, in batches.
-- A visit is a random id the phone makes when the app opens and keeps only in memory. No member id,
-- no name, no email, no IP, no device id: the server works out only the tier (public, member,
-- family, board) at the moment of sending. Rows go after 90 days.
-- The board reads the last days with app_usage_summary(). Mirrors src/domain/appUsage.ts.
-- Spec: docs/superpowers/specs/2026-11-21-app-usage-design.md

create table public.app_usage_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  visit_id uuid not null,
  seq integer not null check (seq >= 0),
  kind text not null check (kind in ('screen', 'error')),
  name text not null check (name ~ '^[A-Za-z][A-Za-z0-9_-]*$' and length(name) <= 60),
  detail text check (detail is null or length(detail) <= 120),
  tier text not null check (tier in ('public', 'member', 'family', 'board')),
  platform text not null check (platform in ('ios', 'android', 'web', 'other')),
  app_version text not null check (length(app_version) <= 20)
);
create index app_usage_events_at on public.app_usage_events (at);
create index app_usage_events_visit on public.app_usage_events (visit_id, seq);
alter table public.app_usage_events enable row level security;
revoke all on public.app_usage_events from public, anon, authenticated;

-- Takes one batch from the phone. A bad event is dropped without a word (the member never sees an
-- error from this), a call keeps 50, a visit 200, and the whole club 5,000 a day, so a script
-- looping on it can't grow the table. Each call also sweeps rows past 90 days.
create or replace function public.app_usage_record(p_visit uuid, p_platform text, p_version text, p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tier text;
  v_platform text := case when p_platform in ('ios', 'android', 'web') then p_platform else 'other' end;
  v_version text := left(coalesce(nullif(trim(p_version), ''), '?'), 20);
  v_room integer;
  v_today timestamptz := date_trunc('day', now() at time zone 'Australia/Melbourne') at time zone 'Australia/Melbourne';
begin
  delete from public.app_usage_events where at < now() - interval '90 days';
  if p_visit is null or p_events is null or jsonb_typeof(p_events) <> 'array' then return; end if;

  v_room := least(
    50,
    200 - (select count(*) from public.app_usage_events where visit_id = p_visit)::int,
    5000 - (select count(*) from public.app_usage_events where at >= v_today)::int
  );
  if v_room <= 0 then return; end if;

  v_tier := case
    when auth.uid() is null then 'public'
    when private.is_family() then 'family'
    when not private.is_approved_member() then 'public'
    when private.is_any_board() then 'board'
    else 'member'
  end;

  insert into public.app_usage_events (visit_id, seq, kind, name, detail, tier, platform, app_version)
  select p_visit, e.seq, e.kind, e.name,
         case when e.kind = 'error' then e.detail end,
         v_tier, v_platform, v_version
  from (
    select
      case when jsonb_typeof(x -> 'seq') = 'number' then (x ->> 'seq')::numeric::integer end as seq,
      x ->> 'kind' as kind,
      trim(x ->> 'name') as name,
      nullif(left(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(x ->> 'detail', ''),
        '[^\s@]+@[^\s@]+\.[^\s@]+', '[email]', 'g'),
        '\d[\d\s-]{5,}\d', '[number]', 'g'),
        '\s+', ' ', 'g')), 120), '') as detail,
      ord
    from jsonb_array_elements(p_events) with ordinality as t(x, ord)
    where jsonb_typeof(x) = 'object'
  ) e
  where e.seq is not null and e.seq >= 0
    and e.kind in ('screen', 'error')
    and e.name ~ '^[A-Za-z][A-Za-z0-9_-]*$' and length(e.name) <= 60
    and (e.kind = 'screen' or e.detail is not null)
  order by e.ord
  limit v_room;
end;
$$;
revoke all on function public.app_usage_record(uuid, text, text, jsonb) from public;
grant execute on function public.app_usage_record(uuid, text, text, jsonb) to anon, authenticated;

-- The board's summary for the last p_days (1 to 90): each visit's screens in order (the newest
-- 3,000 visits), and the error messages with how often each was seen.
create or replace function public.app_usage_summary(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can see app usage.'; end if;
  return jsonb_build_object(
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('started', v.started, 'tier', v.tier, 'platform', v.platform,
        'version', v.version, 'screens', v.screens) order by v.started desc)
      from (
        select min(e.at) as started, min(e.tier) as tier, min(e.platform) as platform, max(e.app_version) as version,
               coalesce(jsonb_agg(e.name order by e.seq) filter (where e.kind = 'screen'), '[]'::jsonb) as screens
        from public.app_usage_events e
        where e.at >= v_from
        group by e.visit_id
        order by min(e.at) desc
        limit 3000
      ) v
    ), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object('screen', r.name, 'detail', r.detail, 'hits', r.hits,
        'last', r.last, 'platforms', r.platforms) order by r.hits desc, r.last desc)
      from (
        select e.name, e.detail, count(*)::int as hits, max(e.at) as last,
               string_agg(distinct e.platform, ',') as platforms
        from public.app_usage_events e
        where e.at >= v_from and e.kind = 'error'
        group by e.name, e.detail
        order by count(*) desc
        limit 50
      ) r
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.app_usage_summary(integer) from public, anon;
grant execute on function public.app_usage_summary(integer) to authenticated;
