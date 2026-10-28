-- Stage 5D: conduct records that delete themselves after 12 months, with reviews and appeals
-- (constitution v4 6.9, 14); merch designs, orders and their money (15.1, 13.1); national
-- contributions shared by Voting Members (13.6); and new chapters (12.1).
-- See docs/superpowers/specs/2026-10-28-stage-5d-board-admin-design.md. Nobody reaches these
-- tables directly: club_admin() reads, and each action checks the rules in src/domain/conduct.ts,
-- merch.ts and national.ts, refusing with the same words in the same order.

-- Conduct records ------------------------------------------------------------------------------

create table public.conduct_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id),
  kind text not null check (kind in ('vest', 'ride_safety', 'attendance', 'other', 'reprimand', 'suspension', 'expulsion')),
  summary text not null check (char_length(summary) between 1 and 1000),
  rule text check (char_length(rule) <= 200),
  decided_on date not null,
  notice_on date not null check (notice_on >= decided_on),
  suspended_until date,
  recorded_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default now(),
  hold_until date,
  hold_reason text check (char_length(hold_reason) <= 300),
  check ((kind = 'suspension') = (suspended_until is not null))
);

-- One review or appeal per record. A set-aside one takes its record with it, so it's never stored.
create table public.conduct_appeals (
  record_id uuid primary key references public.conduct_records (id) on delete cascade,
  lodged_on date not null,
  lodged_by uuid references public.members (id) on delete set null,
  grounds text not null check (char_length(grounds) between 1 and 1000),
  panel uuid[] not null default '{}',
  hearing_on date,
  outcome text check (outcome in ('confirmed', 'varied')),
  outcome_note text check (char_length(outcome_note) <= 1000),
  decided_on date,
  decided_by uuid references public.members (id) on delete set null,
  withdrawn_on date
);

-- Merch ----------------------------------------------------------------------------------------

create table public.merch_items (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id), -- null: the whole club
  name text not null check (char_length(name) between 1 and 80),
  details text check (char_length(details) <= 500),
  sizes text[] not null default '{}',
  price_cents int not null check (price_cents between 1 and 100000),
  patched_only boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'on_sale', 'declined', 'closed')),
  proposed_by uuid references public.members (id) on delete set null,
  proposed_at timestamptz not null default now(),
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 300)
);

create table public.merch_orders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.merch_items (id),
  member_id uuid not null references public.members (id) on delete restrict,
  size text,
  qty int not null check (qty between 1 and 10),
  unit_cents int not null check (unit_cents > 0),
  note text check (char_length(note) <= 300),
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'paid', 'handed_over', 'declined', 'cancelled')),
  ordered_at timestamptz not null default now(),
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 300),
  paid_on date,
  ledger_entry_id uuid references public.ledger_entries (id),
  handed_over_on date
);

-- National contributions and new chapters -------------------------------------------------------

create table public.national_contributions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  purpose text not null check (char_length(purpose) between 1 and 1000),
  total_cents int not null check (total_cents between 100 and 10000000),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'not_approved', 'withdrawn')),
  proposed_by uuid references public.members (id) on delete set null,
  proposed_at timestamptz not null default now(),
  settled_at timestamptz,
  -- Each chapter's share, fixed when proposed: [{chapter_id, voting_members, cents}], by slug.
  shares jsonb not null
);

create table public.contribution_decisions (
  contribution_id uuid not null references public.national_contributions (id),
  chapter_id uuid not null references public.chapters (id),
  yes boolean not null,
  vote_id uuid not null references public.votes (id),
  recorded_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (contribution_id, chapter_id)
);

create table public.chapter_proposals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  area text not null check (char_length(area) between 1 and 80),
  state text not null,
  plan jsonb not null, -- {location, membership, leadership, budget, operations}
  founder_ids uuid[] not null,
  president_id uuid not null references public.members (id),
  saa_id uuid not null references public.members (id),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'not_approved', 'withdrawn')),
  proposed_by uuid references public.members (id) on delete set null,
  proposed_at timestamptz not null default now(),
  vote_id uuid references public.votes (id),
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  chapter_id uuid references public.chapters (id)
);

alter table public.conduct_records enable row level security;
alter table public.conduct_appeals enable row level security;
alter table public.merch_items enable row level security;
alter table public.merch_orders enable row level security;
alter table public.national_contributions enable row level security;
alter table public.contribution_decisions enable row level security;
alter table public.chapter_proposals enable row level security;
revoke all on public.conduct_records, public.conduct_appeals, public.merch_items, public.merch_orders,
  public.national_contributions, public.contribution_decisions, public.chapter_proposals
  from public, anon, authenticated;

-- Helpers --------------------------------------------------------------------------------------

-- The first day a record is gone: 12 months after the decision (or a suspension's end, when
-- later), or the day after a hold, whichever is later (6.9). Mirrors deleteOn.
create or replace function private.conduct_delete_on(p_decided date, p_suspended date, p_hold date)
returns date language sql immutable set search_path = '' as $$
  select greatest((greatest(p_decided, coalesce(p_suspended, p_decided)) + interval '12 months')::date, p_hold + 1);
$$;

create or replace function private.conduct_formal(p_kind text)
returns boolean language sql immutable set search_path = '' as $$
  select p_kind in ('reprimand', 'suspension', 'expulsion');
$$;

-- Kept: before its day, or while its review or appeal is open.
create or replace function private.conduct_kept(r public.conduct_records)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.club_date() < private.conduct_delete_on(r.decided_on, r.suspended_until, r.hold_until)
    or exists (select 1 from public.conduct_appeals a where a.record_id = r.id and a.outcome is null and a.withdrawn_on is null);
$$;

-- The member's chapter now, so a record follows them when they move (12.4).
create or replace function private.conduct_chapter(r public.conduct_records)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select m.chapter_id from public.members m where m.id = r.member_id), r.chapter_id);
$$;

-- A vote already standing for another decision here, or for a budget, can't stand for a second one.
create or replace function private.vote_used(p_vote uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contribution_decisions where vote_id = p_vote)
      or exists (select 1 from public.chapter_proposals where vote_id = p_vote)
      or exists (select 1 from public.budgets where approved_vote_id = p_vote);
$$;

-- The member, their chapter's board, the NEC, and the panel hearing it.
create or replace function private.sees_conduct(r public.conduct_records)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    r.member_id = auth.uid() or private.is_board_of(private.conduct_chapter(r))
    or exists (select 1 from public.conduct_appeals a where a.record_id = r.id and auth.uid() = any (a.panel)));
$$;

-- Deletes every record past its day (6.9). Runs daily, and before every conduct action.
create or replace function private.purge_conduct()
returns void language sql security definer set search_path = '' as $$
  delete from public.conduct_records r where not private.conduct_kept(r);
$$;

-- A record this person may see. Run after the purge, so it's still kept.
create or replace function private.conduct_record(p_id uuid)
returns public.conduct_records language plpgsql stable security definer set search_path = '' as $$
declare r public.conduct_records;
begin
  select * into r from public.conduct_records where id = p_id;
  if not found or not private.sees_conduct(r) then raise exception 'No such record.'; end if;
  return r;
end;
$$;

-- Found, and the board or NEC acting on someone else's record.
create or replace function private.conduct_board_record(p_id uuid)
returns public.conduct_records language plpgsql stable security definer set search_path = '' as $$
declare r public.conduct_records := private.conduct_record(p_id);
begin
  if not private.is_board_of(private.conduct_chapter(r)) then raise exception 'Only that member’s chapter board or the NEC can do that.'; end if;
  if r.member_id = auth.uid() then raise exception 'You can’t record one about yourself.'; end if;
  return r;
end;
$$;

-- Found, with a review or appeal that's still open.
create or replace function private.conduct_open_appeal(p_id uuid)
returns public.conduct_appeals language plpgsql stable security definer set search_path = '' as $$
declare r public.conduct_records := private.conduct_record(p_id); a public.conduct_appeals;
begin
  select * into a from public.conduct_appeals where record_id = r.id;
  if not found then raise exception 'No review or appeal is lodged.'; end if;
  if a.outcome is not null or a.withdrawn_on is not null then raise exception 'That one is settled.'; end if;
  return a;
end;
$$;

-- Sits on that chapter's board (not just the NEC). Mirrors holdsBoardSeat.
create or replace function private.holds_board_seat(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and chapter_id = p_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'));
$$;

create or replace function private.sees_merch_item(i public.merch_items)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (i.status in ('on_sale', 'closed') or private.runs_scope(i.chapter_id));
$$;

create or replace function private.sees_merch_order(o public.merch_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.merch_items i where i.id = o.item_id
      and (o.member_id = auth.uid() or private.runs_scope(i.chapter_id) or private.keeps_books(i.chapter_id)));
$$;

-- A chapter's slug from its name. Mirrors slugOf.
create or replace function private.slug_of(p_name text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(lower(private.trim_like_app(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function private.chapter_name_taken(p_name text, p_except uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chapters c
                 where lower(private.trim_like_app(c.name)) = lower(private.trim_like_app(p_name)) or c.slug = private.slug_of(p_name))
      or exists (select 1 from public.chapter_proposals p
                 where p.id is distinct from p_except and p.status = 'proposed'
                   and (lower(private.trim_like_app(p.name)) = lower(private.trim_like_app(p_name)) or private.slug_of(p.name) = private.slug_of(p_name)));
$$;

-- The founders and their seats as 12.1 and 9.1 need them. Mirrors foundersProblem.
create or replace function private.founders_problem(p_founders uuid[], p_president uuid, p_saa uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when (select count(distinct f) from unnest(p_founders) f) <> cardinality(p_founders) or cardinality(p_founders) < 5
      or exists (select 1 from unnest(p_founders) f where f is null)
      then 'A new chapter needs at least five founders (12.1).'
    when (select count(*) from public.members where id = any (p_founders) and approval = 'approved' and status in ('full', 'nomad'))
         <> cardinality(p_founders)
      then 'Founders must be approved Full or Nomad members (12.1).'
    when p_president is null or p_saa is null or not (p_president = any (p_founders)) or not (p_saa = any (p_founders)) or p_president = p_saa
      then 'Pick a founding President and Sergeant-at-Arms from the founders (12.1).'
    when exists (select 1 from public.members where id in (p_president, p_saa) and status = 'nomad')
      then 'Nomads can’t hold a board seat (9.1).'
  end;
$$;

-- Each chapter's share of a total, in proportion to its Voting Members, to the cent; the cents
-- left over go one each to the largest fractions, ties to the earlier slug. Mirrors shareOut.
create or replace function private.contribution_shares(p_total int)
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select ch.id, ch.slug, (select count(*) from public.members m
                            where m.chapter_id = ch.id and m.approval = 'approved' and m.status in ('full', 'nomad')) as n
    from public.chapters ch
  ), t as (select coalesce(sum(n), 0)::bigint as s from c),
  p as (
    select c.id, c.slug, c.n,
           case when t.s = 0 then 0 else (p_total::bigint * c.n) / t.s end as whole,
           case when t.s = 0 then 0 else (p_total::bigint * c.n) % t.s end as rest
    from c, t
  ), r as (
    select p.*, row_number() over (order by p.rest desc, p.slug collate "C") as rn,
           p_total - sum(p.whole) over () as spare
    from p
  )
  select coalesce(jsonb_agg(jsonb_build_object('chapter_id', id, 'voting_members', n,
                                               'cents', whole + case when rn <= spare then 1 else 0 end)
                            order by slug collate "C"), '[]'::jsonb)
  from r;
$$;

revoke all on function private.conduct_delete_on(date, date, date), private.conduct_formal(text),
  private.conduct_kept(public.conduct_records), private.sees_conduct(public.conduct_records), private.purge_conduct(),
  private.conduct_record(uuid), private.conduct_board_record(uuid), private.conduct_open_appeal(uuid),
  private.holds_board_seat(uuid), private.sees_merch_item(public.merch_items), private.sees_merch_order(public.merch_orders),
  private.slug_of(text), private.chapter_name_taken(text, uuid), private.founders_problem(uuid[], uuid, uuid),
  private.contribution_shares(int), private.conduct_chapter(public.conduct_records), private.vote_used(uuid)
  from public, anon, authenticated;

-- Conduct actions ------------------------------------------------------------------------------

create or replace function public.record_conduct(
  p_member uuid, p_kind text, p_summary text, p_rule text, p_decided date, p_notice date, p_suspended date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  m public.members;
  s text := private.trim_like_app(coalesce(p_summary, ''));
  ru text := private.trim_like_app(coalesce(p_rule, ''));
  susp date := case when p_kind = 'suspension' then p_suspended end;
  today date := private.club_date();
  new_id uuid;
begin
  perform private.purge_conduct();
  select * into m from public.members where id = p_member;
  if not found or m.approval <> 'approved' then raise exception 'Pick an approved member.'; end if;
  if m.id = me then raise exception 'You can’t record one about yourself.'; end if;
  if not private.is_board_of(m.chapter_id) then raise exception 'Only that member’s chapter board or the NEC can do that.'; end if;
  if p_kind is null or p_kind not in ('vest', 'ride_safety', 'attendance', 'other', 'reprimand', 'suspension', 'expulsion') then
    raise exception 'Pick what kind of record it is.';
  end if;
  if s = '' then raise exception 'Say what happened.'; end if;
  if char_length(s) > 1000 then raise exception 'Keep what happened to 1000 characters at most.'; end if;
  if char_length(ru) > 200 then raise exception 'Keep the rule to 200 characters at most.'; end if;
  if p_decided is null then raise exception 'Pick the date of the decision.'; end if;
  if p_decided > today then raise exception 'The decision can’t be in the future.'; end if;
  if p_kind = 'suspension' and (susp is null or susp <= p_decided) then raise exception 'Pick when the suspension ends.'; end if;
  if today >= private.conduct_delete_on(p_decided, susp, null) then
    raise exception 'That decision is more than 12 months old, so it isn’t kept.';
  end if;
  if not private.conduct_formal(p_kind) then
    if p_notice is null then raise exception 'Pick when written notice was given.'; end if;
    if p_notice < p_decided then raise exception 'Written notice can’t come before the decision.'; end if;
    if p_notice > today then raise exception 'Written notice can’t be in the future.'; end if;
  end if;
  insert into public.conduct_records (member_id, chapter_id, kind, summary, rule, decided_on, notice_on, suspended_until, recorded_by)
  values (m.id, m.chapter_id, p_kind, s, nullif(ru, ''), p_decided,
          case when private.conduct_formal(p_kind) then p_decided else p_notice end, susp, me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Keeps a record through p_until for an active matter (6.9); null lets go of the hold.
create or replace function public.hold_conduct(p_record uuid, p_until date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare why text := private.trim_like_app(coalesce(p_reason, '')); r public.conduct_records;
begin
  perform private.require_member();
  perform private.purge_conduct();
  r := private.conduct_board_record(p_record);
  if p_until is null then
    update public.conduct_records set hold_until = null, hold_reason = null where id = r.id;
    return;
  end if;
  if why = '' then raise exception 'Say which matter needs it kept.'; end if;
  if char_length(why) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
  if p_until <= private.club_date() then raise exception 'Pick a date after today.'; end if;
  if p_until > (private.club_date() + interval '84 months')::date then raise exception 'Hold it at most 7 years.'; end if;
  update public.conduct_records set hold_until = p_until, hold_reason = why where id = r.id;
end;
$$;

-- Takes away a record made by mistake.
create or replace function public.remove_conduct(p_record uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.conduct_records;
begin
  perform private.require_member();
  perform private.purge_conduct();
  r := private.conduct_board_record(p_record);
  delete from public.conduct_records where id = r.id;
end;
$$;

create or replace function public.lodge_conduct_appeal(p_record uuid, p_grounds text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  why text := private.trim_like_app(coalesce(p_grounds, ''));
  r public.conduct_records;
  due date;
begin
  perform private.purge_conduct();
  r := private.conduct_record(p_record);
  if me <> r.member_id and not private.is_board_of(private.conduct_chapter(r)) then
    raise exception 'Only the member or their board can lodge this.';
  end if;
  if exists (select 1 from public.conduct_appeals where record_id = r.id) then
    raise exception 'A review or appeal has already been lodged.';
  end if;
  if why = '' then raise exception 'Say why.'; end if;
  if char_length(why) > 1000 then raise exception 'Keep it to 1000 characters at most.'; end if;
  due := case when private.conduct_formal(r.kind) then r.decided_on + 7 else r.notice_on + 14 end;
  if private.club_date() > due then raise exception 'The window closed on %.', to_char(due, 'DD/MM/YYYY'); end if;
  insert into public.conduct_appeals (record_id, lodged_on, lodged_by, grounds) values (r.id, private.club_date(), me, why);
end;
$$;

create or replace function public.set_conduct_hearing(p_record uuid, p_panel uuid[], p_hearing date)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); a public.conduct_appeals; r public.conduct_records;
begin
  perform private.purge_conduct();
  a := private.conduct_open_appeal(p_record);
  select * into r from public.conduct_records where id = a.record_id;
  if not private.is_board_of(private.conduct_chapter(r)) or me = r.member_id or me = r.recorded_by then
    raise exception 'Only the board or NEC, apart from whoever recorded it, can set up the hearing.';
  end if;
  if coalesce(cardinality(p_panel), 0) <> 3 or (select count(distinct x) from unnest(p_panel) x) <> 3 then
    raise exception 'Pick three different people.';
  end if;
  if (select count(*) from public.members where id = any (p_panel) and approval = 'approved' and status <> 'legacy') <> 3 then
    raise exception 'Pick approved members for the panel.';
  end if;
  if r.member_id = any (p_panel) or (r.recorded_by is not null and r.recorded_by = any (p_panel)) then
    raise exception 'The panel can’t include the member or whoever recorded it.';
  end if;
  if p_hearing is null or p_hearing < a.lodged_on then raise exception 'Pick the hearing date.'; end if;
  update public.conduct_appeals set panel = p_panel, hearing_on = p_hearing where record_id = r.id;
end;
$$;

-- Set aside (or revoked) deletes the record straight away (6.9).
create or replace function public.decide_conduct_appeal(p_record uuid, p_outcome text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); a public.conduct_appeals; r public.conduct_records;
  n text := private.trim_like_app(coalesce(p_note, ''));
begin
  perform private.purge_conduct();
  a := private.conduct_open_appeal(p_record);
  select * into r from public.conduct_records where id = a.record_id;
  if not (me = any (a.panel)) or a.hearing_on is null then raise exception 'Only the hearing panel can record the outcome.'; end if;
  if private.club_date() < a.hearing_on then raise exception 'Wait until the hearing.'; end if;
  if p_outcome is null or p_outcome not in ('confirmed', 'varied', 'set_aside') then raise exception 'Pick an outcome.'; end if;
  if p_outcome = 'varied' and private.conduct_formal(r.kind) then raise exception 'A formal appeal is upheld or revoked (14.6).'; end if;
  if p_outcome = 'varied' and n = '' then raise exception 'Say how it was varied.'; end if;
  if char_length(n) > 1000 then raise exception 'Keep it to 1000 characters at most.'; end if;
  if p_outcome = 'set_aside' then
    delete from public.conduct_records where id = r.id;
    return;
  end if;
  update public.conduct_appeals set outcome = p_outcome, outcome_note = nullif(n, ''), decided_on = private.club_date(), decided_by = me
  where record_id = r.id;
end;
$$;

create or replace function public.withdraw_conduct_appeal(p_record uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); a public.conduct_appeals; r public.conduct_records;
begin
  perform private.purge_conduct();
  a := private.conduct_open_appeal(p_record);
  select * into r from public.conduct_records where id = a.record_id;
  if r.member_id <> me then raise exception 'Only the member can withdraw it.'; end if;
  update public.conduct_appeals set withdrawn_on = private.club_date() where record_id = r.id;
end;
$$;

-- Merch actions --------------------------------------------------------------------------------

create or replace function public.propose_merch(
  p_chapter uuid, p_name text, p_details text, p_sizes text[], p_price_cents int, p_patched_only boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  n text := private.trim_like_app(coalesce(p_name, ''));
  d text := private.trim_like_app(coalesce(p_details, ''));
  sz text[] := array(select private.trim_like_app(x) from unnest(coalesce(p_sizes, '{}')) with ordinality as t(x, i) order by i);
  new_id uuid;
begin
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  perform private.require_scope(p_chapter);
  if n = '' then raise exception 'Name it.'; end if;
  if char_length(n) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if char_length(d) > 500 then raise exception 'Keep the details to 500 characters at most.'; end if;
  if cardinality(sz) > 12 or (select count(distinct x) from unnest(sz) x) <> cardinality(sz)
     or exists (select 1 from unnest(sz) x where x is null or x = '' or char_length(x) > 10) then
    raise exception 'Keep sizes to 10 characters, no repeats, 12 at most.';
  end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000 then
    raise exception 'Enter a price from $0.01 to $1,000.';
  end if;
  insert into public.merch_items (chapter_id, name, details, sizes, price_cents, patched_only, proposed_by)
  values (p_chapter, n, nullif(d, ''), sz, p_price_cents, coalesce(p_patched_only, false), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Found, and run by this person.
create or replace function private.merch_item_run(p_item uuid)
returns public.merch_items language plpgsql security definer set search_path = '' as $$
declare i public.merch_items;
begin
  select * into i from public.merch_items where id = p_item for update;
  if not found or not private.sees_merch_item(i) then raise exception 'No such item.'; end if;
  perform private.require_scope(i.chapter_id);
  return i;
end;
$$;

-- A yes puts it on sale; someone other than whoever put it up gives it (inferred, 15.1).
create or replace function public.decide_merch(p_item uuid, p_yes boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); i public.merch_items := private.merch_item_run(p_item);
  why text := private.trim_like_app(coalesce(p_reason, ''));
begin
  if i.status <> 'proposed' then raise exception 'That item has already been decided.'; end if;
  if p_yes and i.proposed_by = me then raise exception 'Someone other than whoever put it up approves it (15.1).'; end if;
  if not p_yes and char_length(why) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
  update public.merch_items set status = case when p_yes then 'on_sale' else 'declined' end, decided_by = me, decided_at = now(),
    decline_reason = case when p_yes then null else nullif(why, '') end
  where id = i.id;
end;
$$;

create or replace function public.close_merch(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.merch_items;
begin
  perform private.require_member();
  i := private.merch_item_run(p_item);
  if i.status <> 'on_sale' then raise exception 'Only an item on sale can be closed.'; end if;
  update public.merch_items set status = 'closed' where id = i.id;
end;
$$;

create or replace function public.order_merch(p_item uuid, p_size text, p_qty int, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); i public.merch_items; my_status text;
  n text := private.trim_like_app(coalesce(p_note, '')); new_id uuid;
begin
  select status::text into my_status from public.members where id = me;
  if my_status = 'legacy' then raise exception 'Legacy members can’t order merch.'; end if;
  select * into i from public.merch_items where id = p_item;
  if not found or not private.sees_merch_item(i) or i.status <> 'on_sale' then raise exception 'That item isn’t on sale.'; end if;
  if i.patched_only and my_status not in ('full', 'nomad') then raise exception 'That item is for Full and Nomad members only.'; end if;
  if cardinality(i.sizes) > 0 and (p_size is null or not (p_size = any (i.sizes))) then raise exception 'Pick a size.'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'Order 1 to 10.'; end if;
  if char_length(n) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;
  insert into public.merch_orders (item_id, member_id, size, qty, unit_cents, note)
  values (i.id, me, case when cardinality(i.sizes) > 0 then p_size end, p_qty, i.price_cents, nullif(n, ''))
  returning id into new_id;
  return new_id;
end;
$$;

-- A visible order, locked, with its item's fund.
create or replace function private.merch_order(p_order uuid, out o public.merch_orders, out chapter uuid)
language plpgsql security definer set search_path = '' as $$
begin
  select * into o from public.merch_orders where id = p_order for update;
  if not found or not private.sees_merch_order(o) then raise exception 'No such order.'; end if;
  select chapter_id into chapter from public.merch_items where id = o.item_id;
end;
$$;

create or replace function public.decide_merch_order(p_order uuid, p_yes boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); f record;
  why text := private.trim_like_app(coalesce(p_reason, ''));
begin
  select * into f from private.merch_order(p_order);
  perform private.require_scope(f.chapter);
  if (f.o).status <> 'waiting' then raise exception 'That order has already been decided.'; end if;
  if (f.o).member_id = me then raise exception 'Someone else approves your own order.'; end if;
  if not p_yes and char_length(why) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
  update public.merch_orders set status = case when p_yes then 'approved' else 'declined' end, decided_by = me, decided_at = now(),
    decline_reason = case when p_yes then null else nullif(why, '') end
  where id = (f.o).id;
end;
$$;

-- The money in: a CR-005 line in the item's fund, banked that day (13.1). Returns the line's id.
create or replace function public.pay_merch_order(p_order uuid, p_paid_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); f record; i public.merch_items; who text; new_id uuid;
begin
  select * into f from private.merch_order(p_order);
  if not private.keeps_books(f.chapter) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if (f.o).status in ('paid', 'handed_over') then raise exception 'That order is already paid.'; end if;
  if (f.o).status <> 'approved' then raise exception 'Approve the order first.'; end if;
  if (f.o).member_id = me then raise exception 'Someone else records your own payment.'; end if;
  if p_paid_on is null or p_paid_on > private.club_date() or p_paid_on < private.club_date((f.o).ordered_at) then
    raise exception 'Pick the day it was paid.';
  end if;
  select * into i from public.merch_items where id = (f.o).item_id;
  select coalesce(road_name, full_name) into who from public.members where id = (f.o).member_id;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, state, recorded_by)
  values (f.chapter, 'CR-005',
          'Merch: ' || i.name || coalesce(' (' || (f.o).size || ')', '') || ' ×' || (f.o).qty || ' for ' || coalesce(who, 'Member'),
          (f.o).unit_cents * (f.o).qty, p_paid_on, p_paid_on, 'paid', me)
  returning id into new_id;
  update public.merch_orders set status = 'paid', paid_on = p_paid_on, ledger_entry_id = new_id where id = (f.o).id;
  return new_id;
end;
$$;

create or replace function public.hand_over_merch_order(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  perform private.require_member();
  select * into f from private.merch_order(p_order);
  perform private.require_scope(f.chapter);
  if (f.o).status <> 'paid' then raise exception 'Mark it paid first.'; end if;
  update public.merch_orders set status = 'handed_over', handed_over_on = private.club_date() where id = (f.o).id;
end;
$$;

create or replace function public.cancel_merch_order(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); f record;
begin
  select * into f from private.merch_order(p_order);
  if (f.o).member_id <> me and not private.runs_scope(f.chapter) then
    raise exception 'Only whoever ordered it or the board can cancel it.';
  end if;
  if (f.o).status not in ('waiting', 'approved') then raise exception 'That order can’t be cancelled now.'; end if;
  update public.merch_orders set status = 'cancelled', decided_by = coalesce(decided_by, me), decided_at = coalesce(decided_at, now())
  where id = (f.o).id;
end;
$$;

-- National contributions (13.6) ----------------------------------------------------------------

create or replace function public.propose_contribution(p_title text, p_purpose text, p_total_cents int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member();
  t text := private.trim_like_app(coalesce(p_title, '')); p text := private.trim_like_app(coalesce(p_purpose, ''));
  sh jsonb; new_id uuid;
begin
  if not private.is_national() then raise exception 'Only the NEC can propose a national contribution (13.6).'; end if;
  if t = '' then raise exception 'Give it a title.'; end if;
  if char_length(t) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
  if p = '' then raise exception 'Say what it’s for.'; end if;
  if char_length(p) > 1000 then raise exception 'Keep it to 1000 characters at most.'; end if;
  if p_total_cents is null or p_total_cents < 100 or p_total_cents > 10000000 then
    raise exception 'Enter a total from $1 to $100,000.';
  end if;
  sh := private.contribution_shares(p_total_cents);
  if not exists (select 1 from jsonb_array_elements(sh) e where (e->>'voting_members')::int > 0) then
    raise exception 'There are no Voting Members to share it between.';
  end if;
  insert into public.national_contributions (title, purpose, total_cents, proposed_by, shares)
  values (t, p, p_total_cents, me, sh) returning id into new_id;
  return new_id;
end;
$$;

create or replace function private.open_contribution(p_id uuid)
returns public.national_contributions language plpgsql security definer set search_path = '' as $$
declare k public.national_contributions;
begin
  select * into k from public.national_contributions where id = p_id for update;
  if not found then raise exception 'No such contribution.'; end if;
  if k.status <> 'proposed' then raise exception 'That contribution is settled.'; end if;
  return k;
end;
$$;

-- A chapter board's decision, by its own closed board vote on it ("each decision minuted").
-- Most of the chapters saying yes approves it; once that can't happen it's not approved.
create or replace function public.decide_contribution(p_id uuid, p_chapter uuid, p_vote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); k public.national_contributions := private.open_contribution(p_id);
  v public.votes; n int; yes_n int; no_n int;
begin
  if not exists (select 1 from jsonb_array_elements(k.shares) e where e->>'chapter_id' = p_chapter::text)
     or not private.holds_board_seat(p_chapter) then
    raise exception 'Only that chapter’s board can record its decision.';
  end if;
  if exists (select 1 from public.contribution_decisions where contribution_id = k.id and chapter_id = p_chapter) then
    raise exception 'That chapter has already decided.';
  end if;
  select * into v from public.votes where id = p_vote and chapter_id = p_chapter and electorate = 'chapter_board'
    and closed_at is not null and opened_at > k.proposed_at and not private.vote_used(id);
  if not found then raise exception 'Pick that chapter board’s closed vote on it (13.6).'; end if;
  insert into public.contribution_decisions (contribution_id, chapter_id, yes, vote_id, recorded_by)
  values (k.id, p_chapter, v.result = 'carried', v.id, me);
  n := jsonb_array_length(k.shares);
  select count(*) filter (where yes), count(*) filter (where not yes) into yes_n, no_n
  from public.contribution_decisions where contribution_id = k.id;
  if yes_n * 2 > n then
    update public.national_contributions set status = 'approved', settled_at = now() where id = k.id;
  elsif no_n * 2 >= n then
    update public.national_contributions set status = 'not_approved', settled_at = now() where id = k.id;
  end if;
end;
$$;

create or replace function public.withdraw_contribution(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.national_contributions;
begin
  perform private.require_member();
  k := private.open_contribution(p_id);
  if not private.is_national() then raise exception 'Only the NEC can withdraw it.'; end if;
  update public.national_contributions set status = 'withdrawn', settled_at = now() where id = k.id;
end;
$$;

-- New chapters (12.1) --------------------------------------------------------------------------

create or replace function public.propose_chapter(
  p_name text, p_area text, p_state text, p_location text, p_membership text, p_leadership text, p_budget text,
  p_operations text, p_founders uuid[], p_president uuid, p_saa uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  n text := private.trim_like_app(coalesce(p_name, ''));
  a text := private.trim_like_app(coalesce(p_area, ''));
  f uuid[] := coalesce(p_founders, '{}');
  parts text[] := array[p_location, p_membership, p_leadership, p_budget, p_operations];
  labels text[] := array['location', 'membership', 'leadership', 'budget', 'operations'];
  part text;
  problem text;
  new_id uuid;
begin
  if not private.is_national() and not (me = any (f)) then
    raise exception 'Only the NEC or one of the founders can put it forward.';
  end if;
  if n = '' or private.slug_of(n) = '' then raise exception 'Name the chapter.'; end if;
  if char_length(n) > 40 then raise exception 'Keep the name to 40 characters at most.'; end if;
  if private.chapter_name_taken(n, null) then raise exception 'There’s already a chapter called that.'; end if;
  if a = '' then raise exception 'Say where it’s based.'; end if;
  if char_length(a) > 80 then raise exception 'Keep the area to 80 characters at most.'; end if;
  if p_state is null or p_state not in ('VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT') then raise exception 'Pick a state.'; end if;
  for i in 1 .. 5 loop
    part := private.trim_like_app(coalesce(parts[i], ''));
    if part = '' then raise exception 'Cover the % in the proposal (12.1).', labels[i]; end if;
    if char_length(part) > 2000 then raise exception 'Keep each part to 2000 characters at most.'; end if;
  end loop;
  problem := private.founders_problem(f, p_president, p_saa);
  if problem is not null then raise exception '%', problem; end if;
  insert into public.chapter_proposals (name, area, state, plan, founder_ids, president_id, saa_id, proposed_by)
  values (n, a, p_state, jsonb_build_object(
            'location', private.trim_like_app(p_location), 'membership', private.trim_like_app(p_membership),
            'leadership', private.trim_like_app(p_leadership), 'budget', private.trim_like_app(p_budget),
            'operations', private.trim_like_app(p_operations)),
          f, p_president, p_saa, me)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function private.open_chapter_proposal(p_id uuid)
returns public.chapter_proposals language plpgsql security definer set search_path = '' as $$
declare p public.chapter_proposals;
begin
  select * into p from public.chapter_proposals where id = p_id for update;
  if not found then raise exception 'No such proposal.'; end if;
  if p.status <> 'proposed' then raise exception 'That proposal is settled.'; end if;
  return p;
end;
$$;

-- Settles a proposal by the NEC's closed vote on it. Carried: the chapter is made (its chats make
-- themselves), the founders move to it (12.4) and the President and SAA take their seats today.
-- Returns the new chapter's id, or null when the vote didn't carry.
create or replace function public.settle_chapter_proposal(p_id uuid, p_vote uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); p public.chapter_proposals := private.open_chapter_proposal(p_id);
  v public.votes; problem text; new_id uuid;
begin
  if not private.is_national() then raise exception 'Only the NEC can approve a new chapter (12.1).'; end if;
  select * into v from public.votes where id = p_vote and chapter_id is null and electorate = 'nec'
    and closed_at is not null and opened_at > p.proposed_at and not private.vote_used(id);
  if not found then raise exception 'Pick the NEC’s closed vote on it (12.1).'; end if;
  if v.result is distinct from 'carried' then
    update public.chapter_proposals set status = 'not_approved', vote_id = v.id, decided_by = me, decided_at = now() where id = p.id;
    return null;
  end if;
  if private.chapter_name_taken(p.name, p.id) then raise exception 'There’s already a chapter called that.'; end if;
  problem := private.founders_problem(p.founder_ids, p.president_id, p.saa_id);
  if problem is not null then raise exception '%', problem; end if;
  if exists (select 1 from public.positions where member_id = any (p.founder_ids) and ended_on is null
             and chapter_id is not null and role <> 'founder') then
    raise exception 'Founders have to end their positions in their old chapter first.';
  end if;
  insert into public.chapters (slug, name, area, state) values (private.slug_of(p.name), p.name, p.area, p.state)
  returning id into new_id;
  update public.members set chapter_id = new_id where id = any (p.founder_ids);
  insert into public.positions (member_id, chapter_id, role, started_on) values
    (p.president_id, new_id, 'president', private.club_date()),
    (p.saa_id, new_id, 'sergeant_at_arms', private.club_date());
  update public.chapter_proposals set status = 'approved', vote_id = v.id, decided_by = me, decided_at = now(), chapter_id = new_id
  where id = p.id;
  return new_id;
end;
$$;

create or replace function public.withdraw_chapter_proposal(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); p public.chapter_proposals := private.open_chapter_proposal(p_id);
begin
  if not private.is_national() and p.proposed_by is distinct from me then
    raise exception 'Only the NEC or whoever put it forward can withdraw it.';
  end if;
  update public.chapter_proposals set status = 'withdrawn', decided_by = me, decided_at = now() where id = p.id;
end;
$$;

revoke all on function private.merch_item_run(uuid), private.merch_order(uuid), private.open_contribution(uuid),
  private.open_chapter_proposal(uuid)
  from public, anon, authenticated;

-- Reading --------------------------------------------------------------------------------------

-- Everything this person may see. Conduct records past their day are never returned, even
-- before the daily purge has run.
create or replace function public.club_admin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_approved_member() then
    return jsonb_build_object('conduct', '[]'::jsonb, 'merch_items', '[]'::jsonb, 'merch_orders', '[]'::jsonb,
      'contributions', '[]'::jsonb, 'chapter_proposals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'conduct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'member_id', r.member_id, 'chapter_id', r.chapter_id, 'kind', r.kind, 'summary', r.summary, 'rule', r.rule,
        'decided_on', r.decided_on, 'notice_on', r.notice_on, 'suspended_until', r.suspended_until, 'recorded_by', r.recorded_by,
        'recorded_at', r.recorded_at, 'hold_until', r.hold_until, 'hold_reason', r.hold_reason,
        'appeal', (select jsonb_build_object(
            'lodged_on', a.lodged_on, 'lodged_by', a.lodged_by, 'grounds', a.grounds, 'panel', to_jsonb(a.panel),
            'hearing_on', a.hearing_on, 'outcome', a.outcome, 'outcome_note', a.outcome_note, 'decided_on', a.decided_on,
            'decided_by', a.decided_by, 'withdrawn_on', a.withdrawn_on)
          from public.conduct_appeals a where a.record_id = r.id)
        ) order by r.decided_on desc, r.recorded_at desc)
      from public.conduct_records r where private.conduct_kept(r) and private.sees_conduct(r)), '[]'::jsonb),
    'merch_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'chapter_id', i.chapter_id, 'name', i.name, 'details', i.details, 'sizes', to_jsonb(i.sizes),
        'price_cents', i.price_cents, 'patched_only', i.patched_only, 'status', i.status, 'proposed_by', i.proposed_by,
        'proposed_at', i.proposed_at, 'decided_by', i.decided_by, 'decided_at', i.decided_at, 'decline_reason', i.decline_reason
        ) order by i.proposed_at desc)
      from public.merch_items i where private.sees_merch_item(i)), '[]'::jsonb),
    'merch_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'item_id', o.item_id, 'member_id', o.member_id, 'size', o.size, 'qty', o.qty, 'unit_cents', o.unit_cents,
        'note', o.note, 'status', o.status, 'ordered_at', o.ordered_at, 'decided_by', o.decided_by, 'decided_at', o.decided_at,
        'decline_reason', o.decline_reason, 'paid_on', o.paid_on, 'ledger_entry_id', o.ledger_entry_id, 'handed_over_on', o.handed_over_on
        ) order by o.ordered_at desc)
      from public.merch_orders o where private.sees_merch_order(o)), '[]'::jsonb),
    'contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'title', k.title, 'purpose', k.purpose, 'total_cents', k.total_cents, 'status', k.status,
        'proposed_by', k.proposed_by, 'proposed_at', k.proposed_at, 'settled_at', k.settled_at, 'shares', k.shares,
        'decisions', (select coalesce(jsonb_agg(jsonb_build_object('chapter_id', d.chapter_id, 'yes', d.yes, 'vote_id', d.vote_id,
                        'recorded_by', d.recorded_by, 'recorded_at', d.recorded_at) order by d.recorded_at), '[]'::jsonb)
                      from public.contribution_decisions d where d.contribution_id = k.id)
        ) order by k.proposed_at desc)
      from public.national_contributions k), '[]'::jsonb),
    'chapter_proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'area', p.area, 'state', p.state, 'plan', p.plan, 'founder_ids', to_jsonb(p.founder_ids),
        'president_id', p.president_id, 'saa_id', p.saa_id, 'status', p.status, 'proposed_by', p.proposed_by,
        'proposed_at', p.proposed_at, 'vote_id', p.vote_id, 'decided_by', p.decided_by, 'decided_at', p.decided_at,
        'chapter_id', p.chapter_id
        ) order by p.proposed_at desc)
      from public.chapter_proposals p), '[]'::jsonb));
end;
$$;

revoke all on function
  public.record_conduct(uuid, text, text, text, date, date, date), public.hold_conduct(uuid, date, text),
  public.remove_conduct(uuid), public.lodge_conduct_appeal(uuid, text), public.set_conduct_hearing(uuid, uuid[], date),
  public.decide_conduct_appeal(uuid, text, text), public.withdraw_conduct_appeal(uuid),
  public.propose_merch(uuid, text, text, text[], int, boolean), public.decide_merch(uuid, boolean, text), public.close_merch(uuid),
  public.order_merch(uuid, text, int, text), public.decide_merch_order(uuid, boolean, text), public.pay_merch_order(uuid, date),
  public.hand_over_merch_order(uuid), public.cancel_merch_order(uuid),
  public.propose_contribution(text, text, int), public.decide_contribution(uuid, uuid, uuid), public.withdraw_contribution(uuid),
  public.propose_chapter(text, text, text, text, text, text, text, text, uuid[], uuid, uuid),
  public.settle_chapter_proposal(uuid, uuid), public.withdraw_chapter_proposal(uuid), public.club_admin()
  from public, anon;
grant execute on function
  public.record_conduct(uuid, text, text, text, date, date, date), public.hold_conduct(uuid, date, text),
  public.remove_conduct(uuid), public.lodge_conduct_appeal(uuid, text), public.set_conduct_hearing(uuid, uuid[], date),
  public.decide_conduct_appeal(uuid, text, text), public.withdraw_conduct_appeal(uuid),
  public.propose_merch(uuid, text, text, text[], int, boolean), public.decide_merch(uuid, boolean, text), public.close_merch(uuid),
  public.order_merch(uuid, text, int, text), public.decide_merch_order(uuid, boolean, text), public.pay_merch_order(uuid, date),
  public.hand_over_merch_order(uuid), public.cancel_merch_order(uuid),
  public.propose_contribution(text, text, int), public.decide_contribution(uuid, uuid, uuid), public.withdraw_contribution(uuid),
  public.propose_chapter(text, text, text, text, text, text, text, text, uuid[], uuid, uuid),
  public.settle_chapter_proposal(uuid, uuid), public.withdraw_chapter_proposal(uuid), public.club_admin()
  to authenticated;

-- The daily purge, at about 2am in Melbourne. A plain Postgres (the local test database) has no
-- pg_cron, so there the actions' own purge is all there is.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-conduct-records', '0 15 * * *', 'select private.purge_conduct()');
  end if;
end $$;
