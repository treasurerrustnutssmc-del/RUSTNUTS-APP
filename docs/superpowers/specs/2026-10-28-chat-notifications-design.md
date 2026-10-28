# Chat notifications (members stay signed in and hear the chat)

Bounded work. Self-approved 28 Oct 2026 under Jeff's standing rule; shown to Jeff, who can veto.

## Jeff's ask

"We want them logged in all the time so they get chat notifications." (25 and 28 Oct 2026)

## What we found

- **Sign-in already lasts.** The Supabase client keeps the login on the phone and renews it
  (`src/data/supabase.ts`). Supabase sessions on this project have no time limit (`auth.sessions.not_after`
  is empty) and refresh tokens don't expire. Jeff's two logins from 24 and 25 Oct were both still
  live on 28 Oct. A login ends only when the member taps Sign out (or removes the app or clears its
  data). No change is needed there.
- **Chats send no notifications.** The push outbox has triggers for rides, applicants and live ride
  alerts only.
- **Most phones never register for pushes.** The app only asks for notification permission when it
  has a ride reminder to set, so a member who isn't going to a ride is never asked and their phone
  is never saved for pushes.
- **Tapping a notification does nothing in particular.** There's no tap handler.
- **Android needs a Firebase project** before any Android phone can get a push token. That's an
  account, so it's Jeff's step (steps in the PR and the handover). Push stays behind the existing
  master switch (`private.app_settings.push_enabled`) until launch.

## Design

### Database (`20270301000500_chat_push.sql`)

- `notification_prefs.chat_messages boolean not null default true`.
- `save_notification_prefs` gets a six-setting version (adds `p_chat_messages`). The four- and
  five-setting versions stay for older app builds and leave the new setting alone.
- `private.member_can_read_chat(member, chat)`: runs the existing `private.chat_problem` as that
  member (sets `request.jwt.claim.sub` for the call and puts it back), so who hears a chat follows
  exactly the rules that decide who can read it. No second copy of the rules to drift.
- A deferred constraint trigger on `public.messages` (fires at commit, after `send_message` has
  added the photos) writes one outbox row per member who:
  - has a phone saved for pushes (nobody else could receive it anyway, and it keeps the loop small),
  - isn't the sender,
  - can read the chat (private chats: only its two people),
  - hasn't blocked the sender or been blocked by them,
  - has chat messages on,
  - hasn't had the chat open in the last minute (their `chat_reads.read_at`), so someone in the middle
    of the conversation isn't buzzed for every reply.
- Text: title is the chat's name as the app shows it (Whole club, West chapter, West big table, NEC,
  Ride committee, Charity committee, the ride's title); a private chat's title is the sender's name.
  Body is `Name: message` (private chats: just the message), cut to 140 characters. A message with
  only photos says "sent a photo" / "sent 3 photos" / "sent a video" / "sent a GIF".
- `data = {kind: 'chat', chatId}`, dedupe key `chat:<message id>`.

### Phone

- `chatMessages` joins `NotificationPrefs` (default on; settings saved by older builds get it on).
  Load/save follow the Harley rev pattern: try the six-setting save, fall back to five, then four,
  while the SQL isn't live.
- Me > Notifications gets a **Chat messages** switch.
- Chat pushes have their own Android channels (`chat-rev` and `chat`), so a member can also quiet
  chat from the phone's own settings without losing ride news. Both push sender and phone use the
  same `soundFor` table; a test checks they agree.
- Every signed-in member is asked for notification permission once (after the channels exist, which
  Android 13 needs), then the phone is saved for pushes. A "no" is left to the phone's settings.
- Tapping a notification opens the chat (`kind: 'chat'`) or the ride (`kind: 'ride'`), including when
  the tap launched the app.
- While the member is looking at a chat, a push for that same chat isn't shown as a banner.

## Out of scope

- Mentions, per-chat mute, quiet hours: worth doing once members are using it.
- Turning push on: launch step, Jeff's yes.
