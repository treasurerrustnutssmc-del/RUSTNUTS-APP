-- Member privacy on the club's finances (Jeff, 24 Nov 2026: "no personal or road names on any
-- transactions"). What members read of the books already had full and road names taken out; this
-- also takes out each part of a full name (a first name or a surname on its own) and a road name
-- however it's spaced ("Bam Bam", "BamBam", "bam-bam"), and hides names in the treasurer's notes on a
-- presented meeting report for everyone but the books keepers. Mirrors hideMemberNames in
-- src/domain/clubSpending.ts. Safe to run twice.

-- One pattern for every member's full name, each part of it and road name (3+ characters), longest
-- first; spaces in a name also match no space, a dot, a hyphen or an underscore. Null when there are none.
create or replace function private.member_name_pattern()
returns text language sql stable security definer set search_path = '' as $$
  select '(?<![[:alnum:]_])(' || string_agg(
           array_to_string(array(
             select regexp_replace(w, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
             from regexp_split_to_table(y.name, '[[:space:]._-]+') w), '[[:space:]._-]*'),
           '|' order by char_length(y.name) desc, y.name) || ')(?![[:alnum:]_])'
  from (
    select distinct x.name from (
      select trim(full_name) as name from public.members
      union select trim(road_name) from public.members where road_name is not null
      union select part from public.members m, regexp_split_to_table(trim(m.full_name), '[[:space:]._-]+') part
    ) x where char_length(x.name) >= 3
  ) y;
$$;

-- Any member's name (whole words, any case) becomes "a member". The club's own words are set aside
-- first and put back (a road name of Rusty doesn't touch the Rusty Bus), and two parts of one name
-- side by side ("Christopher Andrew D") become one "a member".
create or replace function private.hide_member_names(p_text text, p_pattern text default private.member_name_pattern())
returns text language sql immutable set search_path = '' as $$
  select case when p_pattern is null then coalesce(p_text, '')
    else replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_text, ''), '(?<![[:alnum:]_])rusty[[:space:]._-]*bus(?![[:alnum:]_])', chr(1), 'gi'),
          p_pattern, 'a member', 'gi'),
        'a member([[:space:]]+a member)+(?![[:alnum:]_])', 'a member', 'g'),
      chr(1), 'Rusty Bus') end;
$$;

-- A typed payee as someone without names reads it: unchanged when no name is in it, "A member" when
-- it's only a name, else with the name taken out ("Shell Ringwood" stays a business). Mirrors payeeShown.
create or replace function private.payee_shown(p_name text, p_pattern text)
returns text language sql immutable set search_path = '' as $$
  select case
    when nullif(trim(coalesce(p_name, '')), '') is null then p_name
    when private.hide_member_names(p_name, p_pattern) = p_name then p_name
    when lower(trim(private.hide_member_names(p_name, p_pattern))) = 'a member' then 'A member'
    else private.hide_member_names(p_name, p_pattern) end;
$$;

-- Club spending (as 20270890000100_club_spending.sql), with payees shown as payee_shown has them.
create or replace function public.club_spending()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  keeper boolean := private.keeps_books(null);
  reader boolean := private.is_approved_member() and exists (
    select 1 from public.members where id = auth.uid() and status <> 'legacy');
  pat text := private.member_name_pattern();
  today date := (now() at time zone 'Australia/Melbourne')::date;
  since date := make_date(extract(year from today)::int - case when extract(month from today) >= 7 then 1 else 2 end, 7, 1);
begin
  if not (keeper or reader) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'entry_on', e.entry_on, 'code', e.code, 'chapter_id', e.chapter_id, 'amount_cents', e.amount_cents,
      'description', private.hide_member_names(e.description, pat),
      'payee', case
        when e.payee_member_id is not null then 'A member'
        else private.payee_shown(nullif(trim(coalesce(e.payee_name, '')), ''), pat) end
    ) order by e.entry_on desc, e.recorded_at desc)
    from public.ledger_entries e
    join public.ledger_codes c on c.code = e.code
    where e.state = 'paid' and c.direction = 'debit' and e.entry_on is not null and e.entry_on >= since), '[]'::jsonb);
end;
$$;

-- Presented meeting reports: members read the notes with names hidden; whoever keeps the Club fund's
-- books, and the National Auditor, see them as written.
create or replace function public.meeting_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  keeper boolean := private.keeps_books(null);
  reader boolean := private.is_approved_member() and exists (
    select 1 from public.members where id = auth.uid() and status <> 'legacy');
  names boolean := keeper or private.is_auditor();
  pat text;
begin
  if not (keeper or reader) then return '[]'::jsonb; end if;
  if not names then pat := private.member_name_pattern(); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'from_on', r.from_on, 'to_on', r.to_on,
      'notes', case when names then r.notes else private.hide_member_names(r.notes, pat) end,
      'saved_by', r.saved_by, 'saved_at', r.saved_at,
      'presented_by', r.presented_by, 'presented_at', r.presented_at, 'pdf_path', r.pdf_path, 'pdf_name', r.pdf_name,
      'figures', private.meeting_report(r.from_on, r.to_on)) order by r.to_on desc, r.saved_at desc)
    from public.treasurer_meeting_reports r
    where r.presented_at is not null or keeper), '[]'::jsonb);
end;
$$;

-- Two independent approvers (13.3): the refusals never name the payee, since board members approving
-- don't see who's paid ("the payee" instead). Otherwise as 20270870000000_acting_roles.sql. Mirrors
-- approvalConflict in src/domain/ledger.ts.
create or replace function private.approval_conflict(p_entry uuid, p_member uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  board constant public.position_role[] := array['president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'];
  e public.ledger_entries;
  who text;
begin
  select * into e from public.ledger_entries where id = p_entry;
  if not found then return null; end if;
  -- Seated: the member stands only through acting rows that the recorder, the payee or an approver
  -- already counted put there.
  select case when x.n = 1 then 'the payee' else private.short_name(m) end into who
  from (select e.recorded_by as id, 0 as n, null::timestamptz as at
        union all select e.payee_member_id, 1, null
        union all select a.member_id, 2, a.approved_at from public.ledger_approvals a
                  where a.entry_id = p_entry and a.member_id <> p_member) x
  join public.members m on m.id = x.id
  where x.id <> p_member
    and not exists (
      select 1 from private.held_positions o
      where o.member_id = p_member and o.acting_until is null
        and ((o.chapter_id = e.chapter_id and o.role = any (board)) or o.role in ('nec_chair', 'nec_secretary')))
    and exists (
      select 1 from private.held_positions h left join public.acting_requests r on r.id = h.acting_request
      where h.member_id = p_member and h.chapter_id = e.chapter_id and h.role = any (board)
        and h.acting_until is not null and x.id in (h.appointed_by, r.requested_by))
  order by x.n, x.at, x.id
  limit 1;
  if who is not null then
    return 'You’re acting because ' || who || ' put you there, so you can’t be the second approver on their entry (13.3).';
  end if;
  -- Planted: an approver already counted stood only through acting the day they approved, in a row
  -- the member put there.
  select private.short_name(m) into who
  from public.ledger_approvals a
  cross join lateral (select private.club_date(a.approved_at) as d) day
  join public.members m on m.id = a.member_id
  where a.entry_id = p_entry and a.member_id <> p_member
    and not exists (
      select 1 from public.positions o
      where o.member_id = a.member_id and o.acting_until is null
        and ((o.chapter_id = e.chapter_id and o.role = any (board)) or o.role in ('nec_chair', 'nec_secretary'))
        and o.started_on < day.d and (o.ended_on is null or o.ended_on > day.d))
    and exists (
      select 1 from public.positions h left join public.acting_requests r on r.id = h.acting_request
      where h.member_id = a.member_id and h.chapter_id = e.chapter_id and h.role = any (board)
        and h.acting_until >= day.d and h.started_on <= day.d and (h.ended_on is null or h.ended_on >= day.d)
        and p_member in (h.appointed_by, r.requested_by))
  order by a.approved_at, a.member_id
  limit 1;
  if who is not null then
    return who || ' is acting because you put them there, so you can’t be the second approver after them (13.3).';
  end if;
  -- The payee's stand-in: their payment goes to the other approvers.
  select 'the payee' into who
  from private.held_positions c
  join public.positions p on p.id = c.covers
  where c.member_id = p_member and p.member_id = e.payee_member_id
  limit 1;
  if who is not null then
    return 'You’re covering ' || who || '’s seat, so their payment goes to the other approvers (13.3).';
  end if;
  return null;
end;
$$;

-- The books: whoever keeps a fund's books, and the National Auditor, read its lines as written; board
-- members approving its spending read members' names as "a member", with no payee id to look one up
-- (only their own, so a payment to themselves still can't be approved) and no fee payment link.
-- Otherwise as 20270101000200_treasurer.sql. Mirrors financesAsSeenBy in src/domain/financePrivacy.ts.
create or replace function public.club_ledger()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  reads_reports boolean := exists (
    select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'legacy');
  auditor boolean := private.is_auditor();
  pat text := private.member_name_pattern();
begin
  if not private.is_approved_member() then
    return jsonb_build_object('entries', '[]'::jsonb, 'openings', '[]'::jsonb, 'floats', '[]'::jsonb,
      'budgets', '[]'::jsonb, 'reports', '[]'::jsonb, 'report_totals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'chapter_id', e.chapter_id, 'code', e.code,
        'description', case when n.names then e.description else private.hide_member_names(e.description, pat) end,
        'amount_cents', e.amount_cents, 'received_on', e.received_on, 'entry_on', e.entry_on,
        'payee_member_id', case when n.names or e.payee_member_id = auth.uid() then e.payee_member_id end,
        'payee_name', case
          when n.names then e.payee_name
          when e.payee_member_id is not null then 'A member'
          else private.payee_shown(e.payee_name, pat) end,
        'payment_id', case when n.names then e.payment_id end, 'state', e.state, 'recorded_by', e.recorded_by,
        'recorded_at', e.recorded_at, 'updated_at', e.updated_at,
        'void_reason', case when n.names or e.void_reason is null then e.void_reason else private.hide_member_names(e.void_reason, pat) end,
        'voided_by', e.voided_by,
        'approvals', (select coalesce(jsonb_agg(jsonb_build_object('member_id', a.member_id, 'approved_at', a.approved_at)
                                                order by a.approved_at, a.member_id), '[]'::jsonb)
                      from public.ledger_approvals a where a.entry_id = e.id)
        )
        -- With a member payee taken off, the app can't work out why this reader can't approve it, so
        -- it's sent (null: they can). Only on those lines.
        || case when not n.names and e.state = 'awaiting' and e.payee_member_id is not null
                     and e.payee_member_id <> auth.uid()
                then jsonb_build_object('my_conflict', private.approval_conflict(e.id, auth.uid()))
                else '{}'::jsonb end
        order by e.entry_on desc nulls first, e.recorded_at desc)
      from public.ledger_entries e
      cross join lateral (select private.keeps_books(e.chapter_id) or auditor as names) n
      where private.sees_ledger(e.chapter_id)), '[]'::jsonb),
    'openings', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', chapter_id, 'fy', fy, 'amount_cents', amount_cents) order by fy, chapter_id)
      from public.fund_openings), '[]'::jsonb) else '[]'::jsonb end,
    'floats', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('fy', fy, 'amount_cents', amount_cents) order by fy)
      from public.cash_floats), '[]'::jsonb) else '[]'::jsonb end,
    'budgets', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', chapter_id, 'fy', fy, 'lines', lines, 'approved_vote_id', approved_vote_id,
        'approved_at', approved_at, 'approved_by', approved_by, 'updated_at', updated_at) order by fy, chapter_id)
      from public.budgets), '[]'::jsonb) else '[]'::jsonb end,
    -- Whoever keeps any fund's books gets every member's names, so the PDFs they share can take them
    -- all out (their own members list leaves out other chapters' applicants).
    'hidden_names', case when exists (
        select 1 from (select null::uuid as id union all select id from public.chapters) f where private.keeps_books(f.id)) then coalesce((
      select jsonb_agg(jsonb_build_object('full_name', full_name, 'road_name', road_name) order by full_name)
      from public.members), '[]'::jsonb) else '[]'::jsonb end,
    'reports', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'presented_at', presented_at, 'presented_by', presented_by) order by month desc)
      from public.treasurer_reports), '[]'::jsonb) else '[]'::jsonb end,
    -- Whoever reads any fund gets every month worked out over all funds, since they can't add up
    -- the funds they can't read; members get the presented months.
    'report_totals', case when exists (
        select 1 from (select null::uuid as id union all select id from public.chapters) f where private.sees_ledger(f.id)) then coalesce((
      select jsonb_agg(private.month_report(m::date) order by m desc)
      from generate_series(
        date_trunc('month', coalesce(least((select min(entry_on) from public.ledger_entries),
                                           (select make_date(min(fy), 7, 1) from public.fund_openings)), private.club_date())),
        date_trunc('month', private.club_date()), interval '1 month') m), '[]'::jsonb)
      when reads_reports then coalesce((
      select jsonb_agg(private.month_report(month) order by month desc) from public.treasurer_reports), '[]'::jsonb)
      else '[]'::jsonb end);
end;
$$;

revoke all on function private.member_name_pattern() from public, anon, authenticated;
revoke all on function private.hide_member_names(text, text) from public, anon, authenticated;
revoke all on function private.payee_shown(text, text) from public, anon, authenticated;
revoke all on function public.club_spending() from public, anon;
grant execute on function public.club_spending() to authenticated;
revoke all on function public.meeting_reports() from public, anon;
grant execute on function public.meeting_reports() to authenticated;
revoke all on function private.approval_conflict(uuid, uuid) from public, anon, authenticated;
revoke all on function public.club_ledger() from public, anon;
grant execute on function public.club_ledger() to authenticated;
