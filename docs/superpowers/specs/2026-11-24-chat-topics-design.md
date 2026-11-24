# Topics inside board and committee chats (24 Nov 2026)

Architectural (a new chat kind, who the database lets into it, new screens and pushes), so a written
spec. Claude approved it (AGENTS.md, 24 Oct 2026); Jeff can veto.

## Jeff's ask

23 Nov 2026: "in board or committee chats, can they be able to make sub chats to better separate and
track conversation topics, I liked this from discord". 24 Nov: "build as written" (go now, without
waiting on a board poll).

Today a board chat is one long stream. The Christmas party, the insurance renewal and merch all land
in the same place, so a reply about one buries another, and someone catching up can't follow one
subject. Discord's answer is threads: a named side conversation hanging off a channel.

## Goals

- In a board, All boards, NEC, committee or group chat, anyone in it can start a **topic**: a named
  chat of its own ("Christmas party") that sits inside that chat.
- A topic reads like any chat: words, photos, GIFs, voice notes, replies, reactions, pins, reports,
  Catch me up.
- A topic's people are exactly the parent chat's people, following it (seats, committee places, group
  membership) with nothing to manage.
- Topics can be closed when the subject is done, so the list stays short, and reopened.
- Pushes say which topic: "All boards › Christmas party".

## Non-goals

- Topics in the whole-club, Family, chapter, ride or private chats (Jeff asked for board and committee
  chats; groups are board-run, so they are in too).
- Topics inside topics.
- Starting a topic from a message (Discord's "create thread from message"), muting one topic,
  deleting a topic. Closing covers tidying; history is kept.

## Anti-goals

- A topic must never let anyone read something the parent chat wouldn't.
- No change to how the existing chats behave for people who never touch topics.

## Approaches

1. **A topic is a conversation of its own (picked).** New chat kind `topic` with `parent_id`. Every
   existing piece (messages, photos in storage, reads, unread counts, pins, reactions, reports, push
   stacking, Catch me up) is keyed by conversation id, so it works unchanged; only the "who reads it"
   rule and a few labels look through to the parent. Cost: one enum value (its own file) and a handful
   of functions taught about `topic`.
2. **A topic column on messages.** Topics as tags on messages inside the parent chat. Every read,
   unread count, pin, push stack and the chat screen's message loading would need a topic filter:
   far more places to get wrong, and a pin or unread count per topic needs new tables anyway.
3. **Groups by another name.** Make each topic a group. Groups have their own member lists, so a topic
   would drift from the seats it should follow, and ordinary board members can't run committee chats'
   groups. Rejected.

## Rules

- **Which chats have topics:** `board` (a chapter's big table), `boards` (All boards), `nec`,
  `committee`, `group`. Not a topic itself.
- **Who reads and posts in a topic:** whoever reads the parent. `chat_problem(topic)` is
  `chat_problem(parent)`, word for word, so the reasons match. A closed topic can still be read.
- **Who starts one:** anyone who reads the parent (that already excludes Hang Arounds and Family).
  Name 1 to 40 characters, trimmed like the app ("Give the topic a name." / "Keep the name to 40
  characters."). At most 50 open topics in one chat ("This chat has 50 open topics. Close one first.").
- **Who renames, closes and reopens one:** whoever started it, or any board member or the NEC who reads
  the parent (`is_any_board`, the people who run groups). Others get "Only whoever started the topic,
  or a board member or the NEC, can do that."
- **Closed:** `closed_at` set. Nobody posts ("This topic is closed. Reopen it to post."); reading, Catch
  me up and reports still work. Reopening clears it.
- **Moderating:** whoever moderates the parent moderates its topics (remove, pin). Reports in a topic go
  where the parent's would (a group topic's to the reporter's chapter board).
- **Photos on the website:** decided by the parent's kind (a group topic's photos stay private).
- **Pushes:** to everyone who reads the parent, with the same opt-out and block rules as any chat.
  Title "<parent title> › <topic name>", stacking per topic.

## Database

Two files, because Postgres can't use a new enum value in the transaction that adds it:

1. `20270980000000_chat_topics_kind.sql`: `chat_kind` gets `topic`.
2. `20270980000100_chat_topics.sql`:
   - `conversations.parent_id` (cascade), `closed_at`, `closed_by`; checks that a topic, and only a
     topic, has a parent, and that topics have names like groups (the name check widens to both);
   - `chat_problem` looks through a topic to its parent; `can_moderate` the same;
     `can_act_on_report` uses the parent's kind; `chat_push_title` names both; `push_chat_message`
     checks group membership on the parent; `pick_site_photo` refuses group topics;
   - `send_message` refusal for closed topics through a before-insert trigger on `messages`, so the
     long send function isn't copied;
   - `chat_list` carries `parent_id`, `closed_at`, `closed_by` (topics are listed like any chat the
     reader can read; the app tucks them under their parent);
   - new `start_topic(p_chat, p_name)`, `rename_topic`, `close_topic`, `reopen_topic`.

## App

- `ChatKind` gets `topic`; `Conversation` gets `parentId`, `closedAt`, `closedBy` and, for a topic, a
  copy of its `parent` conversation (the list carries both), so the read rule can look through.
- `src/domain/chat.ts`: `readProblem`, `canModerate`, `canSeeReport`, `chatTitle` and `postProblem`
  mirror the database; new `TOPIC_PARENTS`, `hasTopics`, `topicNameProblem`, `startTopicProblem`,
  `topicRunProblem` (rename/close/reopen) with the database's words.
- Chat list: topic rows are left out of the main list; a parent's row adds its topics' unread to its
  badge, takes the newest message across them for its time and preview ("Christmas party · Rusty:
  …"), and sorts as before.
- Chat screen: in a chat with topics, a **Topics** bar under the header ("Topics · 3 open · 2 new ›")
  opens the Topics screen. In a topic, the header shows the topic name with the parent chat under it,
  and a header button opens Topic info. A closed topic shows "This topic is closed." where the message
  box was, with Reopen for those who can.
- **Topics screen** (per chat): New topic (name field + Start topic), open topics newest activity first
  with unread badges, then "Closed topics".
- **Topic info screen:** name (editable for those who can), who started it and when, Close topic /
  Reopen topic (ConfirmButton, no Alert).
- Demo: All boards gets "Christmas party" and "Insurance renewal" open and "Big 4 bookings" closed.

## Tests

`supabase/tests/chat_topics_test.sql`; app rules in `src/domain/chatTopics.test.ts`; demo actions in
`src/data/chat/demoChatActions.test.ts`; the list folding in `src/data/chat/chatList.test.ts`; live
mapping in `src/data/chat/liveChat.test.ts`.

## Shipping

OTA only (no native module). The two SQL files run live in order, then the app update joins the next
batched update with comms bubbles (PR #206) and board files (PR #207). The app copes with the SQL not
being live yet: no topics come back, and starting one says the database isn't ready.

## Calls Claude made

- Groups are included (the coordinator's brief; they're board-run).
- 50 open topics a chat, 40-character names (same as group names).
- Closing instead of deleting, so nothing said is lost.
- Rename/close by the starter or any board member/NEC, rather than only moderators, so a committee
  member who started "Raffle prizes" can close it.
