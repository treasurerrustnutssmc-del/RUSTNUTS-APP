-- Fees by club year: from the close of one Association AGM to the next (constitution v4,
-- definitions), with pro rata for Full members patched partway through a year (Jeff, 25 Oct 2026).
-- See docs/superpowers/specs/2026-10-25-club-year-fees-design.md. fee_rates.fy and charges.fy (and
-- receipt numbers) now mean the club year; the treasurer's books keep private.fy_of. The same
-- rules are in src/domain/clubYear.ts.

create table public.agms (
  year int primary key,
  held_on date not null check (extract(year from held_on)::int = year),
  recorded_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default now()
);
alter table public.agms enable row level security;
revoke all on public.agms from public, anon, authenticated;
grant select on public.agms to authenticated;
create policy agms_read on public.agms for select to authenticated using (private.is_approved_member());

-- The AGM in that calendar year: as recorded, or else 1 August (it's meant to be in August, 10.3).
create or replace function private.agm_on(p_year int)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce((select held_on from public.agms where year = p_year), make_date(p_year, 8, 1));
$$;

-- The club year a date falls in, by the year its AGM is in (2026 = AGM 2026 to AGM 2027).
create or replace function private.club_year_of(d date)
returns int language sql stable security definer set search_path = '' as $$
  select case when d >= private.agm_on(extract(year from d)::int) then extract(year from d)::int
              else extract(year from d)::int - 1 end;
$$;

-- Whole months left in that club year for someone patched on that date, counting the month they
-- were patched, up to the next AGM's month. 12 (the full year) when patched on or before the AGM
-- or in its month; 0 when patched after the year ended.
create or replace function private.pro_rata_months(p_patched date, p_year int)
returns int language sql stable security definer set search_path = '' as $$
  select case when p_patched is null or p_patched <= private.agm_on(p_year)
                   or date_trunc('month', p_patched) = date_trunc('month', private.agm_on(p_year)) then 12
              when p_patched >= private.agm_on(p_year + 1) then 0
              else least(12, greatest(1,
                (extract(year from private.agm_on(p_year + 1))::int * 12 + extract(month from private.agm_on(p_year + 1))::int)
                - (extract(year from p_patched)::int * 12 + extract(month from p_patched)::int)))
         end;
$$;

-- That many months of a year's fee, to the nearest dollar.
create or replace function private.pro_rata_cents(p_amount int, p_months int)
returns int language sql immutable set search_path = '' as $$
  select case when p_months >= 12 then p_amount else (round(p_amount::numeric * p_months / 12 / 100) * 100)::int end;
$$;

create or replace function private.pro_rata_note(p_months int)
returns text language sql immutable set search_path = '' as $$
  select case when p_months < 12 then format('Pro rata, %s of 12 months', p_months) end;
$$;

revoke all on function private.agm_on(int), private.club_year_of(date), private.pro_rata_months(date, int),
  private.pro_rata_cents(int, int), private.pro_rata_note(int) from public, anon;
grant execute on function private.agm_on(int), private.club_year_of(date), private.pro_rata_months(date, int),
  private.pro_rata_cents(int, int), private.pro_rata_note(int) to authenticated;

-- Records (or corrects) the date of a year's AGM.
create or replace function public.record_agm(p_held_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role in ('nec_chair', 'nec_secretary')
  )) then
    raise exception 'Only the National Chairman or Secretary records the AGM.';
  end if;
  if p_held_on is null then raise exception 'Pick the AGM date.'; end if;
  if extract(month from p_held_on) < 7 then raise exception 'The AGM is held between July and December.'; end if;
  insert into public.agms (year, held_on, recorded_by) values (extract(year from p_held_on)::int, p_held_on, auth.uid())
  on conflict (year) do update set held_on = excluded.held_on, recorded_by = excluded.recorded_by, recorded_at = now();
end;
$$;
revoke all on function public.record_agm(date) from public, anon;
grant execute on function public.record_agm(date) to authenticated;

create or replace function public.raise_fees(p_chapter uuid, p_fy int)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if not exists (select 1 from public.fee_rates where chapter_id = p_chapter and fy = p_fy) then
    raise exception 'Set this year’s fees first.';
  end if;
  -- A Full member patched after this year's AGM pays for the months left (Jeff, 25 Oct 2026).
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  select m.id, p_chapter, p_fy, 'annual', private.pro_rata_note(pr.months), private.pro_rata_cents(r.amount_cents, pr.months),
         r.due_on, auth.uid()
  from public.members m
  join public.fee_rates r on r.chapter_id = m.chapter_id and r.fy = p_fy and r.status = m.status
  cross join lateral (select case when m.status = 'full' then private.pro_rata_months(m.patched_on, p_fy) else 12 end as months) pr
  where m.chapter_id = p_chapter and m.approval = 'approved' and not m.on_hiatus
    and pr.months > 0 -- patched after that year ended
  on conflict (member_id, fy, kind) where kind in ('annual', 'continuation') do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.raise_charge(p_member uuid, p_description text, p_amount_cents int, p_due_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  new_id uuid;
begin
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.can_manage_fees(target.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Add what it’s for.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_due_on is null then raise exception 'Pick a due date.'; end if;
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  values (p_member, target.chapter_id, private.club_year_of(private.club_date()), 'other', trim(p_description), p_amount_cents, p_due_on, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.record_fng_review(
  p_member uuid, p_at_months int, p_outcome text, p_for int, p_against int, p_abstained int, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  due record;
  today date := private.club_date();
  full_fee int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_member = me then raise exception 'You can’t record your own review.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can record this review.'; end if;
  select * into due from private.fng_due(p_member);
  if due.at_months is null then raise exception 'They’re not an FNG.'; end if;
  if p_at_months is distinct from due.at_months then raise exception 'Record the review that’s due.'; end if;
  if due.due_on - today > 30 then raise exception 'That review isn’t due yet.'; end if;
  perform private.check_votes(p_for, p_against, p_abstained);
  if p_outcome not in ('continue', 'patch', 'not_continuing') then raise exception 'Pick an outcome.'; end if;
  -- Patching in is the chapter's Full Members' call, by a patch vote, not the board's tally (4.9).
  if p_outcome = 'patch' then
    if target.fng_started_on is not null and target.fng_started_on + interval '9 months' > today then
      raise exception 'Full Membership can’t be granted before nine months (4.7).';
    end if;
    if not private.has_carried_patch_vote(p_member) then
      raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
    end if;
  end if;

  insert into public.member_decisions (member_id, kind, at_months, outcome, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'fng_review', p_at_months, p_outcome, p_for, p_against, p_abstained, nullif(trim(p_note), ''),
          today, me);

  if p_outcome = 'patch' then
    update public.members set status = 'full', patched_on = coalesce(patched_on, today), updated_at = now() where id = p_member;
  elsif p_outcome = 'not_continuing' then
    update public.members set status = 'supporter', updated_at = now() where id = p_member;
  elsif p_at_months >= 12 and not target.on_hiatus then
    -- Past twelve months, carrying on as an FNG costs half the chapter's Full fee for the club year
    -- (Jeff, 25 Oct 2026: "half the full member fee"),
    -- once ever (4.11). Members on hiatus don't pay.
    select amount_cents into full_fee from public.fee_rates
    where chapter_id = target.chapter_id and fy = private.club_year_of(today) and status = 'full';
    if full_fee / 2 > 0 and not exists (
      select 1 from public.charges where member_id = p_member and kind = 'continuation'
    ) then
      insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
      values (p_member, target.chapter_id, private.club_year_of(today), 'continuation', 'FNG continuation fee', full_fee / 2,
              today + 30, me);
    end if;
  end if;
end;
$$;

create or replace function public.members_money()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'chapter_id', s.chapter_id, 'ride_id', s.ride_id,
                                          'title', s.title, 'held_on', s.held_on, 'opened_by', s.opened_by,
                                          'closed_at', s.closed_at) order by s.held_on desc, s.id)
      from public.checkin_sessions s), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(to_jsonb(a) order by a.checked_in_at) from public.attendance a), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) order by d.decided_on, d.created_at) from public.member_decisions d), '[]'::jsonb),
    'agms', coalesce((select jsonb_agg(jsonb_build_object('year', g.year, 'held_on', g.held_on) order by g.year) from public.agms g), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(to_jsonb(r)) from public.fee_rates r), '[]'::jsonb),
    'continuation', coalesce((select jsonb_agg(to_jsonb(f)) from public.continuation_fees f), '[]'::jsonb),
    'charges', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.charges c), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p), '[]'::jsonb),
    'details', coalesce((select jsonb_agg(to_jsonb(x)) from public.payment_details x), '[]'::jsonb)
  );
$$;

create or replace function public.set_continuation_fee(p_chapter uuid, p_fy int, p_amount_cents int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_set_fees(p_chapter) then
    raise exception 'Only that chapter’s board sets its fees.';
  end if;
  raise exception 'The continuation fee is half the Full fee (4.11), so the app works it out.';
end;
$$;

-- Someone becoming Full (from anything but Nomad) is charged that club year's Full fee, pro rata,
-- if it's set and they have no fee for the year yet. One trigger, so every way in is covered
-- (an FNG review, a status change, an NEC reinstatement). Members on hiatus don't pay.
create or replace function private.patch_in_fee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := private.club_date();
  yr int := private.club_year_of(today);
  r public.fee_rates%rowtype;
  months int;
begin
  if old.status in ('full', 'nomad') or new.approval <> 'approved' or new.on_hiatus then return new; end if;
  select * into r from public.fee_rates where chapter_id = new.chapter_id and fy = yr and status = 'full';
  if not found then return new; end if;
  -- From today: a reinstated member keeps their old patched_on.
  months := private.pro_rata_months(today, yr);
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  values (new.id, new.chapter_id, yr, 'annual', private.pro_rata_note(months), private.pro_rata_cents(r.amount_cents, months),
          greatest(r.due_on, today + 30), auth.uid())
  on conflict (member_id, fy, kind) where kind in ('annual', 'continuation') do nothing;
  return new;
end;
$$;
revoke all on function private.patch_in_fee() from public, anon, authenticated;

create trigger members_patch_in_fee after update of status on public.members
  for each row when (new.status = 'full' and old.status is distinct from new.status)
  execute function private.patch_in_fee();
