# Chat, photos and ride walls (Stage 3)

**Type:** architectural (new tables, file storage, live updates, a new tab). Lane B of the
parallel build (`/mnt/project-files/build/parallel-stages.md`). Claude approved this spec on
24 Oct 2026 under Jeff's self-approval rule. Jeff can veto any line.

## Goal
Chat as easy as Messenger, in the club's own app: a **whole-club chat**, a **chat per chapter**,
a **ride committee chat**, a **chat per ride** that tidies itself away afterwards, and **private
chats** between two members.
Photos and short videos go into any chat. Every ride gets a **ride wall**: the album of photos
and videos posted to that ride. A **Photos** screen shows everything you can see, newest first,
plus the ride walls. Success means the club could stop using the Messenger group and the Discord.

**From the club Discord (deep dive, 24 Oct 2026):** 25 channels for about 30 people, most of them
empty, and members posting in the wrong one is what makes it hard. What gets used: daily banter in
one general chat, replies to a message, reactions, GIFs, a photo forum with one post per ride,
the ride committee's planning, pinned announcements, and ranks typed into display names. So the
app keeps a short fixed list of chats that people join automatically, and adds replies, pins and
ranks beside names.

## What's in, and what isn't
In: text messages with tappable links, photos, videos up to 60 seconds, replies to a message,
reactions, pinning a message, removing a message, reporting a message and blocking a member (both
required by Apple and Google for apps where people post), unread counts, live updates while the app
is open, ranks and positions beside names, ride walls, the Photos screen.

Not in this spec:
- **Board chat.** It belongs to the board room (Stage 5, lane D). The tables here take a new
  chat kind without change, so lane D adds `board` with one `alter type ... add value`.
- **Push notifications and the phone's share button** (Stage 6, lane E). Unread counts show in
  the app only.
- **Voice notes and GIFs.** GIFs need a GIF service key (Tenor or GIPHY), which is Jeff's call;
  voice notes can follow once chat has settled in. Both slot into the media table later.
- **@mentions** (they need notifications to be worth it, Stage 6), link previews, threads (the
  board room), live voice on rides (Stage 6), and the Discord's invite-only adult channel (store
  rules don't allow it in the app).
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
| Ride committee | Road Captains and the Ride Committee (any chapter), plus the NEC | the NEC, and any board member in it |
| A ride's chat | every approved member (rides are club-wide) | any board member or the NEC |
| Private | the two people in it | nobody (each removes their own) |

- Everyone can remove their own messages. A removed message shows as "Message removed", and its
  photos and videos stop being served straight away.
- A private chat is between two different approved members. Opening one with someone you
  already have one with goes back to the same chat.
- **Ride chats tidy themselves away:** a ride's chat shows in your chat list from 7 days before
  the ride to 3 days after its last day, if you said Going or Maybe. It's always reachable from
  the ride screen and its ride wall, and its photos stay on the ride wall for good.
- **Replies:** a message can answer an earlier one in the same chat; the quote shows above it
  ("Message removed" if the earlier one has gone).
- **Pins:** whoever can remove other people's messages in a chat can pin one message to its top,
  or take it down. Private chats have no pins.
- **Reports:** anyone can report a message in a chat they can read, with an optional reason. The
  people who can remove messages in that chat see open reports, and remove the message or dismiss
  the report. A private chat's reports go to the reporter's chapter board.
- **Blocks:** you can block a member. Their messages and photos stop showing for you everywhere,
  and neither of you can send in your private chat. Only you see who you've blocked, and you can
  unblock them.
- Reactions: one tap on 👍 ❤️ 😂 🔥 🍺 😮 toggles yours on a message you can see.
- Limits: 4,000 characters, up to 10 photos or videos per message. A message needs words or at
  least one photo or video.

*Inferred, for Jeff to veto:* the NEC reads both chapter chats; members can't read the other
chapter's chat; a board member of either chapter can tidy the whole-club and ride chats.

## Data (migration `20261101000000_chat.sql`, own files only)
- `public.chat_kind` enum: `club`, `chapter`, `committee`, `ride`, `direct`. The one committee chat
  so far is the ride committee (`committee = 'ride'`, a `public.chat_committee` enum).
- `public.conversations`: `id`, `kind`, `chapter_id` (chapter chats), `ride_id` (ride chats),
  `committee`, `pinned_message_id`, `created_at`. One club chat; one chat per chapter (made by a trigger when a chapter is
  added, and backfilled); ride chats made the first time someone opens them; private chats
  made by `open_direct_chat`.
- `public.conversation_members` (`conversation_id`, `member_id`): only for private chats.
- `public.messages`: `id`, `conversation_id`, `author_id`, `body`, `created_at`, `updated_at`
  (bumped by reactions and removal, so one live feed covers everything), `removed_at`,
  `removed_by`.
- `public.message_media`: `id`, `message_id`, `conversation_id`, `kind` (`photo`, `video`),
  `path` (in the `chat-media` bucket), `poster_path` (a video's still), `width`, `height`,
  `duration_ms`, `position`.
- `public.messages.reply_to_id` (a message in the same chat).
- `public.message_reports` (`id`, `message_id`, `reporter_id`, `reason`, `created_at`,
  `resolved_at`, `resolved_by`, `outcome` `removed`/`dismissed`).
- `public.member_blocks` (`blocker_id`, `blocked_id`): each person sees only their own.
- `public.message_reactions` (`message_id`, `member_id`, `emoji`).
- `public.chat_reads` (`conversation_id`, `member_id`, `read_at`) for unread counts.
- Storage bucket **`chat-media`**: private, 50 MB a file (the free plan's cap), images and
  video only. Files sit at `<conversation id>/<uuid>.<ext>`. You can upload only into a chat
  you can post to, and read a file only when it belongs to a message you can see that hasn't
  been removed (or it's your own upload that hasn't been sent yet).
- Every table: row-level security on, select-only for members through
  `private.can_read_chat(conversation)`; nothing is written through the API directly. All
  writes go through actions that check the rules above, with the demo's exact words:
  `send_message` (with an optional reply), `remove_message`, `toggle_reaction`, `pin_message`,
  `report_message`, `resolve_report`, `set_block`, `open_direct_chat`, `ride_chat`, `mark_chat_read`.
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
    message" button picks a member. The tab shows your total unread count. Moderators see a row
    for open reports above the list.
  - **Chat screen:** messages newest at the bottom, grouped by day ("Today", "Yesterday",
    DD/MM/YYYY) and by sender, with each sender's rank or position on a chip beside their name.
    A pinned message sits at the top. Photos sit in a grid in the bubble, and tap through to full
    screen. Tap a message for its reactions bar, Reply, Report, and where allowed Pin and Remove
    (tap twice, no pop-ups). Block is on the member's screen. The composer has the photo button, the text box and Send. Older messages load as
    you scroll up.
  - **Photos screen:** "Latest" (a three-across grid) and "Ride walls" (rides with photos, cover
    and count).
  - **Ride wall:** the ride's name and date, its grid, "Add photos", and a link to the ride chat.
  - **Viewer:** full screen, swipe between items, who posted it and when, video with controls.
  - **Entry points elsewhere** (one small block each): "Message" on a member's screen, and
    "Ride chat" and "Ride wall" rows on the ride screen.
- **Reports screen** for moderators: the reported message, who reported it and why, with Remove
  and Dismiss.
- **Tab bar:** Home, Chat, Rides, Members, Board (board holders only), Me. Six tabs for board
  holders fit at 390 wide with the current 11.5 stencil labels.

## Storage on the free plan
The Supabase project is on the free plan: 1 GB of files and a 50 MB cap on each file. Resized
photos fit about two thousand to the gigabyte; a minute of phone video can be 30 to 100 MB, so
video is what fills it. The app says plainly when an upload is refused for size or space. When
it fills up, the Pro plan (US$25 a month, 100 GB) is Jeff's call, since it costs money.

## Tests
- **`npm test`:** the chat rules (who reads, posts, removes, pins and sees reports, per kind;
  replies within a chat; blocks), the ride chat window,
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

## Additions from Jeff, 24 Oct 2026 (after the Discord deep dive)
Jeff: "nec chat and big table chats for each chapter are important", "filth can go away", "we can
have charity commitee member as an extra title on top of club title", "gifs and links are a big
part of how we do banter", and Messenger is the main contact today: "we want something easier to
manage". These replace the "Not in this spec" lines about board chat, GIFs and link previews.

- **More chats that pick their own people** (`chat_kind` gains `board` and `nec`; `chat_committee`
  gains `charity`):

  | Chat | Who reads and posts | Who removes others' messages |
  |---|---|---|
  | West / North big table | that chapter's board, plus the NEC | the same people |
  | NEC | the NEC (National officers and sitting Presidents) | the same people |
  | Charity committee | Charity Committee members (any chapter), plus the NEC | the NEC, and any board member in it |

  The board room (Stage 5, lane D) is meetings, agendas, minutes and votes, with no chat of its
  own, so these chats are the board's place to talk (lane D agreed).
- **Charity Committee position** (`charity_committee` in `position_role`, its own migration so the
  new value is committed before use). A non-board club position, appointed like Tail Gunner, held
  on top of any rank or other position.
- **GIFs:** a GIF button in the composer opens GIPHY search (trending when the box is empty). Google
  shut the Tenor API on 30 June 2026, so GIPHY it is. GIPHY asks that searches come from the app
  itself, so the app carries GIPHY's app key (`EXPO_PUBLIC_GIPHY_KEY`, made to ship in apps, like
  the publishable Supabase key). A GIF goes in as media `kind = 'gif'` holding GIPHY's https
  address (only `media*.giphy.com` and `i.giphy.com`, checked by the database), sizes included.
  Rated up to R. GIFs stay out of the Photos feed and ride walls. "Powered by GIPHY" shows in the
  picker. The free key allows about 100 searches an hour for the whole club; a production key is
  GIPHY's call (they may charge). Making the key needs Jeff's yes, asked once at the end. Until
  then the GIF button says GIFs aren't switched on yet.
- **Link previews:** the first link in a message shows a card (site, title, short description,
  picture), from an Edge Function `link-preview` that reads the page's Open Graph tags and keeps
  them for 7 days in `private.link_previews`. It only fetches public http(s) addresses (no IP
  literals in private ranges, no localhost), stops after 5 seconds or 512 KB, and reads HTML only.
  Links stay tappable whether or not a card comes back.
- **The pitch to members:** nobody manages member lists. Approval, positions and leaving decide
  who's in which chat, the moment they change.
- **People who might join** (Introduced, approved in the app; Jeff picked this on 24 Oct): the
  whole-club chat and ride chats only. Chapter, big table, NEC, committee and private chats open
  at FNG. Their words: "Chapter chats open up once you’re an FNG.", "That chat opens up once you’re
  an FNG.", "Private chats open up once you’re an FNG." and, for a member trying to message them,
  "They can’t get private messages until they’re an FNG."
- **Ride comms (voice while riding) is not in this stage.** Jeff wants it: open mic (hands stay on
  the bars), headset button to mute, one big Connect and one big Disconnect. It needs a voice
  service account, so it went to Stage 6 live ride mode (lane E told).
