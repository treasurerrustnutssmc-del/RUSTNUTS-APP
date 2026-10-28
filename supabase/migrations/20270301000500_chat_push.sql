-- Chat notifications. See docs/superpowers/specs/2026-10-28-chat-notifications-design.md.
-- Each new chat message writes one push outbox row per member who can read that chat and has a phone
-- saved, except the sender, anyone blocked either way, anyone who switched chat notifications off and
-- anyone who had the chat open in the last minute. Like every push, it's held while the master switch
-- (private.app_settings 'push_enabled') is off. Needs 20270301000400_rev_sound.sql first.

alter table public.notification_prefs add column if not exists chat_messages boolean not null default true;

-- Six settings now. The four- and five-setting versions stay for older app builds, and leave chat as
-- it was.
create or replace function public.save_notification_prefs(
  p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean,
  p_chat_messages boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, rev_sound, chat_messages, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, p_rev_sound, p_chat_messages, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes, new_rides = excluded.new_rides,
    approvals = excluded.approvals, rev_sound = excluded.rev_sound, chat_messages = excluded.chat_messages, updated_at = now();
end;
$$;
revoke all on function public.save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Whether a member can read a chat, by the very rules that decide it when they open it
-- (private.chat_problem): asked as that member, then put back to whoever is signed in.
create or replace function private.member_can_read_chat(p_member uuid, p_chat uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  was text := current_setting('request.jwt.claim.sub', true);
  ok boolean;
begin
  perform set_config('request.jwt.claim.sub', p_member::text, true);
  begin
    ok := private.chat_problem(p_chat) is null;
  exception when others then
    ok := false;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(was, ''), true);
  return ok;
end;
$$;

-- A chat's name as the app shows it (chatTitle in src/domain/chat.ts). A private chat is called after
-- whoever sent the message.
create or replace function private.chat_push_title(c public.conversations, sender public.members)
returns text language sql stable security definer set search_path = '' as $$
  select case c.kind
    when 'club' then 'Whole club'
    when 'chapter' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' chapter'
    when 'board' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' big table'
    when 'nec' then 'NEC'
    when 'committee' then case when c.committee = 'charity' then 'Charity committee' else 'Ride committee' end
    when 'ride' then coalesce((select title from public.rides where id = c.ride_id), 'Ride chat')
    else private.short_name(sender)
  end;
$$;

-- "Wes: see you there", or "Wes sent 3 photos" when there are no words. A private chat leaves the name
-- off (it's the title). Cut to 140 characters.
create or replace function private.chat_push_body(m public.messages, c public.conversations, sender public.members)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  words text := btrim(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'));
  who text := private.short_name(sender);
  photos int;
  videos int;
  gifs int;
  sent text;
  out text;
begin
  if words <> '' then
    out := case when c.kind = 'direct' then words else who || ': ' || words end;
  else
    select count(*) filter (where kind = 'photo'), count(*) filter (where kind = 'video'), count(*) filter (where kind = 'gif')
    into photos, videos, gifs
    from public.message_media where message_id = m.id;
    sent := case
      when photos + videos = 0 and gifs > 0 then 'a GIF'
      when photos = 1 and videos = 0 then 'a photo'
      when videos = 1 and photos = 0 then 'a video'
      when videos = 0 then photos || ' photos'
      when photos = 0 then videos || ' videos'
      else (photos + videos) || ' photos and videos'
    end;
    out := case when c.kind = 'direct' then 'Sent ' || sent else who || ' sent ' || sent end;
  end if;
  if char_length(out) > 140 then out := left(out, 139) || '…'; end if;
  return out;
end;
$$;

-- Runs when the message is saved for good (a deferred trigger), so the photos added after it are there.
-- A problem here never stops the message itself.
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
        -- In the chat just now: they'll see it there.
        and not exists (
          select 1 from public.chat_reads r
          where r.conversation_id = c.id and r.member_id = d.member_id and r.read_at > now() - interval '1 minute')
    loop
      if private.member_can_read_chat(who, c.id) then
        insert into private.push_outbox (member_id, dedupe_key, title, body, data)
        values (who, 'chat:' || new.id, t, b, jsonb_build_object('kind', 'chat', 'chatId', c.id))
        on conflict (member_id, dedupe_key) do nothing;
      end if;
    end loop;
  exception when others then
    raise warning 'chat notification for message % not written: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create constraint trigger messages_push after insert on public.messages
  deferrable initially deferred for each row execute function private.push_chat_message();

revoke all on function private.member_can_read_chat(uuid, uuid), private.chat_push_title(public.conversations, public.members),
  private.chat_push_body(public.messages, public.conversations, public.members), private.push_chat_message()
  from public, anon, authenticated;
