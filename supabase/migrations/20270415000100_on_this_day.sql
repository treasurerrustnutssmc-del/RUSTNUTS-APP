-- Social extras (Stage 7): "On this day". Photos and videos posted on today's date (Melbourne) in
-- earlier years, by exactly club_photos' rules: group chats you can read (never private ones), no
-- removed messages, no GIFs, nobody you've blocked. 29 February counts as 28 February in other
-- years, as src/domain/social/onThisDay.ts does. Read-only; nothing changes here.

-- Whether a day in an earlier year falls on today: the same day and month, or 29 February when today
-- is 28 February in a year with no 29th.
create or replace function private.is_on_this_day(p_day date, p_today date)
returns boolean language sql stable set search_path = '' as $$
  select p_day < date_trunc('year', p_today)::date and (
    to_char(p_day, 'MM-DD') = to_char(p_today, 'MM-DD')
    or (
      to_char(p_today, 'MM-DD') = '02-28' and to_char(p_day, 'MM-DD') = '02-29'
      and extract(day from (date_trunc('year', p_today) + interval '1 month 28 days')) <> 29
    )
  );
$$;
revoke all on function private.is_on_this_day(date, date) from public, anon, authenticated;

create or replace function public.photos_on_this_day()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date := private.club_date();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from (
      select m.*
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and private.is_on_this_day(private.club_date(m.created_at), today)
        and exists (select 1 from public.message_media x where x.message_id = m.id and x.kind <> 'gif')
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
      order by m.created_at desc
      limit 60
    ) m
    join public.message_media mm on mm.message_id = m.id and mm.kind <> 'gif'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.photos_on_this_day() from public, anon;
grant execute on function public.photos_on_this_day() to authenticated;
