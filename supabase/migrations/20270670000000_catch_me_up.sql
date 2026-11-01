-- Catch me up: a short summary of the chat a member missed, from the club's AI. The ask-club Edge
-- Function calls catchup_start() as the member, which checks they can read the chat and have Ask the
-- club questions left (it counts as one), then hands back the chat's newest messages. Nothing is kept.
-- Spec: docs/superpowers/specs/2026-11-01-catch-me-up-design.md

create or replace function public.catchup_start(p_chat uuid, p_count int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today constant date := private.club_date();
  this_month constant date := date_trunc('month', private.club_date())::date;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  me uuid := auth.uid();
  wanted int := least(greatest(coalesce(p_count, 8), 8), 300);
  chat_kind text;
  asked int;
  spent bigint;
  others int;
  messages jsonb;
  who jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved_member() then
    raise exception 'Only approved members can ask the club.';
  end if;
  select c.kind::text into chat_kind from public.conversations c where c.id = p_chat;
  if chat_kind is null or not private.can_read_chat(p_chat) then
    raise exception 'That chat isn’t one of yours.';
  end if;
  if not private.assistant_on() then
    raise exception 'Ask the club isn’t switched on yet.';
  end if;

  -- The newest messages, oldest first: none removed, none from someone the member has blocked, none
  -- with nothing in them. Each is cut to 1,000 characters and the lot to about 40,000 (the newest
  -- kept), so one catch-up costs cents and a busy chat can't eat the club's month.
  with recent as (
    select m.id, m.author_id, left(nullif(trim(m.body), ''), 1000) as body, m.created_at
    from public.messages m
    where m.conversation_id = p_chat and m.removed_at is null
      and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
      and (nullif(trim(m.body), '') is not null or exists (select 1 from public.message_media mm where mm.message_id = m.id))
    order by m.created_at desc, m.id desc
    limit wanted
  ), picked as (
    select r.* from (
      select recent.*, sum(coalesce(length(recent.body), 0)) over (order by recent.created_at desc, recent.id desc) as running
      from recent
    ) r
    where r.running <= 40000
  )
  select
    count(*) filter (where p.author_id <> me),
    coalesce(jsonb_agg(jsonb_build_object(
      'who', case when p.author_id = me then 'you'
                  when x.id is null then 'a former member'
                  when x.road_name is null then x.full_name
                  else x.full_name || ' (' || x.road_name || ')' end,
      'at', p.created_at,
      'text', p.body,
      'media', (select string_agg(n || ' ' || k || case when n > 1 then 's' else '' end, ', ')
                from (select case mm.kind::text when 'voice' then 'voice note' when 'gif' then 'GIF' else mm.kind::text end as k, count(*) as n from public.message_media mm
                      where mm.message_id = p.id group by mm.kind) media)
    ) order by p.created_at), '[]'::jsonb)
  into others, messages
  from picked p left join public.members x on x.id = p.author_id;

  if others < 3 then
    raise exception 'Nothing much to catch up on.';
  end if;

  -- Counted first and checked after, so questions asked at the same moment can't all slip under the
  -- limit; a refusal rolls its own count back.
  delete from private.assistant_days where day < today - 1;
  insert into private.assistant_days as d (member_id, day, questions) values (me, today, 1)
  on conflict (member_id, day) do update set questions = d.questions + 1
  returning questions into asked;
  if asked > daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  insert into private.assistant_months as mo (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = mo.questions + 1
  returning spent_microusd into spent;
  if spent >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(today), 'DD/MM/YYYY');
  end if;

  select jsonb_build_object('name', x.full_name, 'roadName', x.road_name) into who from public.members x where x.id = me;
  return jsonb_build_object('kind', chat_kind, 'me', who, 'messages', messages);
end;
$$;

revoke all on function public.catchup_start(uuid, int) from public, anon, authenticated;
grant execute on function public.catchup_start(uuid, int) to authenticated;
