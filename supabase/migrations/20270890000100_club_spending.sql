-- Club spending for members (Jeff, 21 Nov 2026): every paid expense, with member names taken out
-- (Jeff chose "Hide member names"), for anyone who reads presented Treasurer's Reports (approved,
-- not Legacy, never Family) and the books keepers. Members never get the ledger lines themselves;
-- this gives the date, code, fund, amount, a cleaned description and a payee ("A member" for a
-- member). Money in isn't listed. Mirrors spendingLines/hideMemberNames in src/domain/clubSpending.ts.
-- Safe to run twice.

-- An earlier draft had a one-argument helper; only the two-argument one is kept.
drop function if exists private.hide_member_names(text);

-- One pattern for every member's full and road name (3+ characters), longest first; null when there
-- are none. Built once per call to club_spending(), not per line, so the books can grow.
create or replace function private.member_name_pattern()
returns text language sql stable security definer set search_path = '' as $$
  select '(?<![[:alnum:]_])(' || string_agg(regexp_replace(y.name, '([.*+?^${}()|\[\]\\])', '\\\1', 'g'), '|'
           order by char_length(y.name) desc, y.name) || ')(?![[:alnum:]_])'
  from (
    select distinct x.name from (
      select trim(full_name) as name from public.members
      union select trim(road_name) from public.members where road_name is not null
    ) x where char_length(x.name) >= 3
  ) y;
$$;

-- Any member's full or road name (whole words, any case) becomes "a member".
create or replace function private.hide_member_names(p_text text, p_pattern text default private.member_name_pattern())
returns text language sql immutable set search_path = '' as $$
  select case when p_pattern is null then coalesce(p_text, '') else regexp_replace(coalesce(p_text, ''), p_pattern, 'a member', 'gi') end;
$$;

-- Every paid expense from the start of last financial year (the two years the app shows), newest first.
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
        when p.name is null then null
        when private.hide_member_names(p.name, pat) = p.name then p.name
        else 'A member' end
    ) order by e.entry_on desc, e.recorded_at desc)
    from public.ledger_entries e
    join public.ledger_codes c on c.code = e.code
    cross join lateral (select nullif(trim(coalesce(e.payee_name, '')), '') as name) p
    where e.state = 'paid' and c.direction = 'debit' and e.entry_on is not null and e.entry_on >= since), '[]'::jsonb);
end;
$$;

revoke all on function private.member_name_pattern() from public, anon, authenticated;
revoke all on function private.hide_member_names(text, text) from public, anon, authenticated;
revoke all on function public.club_spending() from public, anon;
grant execute on function public.club_spending() to authenticated;
