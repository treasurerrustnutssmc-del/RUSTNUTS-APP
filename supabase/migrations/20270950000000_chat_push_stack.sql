-- Chat notifications stack like Messenger (Jeff, 21 Nov 2026: "Make the chat notifications stack like
-- facebook messager not one after the other"). The phone keeps one notification per chat: send-push
-- gives every chat push the same Android tag and iPhone collapse id for its chat
-- (supabase/functions/_shared/sendPush.ts), so each new one replaces the last. So nothing is lost when
-- it's replaced, each push carries the reader's unread lines for that chat: the latest five, oldest
-- first, with a count in the title once there's more than one ("Whole club · 3 new messages").
--
-- Unread means: in that chat, not removed, not from them or anyone blocked either way, after they last
-- read it or last posted in it, and from the last day (a member who never opens a chat gets a short
-- stack, not a count of everything since they joined). data.line is this message on its own, for the
-- app's banner while it's open.
-- Who hears it is unchanged from 20270880000100_chat_groups.sql.

create or replace function private.chat_push_stack(who uuid, msg public.messages, c public.conversations)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz;
  n int;
  lines text[];
begin
  select greatest(
      (select r.read_at from public.chat_reads r where r.conversation_id = c.id and r.member_id = who),
      (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.author_id = who),
      msg.created_at - interval '1 day')
  into since;
  -- No upper bound on time: a message saved a moment before another but written down after it still
  -- shows everything, so whichever push reaches the phone last is complete.
  with unread as (
    select m as msg, a as author, m.created_at, m.id
    from public.messages m
    join public.members a on a.id = m.author_id
    where m.conversation_id = c.id
      and m.removed_at is null
      and m.author_id <> who
      and m.created_at > since
      and not private.blocked_between(m.author_id, who)
  ), latest as (
    select u.*, row_number() over (order by u.created_at desc, u.id desc) as back from unread u
  )
  select (select count(*) from unread),
         array_agg(private.chat_push_body(l.msg, c, l.author) order by l.created_at, l.id)
  into n, lines
  from latest l where l.back <= 5;
  -- Phones take about 4 KB a push: keep the words under 1.5 KB, dropping the oldest lines first.
  while coalesce(array_length(lines, 1), 0) > 1 and octet_length(array_to_string(lines, E'\n')) > 1500 loop
    lines := lines[2:];
  end loop;
  return jsonb_build_object('count', coalesce(n, 0), 'lines', array_to_string(lines, E'\n'));
end;
$$;
revoke all on function private.chat_push_stack(uuid, public.messages, public.conversations) from public, anon, authenticated;

create or replace function private.push_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
  sender public.members%rowtype;
  t text;
  b text;
  who uuid;
  stack jsonb;
  n int;
begin
  begin
    if new.removed_at is not null then return null; end if;
    select * into c from public.conversations where id = new.conversation_id;
    select * into sender from public.members where id = new.author_id;
    t := private.chat_push_title(c, sender);
    b := private.chat_push_body(new, c, sender);
    for who in
      select distinct d.member_id from public.push_devices d
      where d.member_id <> new.author_id
        and (c.kind not in ('direct', 'group') or exists (
          select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.member_id = d.member_id))
        and not private.blocked_between(new.author_id, d.member_id)
        and coalesce((select p.chat_messages from public.notification_prefs p where p.member_id = d.member_id), true)
    loop
      begin
        if private.member_can_read_chat(who, c.id) then
          begin
            stack := private.chat_push_stack(who, new, c);
            n := coalesce((stack->>'count')::int, 0);
          exception when others then
            -- No stack is no reason to miss the message: it goes on its own, as before.
            raise warning 'chat notification stack for message % to % not worked out: %', new.id, who, sqlerrm;
            n := 0;
          end;
          insert into private.push_outbox (member_id, dedupe_key, title, body, data)
          values (who, 'chat:' || new.id,
            case when n > 1 then t || ' · ' || n || ' new messages' else t end,
            case when n > 1 then stack->>'lines' else b end,
            jsonb_build_object('kind', 'chat', 'chatId', c.id, 'line', b))
          on conflict (member_id, dedupe_key) do nothing;
        end if;
      exception when others then
        -- One member's problem doesn't cost everyone else the notification.
        raise warning 'chat notification for message % to % not written: %', new.id, who, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'chat notification for message % not written: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
