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
             from regexp_split_to_table(y.name, '\s+') w), '[[:space:]._-]*'),
           '|' order by char_length(y.name) desc, y.name) || ')(?![[:alnum:]_])'
  from (
    select distinct x.name from (
      select trim(full_name) as name from public.members
      union select trim(road_name) from public.members where road_name is not null
      union select part from public.members m, regexp_split_to_table(trim(m.full_name), '\s+') part
    ) x where char_length(x.name) >= 3
  ) y;
$$;

-- Any member's name (whole words, any case) becomes "a member"; two parts of one name side by side
-- ("Christopher Andrew D") become one "a member".
create or replace function private.hide_member_names(p_text text, p_pattern text default private.member_name_pattern())
returns text language sql immutable set search_path = '' as $$
  select case when p_pattern is null then coalesce(p_text, '')
    else regexp_replace(regexp_replace(coalesce(p_text, ''), p_pattern, 'a member', 'gi'),
                        'a member([[:space:]]+a member)+', 'a member', 'g') end;
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
          when nullif(trim(coalesce(e.payee_name, '')), '') is null then e.payee_name
          when private.hide_member_names(e.payee_name, pat) = e.payee_name then e.payee_name
          else 'A member' end,
        'payment_id', case when n.names then e.payment_id end, 'state', e.state, 'recorded_by', e.recorded_by,
        'recorded_at', e.recorded_at, 'updated_at', e.updated_at,
        'void_reason', case when n.names or e.void_reason is null then e.void_reason else private.hide_member_names(e.void_reason, pat) end,
        'voided_by', e.voided_by,
        'approvals', (select coalesce(jsonb_agg(jsonb_build_object('member_id', a.member_id, 'approved_at', a.approved_at)
                                                order by a.approved_at, a.member_id), '[]'::jsonb)
                      from public.ledger_approvals a where a.entry_id = e.id)
        ) order by e.entry_on desc nulls first, e.recorded_at desc)
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
revoke all on function public.meeting_reports() from public, anon;
grant execute on function public.meeting_reports() to authenticated;
revoke all on function public.club_ledger() from public, anon;
grant execute on function public.club_ledger() to authenticated;
