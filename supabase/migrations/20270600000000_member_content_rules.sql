-- Member content rules (App Store Guideline 1.2). See
-- docs/superpowers/specs/2026-10-31-member-content-rules-design.md.
--
-- 1. The club rules for chats and posts: every approved member agrees once
--    (members.posting_rules_accepted_on). Until then a trigger refuses their chat messages,
--    listings, build updates, nominations, workshop entries and bio, as the row goes in, with
--    the app's words (src/domain/postingRules.ts).
-- 2. Reports on anything a member posts outside the chats: one table, content_reports, with
--    report_content / content_reports / resolve_content_report / my_open_reports, mirrored by
--    src/domain/reports.ts. Chat messages keep message_reports.
-- 3. Suspending a member's app access: suspend_member_access / restore_member_access set
--    members.approval to 'suspended' and back, mirrored by src/domain/access.ts. Every
--    members-only check already asks for 'approved', so the lock-out is immediate.
--
-- Additive: one column, one table, triggers and functions. No drops, no data changed.

-- 1. The club rules for chats and posts -------------------------------------------------------

alter table public.members add column if not exists posting_rules_accepted_on date;

create or replace function private.posting_rules_agreed(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = p_member and posting_rules_accepted_on is not null);
$$;
revoke all on function private.posting_rules_agreed(uuid) from public, anon, authenticated;

-- Records today's agreement (a second tap keeps the first date).
create or replace function public.accept_posting_rules()
returns date language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  agreed date;
begin
  update public.members set posting_rules_accepted_on = coalesce(posting_rules_accepted_on, private.club_date()), updated_at = now()
  where id = me
  returning posting_rules_accepted_on into agreed;
  return agreed;
end;
$$;
revoke all on function public.accept_posting_rules() from public, anon;
grant execute on function public.accept_posting_rules() to authenticated;

-- Refuses a post by someone who hasn't agreed. The member is whoever is signed in, or (loaded by
-- the owner, with nobody signed in) the row's author, named by the trigger's argument.
create or replace function private.refuse_unagreed_post()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who uuid := coalesce(auth.uid(), (to_jsonb(new)->>tg_argv[0])::uuid);
begin
  if who is not null and not private.posting_rules_agreed(who) then
    raise exception 'Agree to the club rules for chats and posts first.';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_unagreed_post() from public, anon, authenticated;

drop trigger if exists posting_rules_messages on public.messages;
create trigger posting_rules_messages before insert on public.messages
  for each row execute function private.refuse_unagreed_post('author_id');
drop trigger if exists posting_rules_listings on public.listings;
create trigger posting_rules_listings before insert or update of title, details on public.listings
  for each row execute function private.refuse_unagreed_post('seller_id');
drop trigger if exists posting_rules_build_updates on public.build_updates;
create trigger posting_rules_build_updates before insert on public.build_updates
  for each row execute function private.refuse_unagreed_post('author_id');
drop trigger if exists posting_rules_nominations on public.brag_nominations;
create trigger posting_rules_nominations before insert on public.brag_nominations
  for each row execute function private.refuse_unagreed_post('nominated_by');
drop trigger if exists posting_rules_mechanics on public.mechanics;
create trigger posting_rules_mechanics before insert or update of name, suburb, phone, website, speciality, notes on public.mechanics
  for each row execute function private.refuse_unagreed_post('added_by');

-- A bio is a post too. Clearing one (the board, or a deleted account) is always fine.
create or replace function private.refuse_unagreed_bio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who uuid := coalesce(auth.uid(), new.id);
begin
  if new.bio is not null and new.bio is distinct from old.bio and not private.posting_rules_agreed(who) then
    raise exception 'Agree to the club rules for chats and posts first.';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_unagreed_bio() from public, anon, authenticated;
drop trigger if exists posting_rules_bio on public.members;
create trigger posting_rules_bio before update of bio on public.members
  for each row execute function private.refuse_unagreed_bio();

-- 2. Reports on what members post outside the chats --------------------------------------------

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('listing', 'build_update', 'nomination', 'mechanic', 'profile')),
  target_id uuid not null,
  -- Who posted it (for a profile, whose it is), kept here so the queue and its rules need no joins.
  author_id uuid references public.members (id) on delete set null,
  reporter_id uuid not null references public.members (id) on delete cascade,
  reason text check (char_length(reason) <= 500),
  -- What was there when it was reported, for whoever deals with it.
  snapshot text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.members (id) on delete set null,
  outcome public.report_outcome
);
-- One open report per member per thing. Once it's dealt with, the thing can be reported again.
create unique index if not exists content_reports_one_open on public.content_reports (kind, target_id, reporter_id) where resolved_at is null;
alter table public.content_reports enable row level security;
revoke all on public.content_reports from public, anon, authenticated;
-- Nothing is read or written directly: report_content, content_reports and resolve_content_report
-- do it all with the rules below.

-- The thing being reported: who posted it, whether it's still up, and what it says.
create or replace function private.content_report_target(p_kind text, p_target uuid, out present boolean, out author uuid, out gone boolean, out snapshot text)
language plpgsql stable security definer set search_path = '' as $$
begin
  present := false; gone := false; snapshot := '';
  if p_kind = 'listing' then
    select true, l.seller_id, l.taken_down_at is not null, l.title || coalesce(E'\n' || l.details, '')
      into present, author, gone, snapshot from public.listings l where l.id = p_target;
  elsif p_kind = 'build_update' then
    select true, u.author_id, u.taken_down_at is not null, coalesce(u.body, '')
      into present, author, gone, snapshot from public.build_updates u where u.id = p_target;
  elsif p_kind = 'nomination' then
    select true, n.nominated_by, n.withdrawn_at is not null,
           concat_ws(E'\n', n.title, n.story, case when n.reason is not null then '“' || n.reason || '”' end)
      into present, author, gone, snapshot from public.brag_nominations n where n.id = p_target;
  elsif p_kind = 'mechanic' then
    select true, m.added_by, m.archived_at is not null, concat_ws(E'\n', m.name, m.speciality, m.notes)
      into present, author, gone, snapshot from public.mechanics m where m.id = p_target;
  elsif p_kind = 'profile' then
    select true, m.id, m.approval <> 'approved', concat_ws(E'\n', m.full_name, m.road_name, m.bio)
      into present, author, gone, snapshot from public.members m where m.id = p_target;
  end if;
  present := coalesce(present, false);
  gone := coalesce(gone, false);
  snapshot := coalesce(snapshot, '');
end;
$$;
revoke all on function private.content_report_target(text, uuid) from public, anon, authenticated;

create or replace function public.report_content(p_kind text, p_target uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t record;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  out uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_kind is null or p_kind not in ('listing', 'build_update', 'nomination', 'mechanic', 'profile') then
    raise exception 'Pick what you’re reporting.';
  end if;
  select * into t from private.content_report_target(p_kind, p_target);
  if not t.present then
    raise exception '%', case p_kind
      when 'listing' then 'No such listing.' when 'build_update' then 'No such update.'
      when 'nomination' then 'No such nomination.' when 'mechanic' then 'No such workshop.'
      else 'That member no longer exists.' end;
  end if;
  if t.gone then
    raise exception '%', case p_kind
      when 'listing' then 'That listing has been taken down.' when 'build_update' then 'That update has been taken down.'
      when 'nomination' then 'That nomination has been withdrawn.' when 'mechanic' then 'That workshop is off the list.'
      else 'They’re not an approved member.' end;
  end if;
  if t.author = me then
    raise exception '%', case p_kind
      when 'listing' then 'You can’t report your own listing.' when 'build_update' then 'You can’t report your own update.'
      when 'nomination' then 'You can’t report your own nomination.' when 'mechanic' then 'You can’t report your own workshop.'
      else 'You can’t report your own profile.' end;
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Keep the reason under 500 characters.'; end if;

  insert into public.content_reports (kind, target_id, author_id, reporter_id, reason, snapshot)
  values (p_kind, p_target, t.author, me, reason, t.snapshot)
  -- Reporting again changes the reason of an open report.
  on conflict (kind, target_id, reporter_id) where resolved_at is null do update
    set reason = excluded.reason, snapshot = excluded.snapshot, author_id = excluded.author_id
  returning id into out;
  return out;
end;
$$;

-- Who deals with a report: a profile goes to that member's chapter board; the rest to any board
-- member or the NEC, who can already take those things down.
create or replace function private.can_act_on_content_report(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when r.kind = 'profile' then r.author_id is not null and private.is_board_of(private.chapter_of(r.author_id))
                else private.is_any_board() end
    from public.content_reports r
    where r.id = p_report
  ), false);
$$;
revoke all on function private.can_act_on_content_report(uuid) from public, anon, authenticated;

-- Open reports the caller can act on, newest first.
create or replace function public.content_reports()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'target_id', r.target_id, 'author_id', r.author_id, 'reporter_id', r.reporter_id,
      'reason', r.reason, 'snapshot', r.snapshot, 'created_at', r.created_at
    ) as x
    from public.content_reports r
    where r.resolved_at is null and private.is_approved_member() and private.can_act_on_content_report(r.id)
  ) reports;
$$;

-- Deals with a report: take the thing down the way the board already can, or dismiss. Either way
-- every open report on that thing closes.
create or replace function public.resolve_content_report(p_report uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.content_reports%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.content_reports where id = p_report for update;
  if not found then raise exception 'No such report.'; end if;
  if not private.can_act_on_content_report(p_report) then
    raise exception '%', case when r.kind = 'profile' then 'Only that member’s chapter board can do that.' else 'Only the board can do that.' end;
  end if;
  if r.resolved_at is not null then raise exception 'That report was already dealt with.'; end if;
  if p_remove then
    if r.kind = 'listing' then
      update public.listings set taken_down_at = now(), taken_down_by = me, updated_at = now() where id = r.target_id and taken_down_at is null;
    elsif r.kind = 'build_update' then
      update public.build_updates set taken_down_at = now(), taken_down_by = me where id = r.target_id and taken_down_at is null;
    elsif r.kind = 'nomination' then
      update public.brag_nominations set withdrawn_at = now(), withdrawn_by = me where id = r.target_id and withdrawn_at is null;
    elsif r.kind = 'mechanic' then
      update public.mechanics set archived_at = now(), archived_by = me, updated_at = now() where id = r.target_id and archived_at is null;
    elsif r.kind = 'profile' then
      update public.members set bio = null, updated_at = now() where id = r.target_id and bio is not null;
    end if;
  end if;
  update public.content_reports set resolved_at = now(), resolved_by = me, outcome = case when p_remove then 'removed' else 'dismissed' end::public.report_outcome
  where kind = r.kind and target_id = r.target_id and resolved_at is null;
end;
$$;

-- The caller's own open reports, chat messages included, so the app can hide those things from
-- them until the board has looked.
create or replace function public.my_open_reports()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', 'message', 'target_id', r.message_id) as x
    from public.message_reports r where r.reporter_id = auth.uid() and r.resolved_at is null
    union all
    select jsonb_build_object('kind', r.kind, 'target_id', r.target_id)
    from public.content_reports r where r.reporter_id = auth.uid() and r.resolved_at is null
  ) mine;
$$;

revoke all on function public.report_content(text, uuid, text), public.content_reports(), public.resolve_content_report(uuid, boolean),
  public.my_open_reports() from public, anon;
grant execute on function public.report_content(text, uuid, text), public.content_reports(), public.resolve_content_report(uuid, boolean),
  public.my_open_reports() to authenticated;

-- 3. Suspending a member's app access ----------------------------------------------------------

create or replace function public.suspend_member_access(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  t public.members%rowtype;
begin
  select * into t from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.id = me then raise exception 'You can’t suspend your own access.'; end if;
  if not private.is_board_of(t.chapter_id) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if t.approval <> 'approved' then raise exception 'They’re not an approved member.'; end if;
  update public.members set approval = 'suspended', updated_at = now() where id = p_member;
end;
$$;

create or replace function public.restore_member_access(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  t public.members%rowtype;
begin
  select * into t from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.id = me then raise exception 'You can’t restore your own access.'; end if;
  if not private.is_board_of(t.chapter_id) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if t.approval <> 'suspended' then raise exception 'Their access isn’t suspended.'; end if;
  update public.members set approval = 'approved', updated_at = now() where id = p_member;
end;
$$;

revoke all on function public.suspend_member_access(uuid), public.restore_member_access(uuid) from public, anon;
grant execute on function public.suspend_member_access(uuid), public.restore_member_access(uuid) to authenticated;
