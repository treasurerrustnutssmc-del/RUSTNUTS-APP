-- "Seen by" on chat messages, Messenger style (Jeff, 26 Nov 2026: "so I can tell if someone has seen
-- the message and not responded or genuinely not seen the message yet"). No switch to hide it.
--
-- Each member's last look at each chat is already kept in chat_reads for their unread count. Those
-- rows stay private (chat_reads_own); this hands a chat's readers, and only them, everyone else who
-- reads the chat now and when they last saw it: their last look, or their own post since if that's
-- later (writing in a chat counts as having read it, as for the unread count). Never opened: null.
-- Anyone blocked either way with the asker is left out, since a blocker doesn't see the blocked
-- person's messages. The app works out per message who has seen it (src/domain/chatSeen.ts).

create or replace function public.chat_seen(p_chat uuid)
returns table (member_id uuid, seen_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  me constant uuid := auth.uid();
  c public.conversations%rowtype;
  -- Whose people read it: the chat itself, or a topic's chat.
  g public.conversations%rowtype;
  who uuid;
begin
  perform private.raise_chat_problem(p_chat);
  select * into c from public.conversations where id = p_chat;
  g := c;
  if c.kind = 'topic' then select * into g from public.conversations where id = c.parent_id; end if;
  for who in
    select m.id from public.members m
    where m.id <> me and m.approval = 'approved'
      and (g.kind not in ('direct', 'group') or exists (
        select 1 from public.conversation_members cm where cm.conversation_id = g.id and cm.member_id = m.id))
      and not private.blocked_between(me, m.id)
    order by m.id
  loop
    -- member_can_read_chat signs in as them for the check and puts the asker back afterwards.
    if private.member_can_read_chat(who, p_chat) then
      member_id := who;
      seen_at := greatest(
        (select r.read_at from public.chat_reads r where r.conversation_id = p_chat and r.member_id = who),
        (select max(x.created_at) from public.messages x where x.conversation_id = p_chat and x.author_id = who));
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.chat_seen(uuid) from public, anon;
grant execute on function public.chat_seen(uuid) to authenticated;
