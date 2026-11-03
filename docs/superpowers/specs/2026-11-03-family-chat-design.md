# Family chat (3 Nov 2026)

Architectural (it changes who the database lets into the chats), so a written spec. Claude approved
it; Jeff can veto.

## Jeff's ask

"I would also like to add a chat for family, that whole club can see but family only see that chat."

## What it is

One club-wide chat called **Family**.

- **Members** (FNG and up, Legacy included, every chapter) see it in their chat list next to Whole
  club and post in it like any other group chat.
- **Family accounts** get a fourth tab, **Chat**, which holds this one chat and nothing else. They
  read, post (words, photos, videos, GIFs, voice notes), reply and react.
- **Introduced** applicants don't see it: like the chapter chats, it opens up once they're an FNG.
  Family partners and grown-up kids (adults, 18 and over since 3 Nov 2026) are in there, and Introduced people aren't members yet.

## Content rules (Apple 1.2) apply in full

- Before a Family person's first message they read the club rules for chats and posts and tap I agree
  (same text, same `accept_posting_rules`). This happens inside the chat (a card above the composer),
  not as a whole-app gate, since Family who never chat shouldn't be stopped at the door.
- Anyone in the chat can report a message and block its author. Family can report and block too.
- Moderators: any board member or the NEC, as in the whole-club chat. Family never moderate. Reports
  on the Family chat go to the same board report queue.
- Suspending a Family person's app access shuts them out of the chat at once (approval isn't
  'approved' any more).

## What Family see of other people

Only the road name (or first name), chapter and status of people who have posted or reacted in the Family chat, through a
new `family_chat_people()` (empty for everyone else). No directory, phones, profiles or positions;
tapping a name in the chat opens nothing for Family.

## Database (the wall)

Two migration files, because Postgres can't use a new enum value in the same transaction that adds it:

1. `20270810000000_family_chat_kind.sql`: `chat_kind` gets `family`.
2. `20270810000100_family_chat.sql`:
   - the one Family conversation, kept to one by a unique index;
   - `private.chat_problem`: a Family person can read the Family chat and nothing else ("Family can
     only use the Family chat."); for members the Family chat is open to everyone approved except
     Introduced (the existing FNG message covers them);
   - `private.is_chat_user()`: approved member or Family. `chat_list`, `toggle_reaction`,
     `remove_message`, `report_message` and `set_block` use it in place of `is_approved_member` (the
     chat rules then narrow Family to their one chat);
   - `accept_posting_rules` takes Family too;
   - `chat_push_title` calls it "Family"; pushes follow the existing rules, so Family with a phone
     saved get notifications for this chat;
   - `family_chat_people()`.
   - `pick_site_photo` refuses Family chat photos ("Photos from the Family chat stay off the website."),
     and the website photo picker leaves them out: family members' photos stay in the club. They do
     show in members' own Photos feed, like every group chat;
   - `open_direct_chat` says "Family only use the Family chat, not private chats." to a member who tries.
   Unchanged and still members-only: moderation, report queues, private chats, photo feeds, ride walls,
   Catch me up, link previews (Family see links without the preview card).

## App

- `ChatKind` gets `family`; `readProblem`, `approvalProblem`, `blockProblem` mirror the database.
- `FamilyTabs` gets a Chat tab (the chat list, which for Family holds just Family); the Family stack
  gets the Chat, MediaViewer and PostingRules screens and notification taps.
- The chat list hides Photos and New private chat for Family; the chat screen gives Family a
  "Read the club rules" card in place of the composer until they agree, and doesn't link names to
  profiles.
- `forFamily` carries the names of the people in the Family chat (`chatPeople`), so names show.
- The demo gets a Family chat with a few messages, and Kerry (the demo's Family persona) sees it.

## Tests

`supabase/tests/family_chat_test.sql` (who reads, posts, reports, blocks, moderates; Introduced and
suspended shut out; Family see only their chat and only posters' names) and the app rules in
`src/domain/chat.test.ts`. `family_view_test.sql` is updated: Family now see exactly one chat.
