# Chat, photos and ride walls (Stage 3)

**Type:** architectural (new tables, file storage, live updates, a new tab). Lane B of the
parallel build (`/mnt/project-files/build/parallel-stages.md`). Claude approved this spec on
24 Oct 2026 under Jeff's self-approval rule. Jeff can veto any line.

## Goal
Chat as easy as Messenger, in the club's own app: a **whole-club chat**, a **chat per chapter**,
a **chat per ride** that tidies itself away afterwards, and **private chats** between two members.
Photos and short videos go into any chat. Every ride gets a **ride wall**: the album of photos
and videos posted to that ride. A **Photos** screen shows everything you can see, newest first,
plus the ride walls. Success means the club could stop using the Messenger group.

## What's in, and what isn't
In: text messages with tappable links, photos, videos up to 60 seconds, reactions, removing a
message, unread counts, live updates while the app is open, ride walls, the Photos screen.

Not in this spec:
- **Board chat.** It belongs to the board room (Stage 5, lane D). The tables here take a new
  chat kind without change, so lane D adds `board` with one `alter type ... add value`.
- **Push notifications and the phone's share button** (Stage 6, lane E). Unread counts show in
  the app only.
- **Voice notes and GIFs.** GIFs need a GIF service key (Tenor or GIPHY), which is Jeff's call;
  voice notes can follow once chat has settled in. Both slot into the media table later.
- **Group private chats** (three or more people), editing a sent message, muting, typing dots,
  read receipts. Can follow if members ask.
- **Family's limited views** (Stage 7). Until then every approved member is treated alike, as
  everywhere else in the app.

## Who sees what (mirrored in `src/domain/chat.ts` and row-level security)
Only **approved** members (any status, Legacy included) can see or use chat. Applicants, the
public and anyone suspended see nothing.

| Chat | Who can read and post | Who can remove other people's messages |
|---|---|---|
| Whole club | every approved member | any board member or the NEC |
| West / North chapter | that chapter's members, plus the NEC | that chapter's board, plus the NEC |
| A ride's chat | every approved member (rides are club-wide) | any board member or the NEC |
| Private | the two people in it | nobody (each removes their own) |

- Everyone can remove their own messages. A removed message shows as "Message removed", and its
  photos and videos stop being served straight away.
- A private chat is between two different approved members. Opening one with someone you
  already have one with goes back to the same chat.
- **Ride chats tidy themselves away:** a ride's chat shows in your chat list from 7 days before
  the ride to 3 days after its last day, if you said Going or Maybe. It's always reachable from
  the ride screen and its ride wall, and its photos stay on the ride wall for good.
- Reactions: one tap on 👍 ❤️ 😂 🔥 🍺 😮 toggles yours on a message you can see.
- Limits: 4,000 characters, up to 10 photos or videos per message. A message needs words or at
  least one photo or video.

*Inferred, for Jeff to veto:* the NEC reads both chapter chats; members can't read the other
chapter's chat; a board member of either chapter can tidy the whole-club and ride chats.

## Data (migration `20261101000000_chat.sql`, own files only)
- `public.chat_kind` enum: `club`, `chapter`, `ride`, `direct`.
- `public.conversations`: `id`, `kind`, `chapter_id` (chapter chats), `ride_id` (ride chats),
  `created_at`. One club chat; one chat per chapter (made by a trigger when a chapter is
  added, and backfilled); ride chats made the first time someone opens them; private chats
  made by `open_direct_chat`.
- `public.conversation_members` (`conversation_id`, `member_id`): only for private chats.
- `public.messages`: `id`, `conversation_id`, `author_id`, `body`, `created_at`, `updated_at`
  (bumped by reactions and removal, so one live feed covers everything), `removed_at`,
  `removed_by`.
- `public.message_media`: `id`, `message_id`, `conversation_id`, `kind` (`photo`, `video`),
  `path` (in the `chat-media` bucket), `poster_path` (a video's still), `width`, `height`,
  `duration_ms`, `position`.
- `public.message_reactions` (`message_id`, `member_id`, `emoji`).
- `public.chat_reads` (`conversation_id`, `member_id`, `read_at`) for unread counts.
- Storage bucket **`chat-media`**: private, 50 MB a file (the free plan's cap), images and
  video only. Files sit at `<conversation id>/<uuid>.<ext>`. You can upload only into a chat
  you can post to, and read a file only when it belongs to a message you can see that hasn't
  been removed (or it's your own upload that hasn't been sent yet).
- Every table: row-level security on, select-only for members through
  `private.can_read_chat(conversation)`; nothing is written through the API directly. All
  writes go through actions that check the rules above, with the demo's exact words:
  `send_message`, `remove_message`, `toggle_reaction`, `open_direct_chat`, `ride_chat`,
  `mark_chat_read`.
- Reads: `chat_list()` (your chats with their last message and unread count, ride chats per the
  window above), messages by page of 40 through the API, `club_photos(before)` (photos and
  videos from the club, chapter and ride chats you can see, newest first, never private ones),
  `ride_walls()` (rides with photos, newest ride first, with a cover and a count) and
  `ride_wall(ride)`.
- `public.messages` joins the `supabase_realtime` publication, so the app hears new and changed
  messages live. Realtime applies the same row-level security.

## App
- **Data:** chat gets its own provider (`src/data/chat/`), separate from the club data, with a
  demo version (in memory, the same rules, checked by shared demo/database cases) and a live
  version (Supabase, live updates, signed links for photos cached for an hour). The `ClubData`
  shape doesn't change.
- **Photos and videos:** picked with `expo-image-picker` (library, or the camera). Photos are
  resized to 2048 px on the long edge and saved as JPEG (`expo-image-manipulator`) before upload,
  so a photo is about half a megabyte. Videos are capped at 60 seconds and 50 MB, and get a
  still from `expo-video` for the grid. Videos play with `expo-video`. Images show with
  `expo-image`, which caches them.
- **Screens** (`src/screens/chat.tsx`, `src/screens/photos.tsx`):
  - **Chat tab**, after Home. A "Photos" strip of the latest few at the top, then your chats:
    Whole club, your chapter, ride chats in their window, then private chats by latest message.
    Each row has the name in stencil, the last line, the time, and an unread count. A "New
    message" button picks a member. The tab shows your total unread count.
  - **Chat screen:** messages newest at the bottom, grouped by day ("Today", "Yesterday",
    DD/MM/YYYY) and by sender. Photos sit in a grid in the bubble, and tap through to full
    screen. Tap a message for its reactions bar and, where allowed, Remove (tap twice, no
    pop-ups). The composer has the photo button, the text box and Send. Older messages load as
    you scroll up.
  - **Photos screen:** "Latest" (a three-across grid) and "Ride walls" (rides with photos, cover
    and count).
  - **Ride wall:** the ride's name and date, its grid, "Add photos", and a link to the ride chat.
  - **Viewer:** full screen, swipe between items, who posted it and when, video with controls.
  - **Entry points elsewhere** (one small block each): "Message" on a member's screen, and
    "Ride chat" and "Ride wall" rows on the ride screen.
- **Tab bar:** Home, Chat, Rides, Members, Board (board holders only), Me. Six tabs for board
  holders fit at 390 wide with the current 11.5 stencil labels.

## Storage on the free plan
The Supabase project is on the free plan: 1 GB of files and a 50 MB cap on each file. Resized
photos fit about two thousand to the gigabyte; a minute of phone video can be 30 to 100 MB, so
video is what fills it. The app says plainly when an upload is refused for size or space. When
it fills up, the Pro plan (US$25 a month, 100 GB) is Jeff's call, since it costs money.

## Tests
- **`npm test`:** the chat rules (who reads, posts and removes, per kind), the ride chat window,
  the reaction set, message limits, the chat list order and unread sums, day and sender grouping
  in Melbourne time, link finding, and the media checks (type, size, length).
- **`npm run test:db`** (`supabase/tests/chat_test.sql`): who can read each kind of chat and its
  files, that nothing is writable directly, each action's rules, the chapter-chat trigger, the
  ride chat window in `chat_list()`, unread counts, and that `club_photos()` never includes
  private chats or removed messages.
- **Shared demo/database cases** (`parity.json`): sending, removing, reacting and opening
  private chats, allowed and refused, with the same words.
- A look at the Chat, chat, Photos, ride wall and viewer screens at 390×844 in the demo and live
  builds, plus Impeccable's critique, audit and polish passes.

## Before it can go live
- Merge first, then apply the migration and create the bucket in the live project, one lane at a
  time per the Live log. No `drop` in anything applied live.
- A new native build (EAS) for the image picker, image manipulator, image and video modules and
  their permission wording. Building is fine without asking; sending it to testers is part of
  the test crew plan.
- Nobody is told about it until the app is finished.
