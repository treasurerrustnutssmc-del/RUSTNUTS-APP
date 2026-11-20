-- Every chat message notifies everyone who can read the chat (Jeff, 20 Nov 2026: "we need to make sure
-- every single chat message causes a notification"), but its author, anyone blocked either way, and anyone
-- who has turned chat notifications off in their settings. It no longer skips someone who had the chat
-- open in the last minute: the phone itself hides the banner only while that chat is on screen
-- (src/data/foregroundNotifications.ts). Otherwise as in 20270301000500_chat_push.sql.
-- On its own so it can go live before the chat groups (20270880000100_chat_groups.sql redefines it again
-- with groups in the private-chat filter).

create or replace function private.push_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
  sender public.members%rowtype;
  t text;
  b text;
  who uuid;
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
        and (c.kind <> 'direct' or exists (
          select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.member_id = d.member_id))
        and not private.blocked_between(new.author_id, d.member_id)
        and coalesce((select p.chat_messages from public.notification_prefs p where p.member_id = d.member_id), true)
    loop
      begin
        if private.member_can_read_chat(who, c.id) then
          insert into private.push_outbox (member_id, dedupe_key, title, body, data)
          values (who, 'chat:' || new.id, t, b, jsonb_build_object('kind', 'chat', 'chatId', c.id))
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

