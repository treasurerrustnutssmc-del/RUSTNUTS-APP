-- Social extras (Stage 7): "On this day". Photos and videos posted on today's date (Melbourne) in
-- earlier years, by exactly club_photos' rules: group chats you can read (never private ones), no
-- removed messages, no GIFs, nobody you've blocked. 29 February counts as 28 February in other
-- years, as src/domain/social/onThisDay.ts does. Read-only; nothing changes here.

create or replace function public.photos_on_this_day()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date := private.club_date();
  today_md text := to_char(private.club_date(), 'MM-DD');
  leap boolean := extract(day from (date_trunc('year', private.club_date()) + interval '1 month 28 days')) = 29;
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from (
      select m.*
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and private.club_date(m.created_at) < date_trunc('year', today)::date
        and (
          to_char(private.club_date(m.created_at), 'MM-DD') = today_md
          or (today_md = '02-28' and not leap and to_char(private.club_date(m.created_at), 'MM-DD') = '02-29')
        )
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
