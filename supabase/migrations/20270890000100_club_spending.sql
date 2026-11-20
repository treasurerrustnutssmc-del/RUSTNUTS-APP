-- Club spending for members (Jeff, 21 Nov 2026): every paid expense, with member names taken out
-- (Jeff chose "Hide member names"), for anyone who reads presented Treasurer's Reports (approved,
-- not Legacy, never Family) and the books keepers. Members never get the ledger lines themselves;
-- this gives the date, code, fund, amount, a cleaned description and a payee ("A member" for a
-- member). Money in isn't listed. Mirrors spendingLines/hideMemberNames in src/domain/clubSpending.ts.
-- Safe to run twice.

-- Any member's full or road name (3+ characters, whole words, any case) becomes "a member",
-- longest first so a full name goes before a part of it.
create or replace function private.hide_member_names(p_text text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  out text := coalesce(p_text, '');
  n text;
begin
  for n in
    select y.name from (
      select distinct x.name from (
        select trim(full_name) as name from public.members
        union select trim(road_name) from public.members where road_name is not null
      ) x where char_length(x.name) >= 3
    ) y order by char_length(y.name) desc, y.name
  loop
    out := regexp_replace(out,
      '(?<![[:alnum:]_])' || regexp_replace(n, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '(?![[:alnum:]_])',
      'a member', 'gi');
  end loop;
  return out;
end;
$$;

create or replace function public.club_spending()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  keeper boolean := private.keeps_books(null);
  reader boolean := private.is_approved_member() and exists (
    select 1 from public.members where id = auth.uid() and status <> 'legacy');
begin
  if not (keeper or reader) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'entry_on', e.entry_on, 'code', e.code, 'chapter_id', e.chapter_id, 'amount_cents', e.amount_cents,
      'description', private.hide_member_names(e.description),
      'payee', case
        when e.payee_member_id is not null then 'A member'
        when nullif(trim(coalesce(e.payee_name, '')), '') is null then null
        when private.hide_member_names(trim(e.payee_name)) = trim(e.payee_name) then trim(e.payee_name)
        else 'A member' end
    ) order by e.entry_on desc, e.recorded_at desc)
    from public.ledger_entries e join public.ledger_codes c on c.code = e.code
    where e.state = 'paid' and c.direction = 'debit' and e.entry_on is not null), '[]'::jsonb);
end;
$$;

revoke all on function private.hide_member_names(text) from public, anon, authenticated;
revoke all on function public.club_spending() from public, anon;
grant execute on function public.club_spending() to authenticated;
