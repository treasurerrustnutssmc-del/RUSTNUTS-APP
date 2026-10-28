-- The Treasurer's Report for a meeting: any period inside one financial year, with the treasurer's
-- notes, laid out like Jeff's October 2026 report. Drafts are kept by whoever keeps the Club
-- fund's books; presented reports are locked and every approved member who hasn't left reads them
-- (13.8). The figures are worked out when read (private.meeting_report mirrors meetingFigures in
-- src/domain/meetingReport.ts), so a later correction shows. Needs the Stage 5B treasurer tables.

create table public.treasurer_meeting_reports (
  id uuid primary key default gen_random_uuid(),
  from_on date not null,
  to_on date not null,
  notes text not null default '' check (char_length(notes) <= 4000),
  saved_by uuid references public.members (id) on delete set null,
  saved_at timestamptz not null default now(),
  presented_by uuid references public.members (id) on delete set null,
  presented_at timestamptz,
  check (from_on <= to_on)
);

alter table public.treasurer_meeting_reports enable row level security;
revoke all on public.treasurer_meeting_reports from public, anon, authenticated;

-- Working it out --------------------------------------------------------------------------------

-- A fund's balance as p_from starts: on 1 July, the new year's opening when there is one.
create or replace function private.opening_on(p_chapter uuid, p_from date)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select amount_cents::bigint from public.fund_openings
     where extract(month from p_from) = 7 and extract(day from p_from) = 1
       and chapter_id is not distinct from p_chapter and fy = private.fy_of(p_from)),
    private.fund_balance(p_chapter, p_from - 1));
$$;

-- A meeting report's figures, as meetingFigures works them out.
create or replace function private.meeting_report(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with lines as (
    select e.chapter_id, e.code, e.amount_cents, e.entry_on, c.direction
    from public.ledger_entries e join public.ledger_codes c on c.code = e.code
    where e.state = 'paid' and e.entry_on between p_from and p_to
  ),
  f as (
    select null::uuid as id
    union all select id from public.chapters
  ),
  fm as (
    select coalesce(f.id::text, 'club') as k,
      private.opening_on(f.id, p_from) as opening,
      coalesce((select sum(amount_cents) from lines where chapter_id is not distinct from f.id and direction = 'credit'), 0) as receipts,
      coalesce((select sum(amount_cents) from lines where chapter_id is not distinct from f.id and direction = 'debit'), 0) as payments,
      private.fund_balance(f.id, p_to) as closing
    from f
  ),
  months as (
    select m::date as month, greatest(m::date, p_from) as a,
      least((m + interval '1 month' - interval '1 day')::date, p_to) as b
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'funds', (select jsonb_object_agg(k, jsonb_build_object(
        'opening_cents', opening, 'receipts_cents', receipts, 'payments_cents', payments, 'closing_cents', closing)) from fm),
    'credits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents',
        coalesce((select sum(amount_cents) from lines where code = c.code), 0)) order by c.code)
      from public.ledger_codes c where c.direction = 'credit'),
    'debits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents',
        coalesce((select sum(amount_cents) from lines where code = c.code), 0)) order by c.code)
      from public.ledger_codes c where c.direction = 'debit'),
    'receipts_cents', coalesce((select sum(amount_cents) from lines where direction = 'credit'), 0),
    'payments_cents', coalesce((select sum(amount_cents) from lines where direction = 'debit'), 0),
    'opening_cents', (select sum(opening) from fm),
    'closing_cents', (select sum(closing) from fm),
    'float_cents', coalesce((select amount_cents from public.cash_floats where fy <= private.fy_of(p_to) order by fy desc limit 1), 0),
    'months', (select jsonb_agg(jsonb_build_object('month', month, 'from', a, 'to', b,
        'receipts_cents', coalesce((select sum(amount_cents) from lines where direction = 'credit' and entry_on between a and b), 0),
        'payments_cents', coalesce((select sum(amount_cents) from lines where direction = 'debit' and entry_on between a and b), 0))
        order by month) from months),
    'line_count', (select count(*) from lines),
    'last_change_at', (select max(updated_at) from public.ledger_entries where entry_on between p_from and p_to));
$$;

revoke all on function private.opening_on(uuid, date), private.meeting_report(date, date) from public, anon, authenticated;

-- Actions ---------------------------------------------------------------------------------------

-- Saves a new report (p_id null) or changes a draft. Returns its id.
create or replace function public.save_meeting_report(p_id uuid, p_from date, p_to date, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_books(null);
  r public.treasurer_meeting_reports;
  new_id uuid;
begin
  if p_id is not null then
    select * into r from public.treasurer_meeting_reports where id = p_id for update;
    if not found then raise exception 'No such report.'; end if;
    if r.presented_at is not null then raise exception 'That report is presented and can’t be changed.'; end if;
  end if;
  if p_from is null or p_to is null then raise exception 'Pick the first and last day of the report.'; end if;
  if p_from > p_to then raise exception 'The report has to start before it ends.'; end if;
  if p_to > private.club_date() then raise exception 'The report can’t run past today.'; end if;
  if private.fy_of(p_from) <> private.fy_of(p_to) then
    raise exception 'Keep the report inside one financial year (1 July to 30 June).';
  end if;
  if char_length(coalesce(p_notes, '')) > 4000 then raise exception 'Keep the notes under 4,000 characters.'; end if;
  if p_id is null then
    insert into public.treasurer_meeting_reports (from_on, to_on, notes, saved_by)
    values (p_from, p_to, coalesce(p_notes, ''), me) returning id into new_id;
    return new_id;
  end if;
  update public.treasurer_meeting_reports
    set from_on = p_from, to_on = p_to, notes = coalesce(p_notes, ''), saved_by = me, saved_at = now()
    where id = p_id;
  return p_id;
end;
$$;

create or replace function public.present_meeting_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_books(null);
begin
  if not exists (select 1 from public.treasurer_meeting_reports where id = p_id) then raise exception 'No such report.'; end if;
  update public.treasurer_meeting_reports set presented_by = me, presented_at = now()
    where id = p_id and presented_at is null;
  if not found then raise exception 'That report is already presented.'; end if;
end;
$$;

create or replace function public.delete_meeting_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_books(null);
  if not exists (select 1 from public.treasurer_meeting_reports where id = p_id) then raise exception 'No such report.'; end if;
  delete from public.treasurer_meeting_reports where id = p_id and presented_at is null;
  if not found then raise exception 'That report is presented and can’t be changed.'; end if;
end;
$$;

-- Reading ---------------------------------------------------------------------------------------

-- Drafts to whoever keeps the Club fund's books; presented reports, with their figures and notes,
-- to every approved member who hasn't left (13.8). Never the lines: those stay in club_ledger().
create or replace function public.meeting_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  keeper boolean := private.keeps_books(null);
  reader boolean := exists (
    select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'legacy');
begin
  if not (keeper or reader) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'from_on', r.from_on, 'to_on', r.to_on, 'notes', r.notes, 'saved_by', r.saved_by, 'saved_at', r.saved_at,
      'presented_by', r.presented_by, 'presented_at', r.presented_at,
      'figures', private.meeting_report(r.from_on, r.to_on)) order by r.to_on desc, r.saved_at desc)
    from public.treasurer_meeting_reports r
    where r.presented_at is not null or keeper), '[]'::jsonb);
end;
$$;

revoke all on function public.save_meeting_report(uuid, date, date, text), public.present_meeting_report(uuid),
  public.delete_meeting_report(uuid), public.meeting_reports()
  from public, anon;
grant execute on function public.save_meeting_report(uuid, date, date, text), public.present_meeting_report(uuid),
  public.delete_meeting_report(uuid), public.meeting_reports()
  to authenticated;
