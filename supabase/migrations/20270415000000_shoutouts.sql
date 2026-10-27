-- Social extras (Stage 7): shared birthdays, for the shout-outs on Home. Only the day and month are
-- kept, never the year, and only when the member chooses to share them. Patch anniversaries need
-- nothing new: they come from members.patched_on.
-- Members change their birthday only through set_birthday, which applies the same checks with the
-- same words as src/domain/social/shoutouts.ts, in the same order.

-- One row per member who has ever shared a birthday. A month and day of null means not shared (taking
-- a birthday off keeps the row, so nothing here ever needs deleting).
create table public.member_birthdays (
  member_id uuid primary key references public.members (id) on delete cascade,
  month smallint,
  day smallint,
  set_at timestamptz not null default now(),
  constraint member_birthdays_both_or_neither check ((month is null) = (day is null)),
  -- A day that exists in its month in a leap year, so 29 February is allowed.
  constraint member_birthdays_real_day check (
    month is null or (month between 1 and 12 and day between 1 and
      case when month = 2 then 29 when month in (4, 6, 9, 11) then 30 else 31 end)
  )
);

-- Approved members read the birthdays of approved members (a suspended or declined member's stays
-- hidden); nobody writes one through the API.
alter table public.member_birthdays enable row level security;
revoke all on public.member_birthdays from public, anon, authenticated;
grant select on public.member_birthdays to authenticated;
create policy member_birthdays_for_members on public.member_birthdays for select to authenticated
  using (
    private.is_approved_member()
    and exists (select 1 from public.members m where m.id = member_id and m.approval = 'approved')
  );

-- Shares (or changes) your birthday. Two nulls take it off.
create or replace function public.set_birthday(p_month int, p_day int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if (p_month is null) <> (p_day is null) then raise exception 'Pick a day and a month.'; end if;
  if p_month is not null and (
    p_month not between 1 and 12 or p_day < 1 or
    p_day > case when p_month = 2 then 29 when p_month in (4, 6, 9, 11) then 30 else 31 end
  ) then
    raise exception 'That day isn’t in that month.';
  end if;

  insert into public.member_birthdays (member_id, month, day, set_at)
  values (me, p_month, p_day, now())
  on conflict (member_id) do update set month = excluded.month, day = excluded.day, set_at = excluded.set_at;
end;
$$;

revoke all on function public.set_birthday(int, int) from public, anon;
grant execute on function public.set_birthday(int, int) to authenticated;
