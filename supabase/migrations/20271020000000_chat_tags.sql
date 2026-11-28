-- Chat tags that ring the phone (Jeff, 28 Nov 2026: "a tagging system that rings the phone of the person
-- tagged. Like @everyone, or @tinman"; "Any member can use @everyone and individual tags as well").
-- See docs/superpowers/specs/2026-11-28-chat-tags-design.md.
--
-- A tagged member gets a notification of their own for the message (data.kind 'tag', "Wes tagged you ·
-- Whole club") in place of the ordinary one. send-push gives tags their own loud Android channel, makes
-- them time-sensitive on iPhone and never folds them into the chat's stack
-- (supabase/functions/_shared/sendPush.ts). Tags come even with chat notifications off, unless the
-- member switched Tags off. Everything else about who hears a message is as in
-- 20270980000100_chat_topics.sql. Needs that file first.

alter table public.notification_prefs add column if not exists chat_tags boolean not null default true;

-- Seven settings now. The four-, five- and six-setting versions stay for older app builds, and leave
-- Tags as it was.
create or replace function public.save_notification_prefs(
  p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean,
  p_chat_messages boolean, p_chat_tags boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, rev_sound, chat_messages, chat_tags, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, p_rev_sound, p_chat_messages, p_chat_tags, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes, new_rides = excluded.new_rides,
    approvals = excluded.approvals, rev_sound = excluded.rev_sound, chat_messages = excluded.chat_messages,
    chat_tags = excluded.chat_tags, updated_at = now();
end;
$$;
revoke all on function public.save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Whether a message tags a name: @ (at the start, or after anything but a letter, digit or _) then the
-- name, any case, not run into another letter, digit or _. The app uses the same rule
-- (src/domain/chatTags.ts). No regular expression is built from the name, so a name can hold anything.
create or replace function private.tags_name(p_body text, p_name text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  b text := lower(coalesce(p_body, ''));
  n text := '@' || lower(coalesce(p_name, ''));
  start int := 1;
  at int;
begin
  if coalesce(btrim(p_name), '') = '' then return false; end if;
  loop
    at := strpos(substr(b, start), n);
    exit when at = 0;
    at := at + start - 1;
    if (at = 1 or substr(b, at - 1, 1) !~ '[[:alnum:]_]')
       and substr(b, at + length(n), 1) !~ '[[:alnum:]_]' then
      return true;
    end if;
    start := at + 1;
  end loop;
  return false;
end;
$$;
revoke all on function private.tags_name(text, text) from public, anon, authenticated;

create or replace function private.push_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
  -- Whose people hear it: the chat itself, or a topic's chat.
  g public.conversations%rowtype;
  sender public.members%rowtype;
  t text;
  b text;
  who uuid;
  stack jsonb;
  n int;
  everyone boolean;
  by_name boolean;
  tagged boolean;
begin
  begin
    if new.removed_at is not null then return null; end if;
    select * into c from public.conversations where id = new.conversation_id;
    g := c;
    if c.kind = 'topic' then select * into g from public.conversations where id = c.parent_id; end if;
    select * into sender from public.members where id = new.author_id;
    t := private.chat_push_title(c, sender);
    b := private.chat_push_body(new, c, sender);
    everyone := private.tags_name(new.body, 'everyone');
    for who, by_name, tagged in
      select x.member_id, x.by_name, x.tags_on and (x.by_name or everyone)
      from (
        select distinct d.member_id,
          private.tags_name(new.body, private.short_name(m)) as by_name,
          coalesce(p.chat_tags, true) as tags_on,
          coalesce(p.chat_messages, true) as chat_on
        from public.push_devices d
        join public.members m on m.id = d.member_id
        left join public.notification_prefs p on p.member_id = d.member_id
        where d.member_id <> new.author_id
          and (g.kind not in ('direct', 'group') or exists (
            select 1 from public.conversation_members cm where cm.conversation_id = g.id and cm.member_id = d.member_id))
          and not private.blocked_between(new.author_id, d.member_id)
      ) x
      -- Chat notifications off: only a tag gets through, unless Tags is off too.
      where x.chat_on or (x.tags_on and (x.by_name or everyone))
    loop
      begin
        if private.member_can_read_chat(who, c.id) then
          if tagged then
            insert into private.push_outbox (member_id, dedupe_key, title, body, data)
            values (who, 'chat:' || new.id,
              private.short_name(sender) || ' tagged ' || case when by_name or c.kind = 'direct' then 'you' else 'everyone' end
                || case when c.kind = 'direct' then '' else ' · ' || t end,
              b,
              jsonb_build_object('kind', 'tag', 'chatId', c.id, 'line', b))
            on conflict (member_id, dedupe_key) do nothing;
          else
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
