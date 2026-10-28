# Social extras (Stage 7, social): design

Written 27/10/2026 by Claude for the "Build the social extras" thread. Approved by Claude under
Jeff's standing call (AGENTS.md); Jeff can veto any part.

## Why

The brief's goal is "make the club fun again". Chat, photos and ride walls are live (Stage 3). The
social extras are the small reasons to open the app on a day with no ride: someone's birthday, a
photo from this day three years ago, a mate who can fix a stator, a set of panniers going cheap.

Who it's for: approved members (Introduced through Legacy). Nothing here is admin. Nothing is
posted to real members while the app is still secret: these are screens, not broadcasts. Push for
any of it waits for lane E's push to go on at launch.

## The nine items, phased

Classification: architectural (new tables, a new data provider). One PR each, in this order, so
each lands on its own and the cheap, high-joy ones come first.

| # | PR | What | Depends on |
|---|---|---|---|
| 1 | Shout-outs | Birthdays (opt-in day and month) and patch anniversaries, on Home | members, nothing new elsewhere |
| 2 | On this day | Photos posted on today's date in earlier years, on Home and Photos | Stage 3 photos (live) |
| 3 | Who can help | Members' skills ("I can help with…") and the club's trusted mechanics list | members |
| 4 | Swap and sell | Parts and gear listings with photos, message the seller | Stage 3 direct chat |
| 5 | Build threads | Updates with photos on a project bike in someone's garage | bikes (`is_project`) |
| 6 | History and hall of fame | Club timeline and honours, board-kept; founders and past office holders filled in automatically | positions |
| 7 | Bragging rights | Yearly awards: ride of the year, best photo, best breakdown story. Members nominate, then vote | rides, photos |
| 8 | Voice notes | Hold-free record, send in chat, play back | Stage 3 chat; a new native module (expo-audio), so a new dev build |
| 9 | Badges | Big 4s done, states ridden, kms logged | the attendance and Big 4 thread (in progress now) |

Badges go last because the Big 4 rule is being built in another thread right now. Voice notes go
late because they add a native module and change a chat function (lane B is merged, so that's
allowed, but it needs a new development build before anyone can try it on a phone).

## How it's built (all PRs)

- **Its own provider.** Social data sits in `src/data/social/`, the same shape as chat:
  `socialContext.ts` (what screens can ask), `DemoSocialProvider.tsx` (made-up data in memory) and
  `LiveSocialProvider.tsx` (Supabase), chosen by `SocialProvider.tsx`. It sits inside
  `ChatProvider` in `App.tsx`. This keeps the shared files (`ClubData`, `clubContext`,
  `LiveClubProvider`, `demoActions`) untouched, so the five other threads working right now rebase
  cleanly. Shared files are touched only to add one block each: `App.tsx`, `RootNavigator.tsx`,
  `navigation/types.ts`, `PRODUCT.md`, `DESIGN.md`.
- **Rules** in `src/domain/social/<topic>.ts` with tests beside them. The database's actions use the
  same refusals in the same words and order, as everywhere else.
- **Migrations** use the prefix `20270415` (set by the coordinator, noted in
  `build/parallel-stages.md`). New tables and functions only, never `drop` or `delete from`. Every
  table has RLS on, no direct writes through the API, and writes go through `security definer`
  actions. Each PR's migration is also written as a paste file under
  `/mnt/project-files/build/social/` for Jeff's next PC session; nothing goes live from here.
- **Reached from existing screens**, not the tab bar (lane B owns it): Home cards, rows on Members,
  Me and Photos.
- **Type and design** follow DESIGN.md: stencil for names, dates, numbers, chips and buttons; plain
  body only for sentences and typing. No `Alert`.

## PR 1: Shout-outs

**What members see.** A "Shout-outs" card on Home, below the check-in and fees cards, when anyone
has a birthday or patch anniversary today or in the next 6 days. Today's people come first with a
red "Today" chip; tomorrow says "Tomorrow" and the rest show their day ("Thu 30/10"). Each row: avatar, name, what it is
("Birthday", "3 years patched"), and taps through to the member. Today's rows have a "Say g'day"
button that opens a private chat with them (the existing `openDirect`), so nothing is posted for
them. With nobody in the window, the card doesn't show.

**Birthdays are opt-in.** Only the day and month are kept, never the year. A member adds theirs
from Me ("Birthday shout-out" row) on a small screen with a day and month picker, and can take it
off again. The screen says who sees it: "Members see your birthday (day and month only) on Home."

**Patch anniversaries** come from `patchedOn`, for members who are Full or Nomad now (Legacy keeps
the date but isn't patched any more, so no shout-out). The first anniversary is 1 year; the day of
patching itself isn't one.

**Rules** (`src/domain/social/shoutouts.ts`):
- `shoutoutsFor(viewer, members, birthdays, today, days = 7)` returns the list in order (date, then
  today's birthdays before anniversaries, then name). Only approved members the viewer can see
  (`visibleMembers`). The viewer's own day shows too, named "You" and with no "Say g'day" button:
  the app wishing you happy birthday is half the fun.
- 29 February birthdays show on 28 February in other years. A patch date of 29 February is the
  same.
- `birthdayProblem(day, month)`: "Pick a day and a month." / "That day isn't in that month."
  (29/02 is allowed.)

**Database** (`20270415000000_shoutouts.sql`):
- `public.member_birthdays (member_id uuid pk references members on delete cascade, month smallint
  1..12 or null, day smallint 1..31 or null, set_at timestamptz)`, with a check that the day exists in the month in
  a leap year.
- RLS: approved members read every row; no writes through the API.
- `public.set_birthday(p_month int, p_day int)`: approved members only. Two nulls take it off: the
  row stays with `month` and `day` null, meaning "not shared", which keeps `delete from` out of the
  file so Jeff's paste goes through without the confirm prompt.
- Reads are a plain `select` on the table; no read function is needed.

**Demo:** a few demo members get birthdays and patch dates that fall today and this week, worked
out from the demo's today, so the card always shows in the preview.

**Tests:** domain tests for the window, ordering, leap day, self, hidden members, Legacy and FNG
(no anniversary); SQL tests for who can read, who can set, the refusals and their order, and that
nothing is writable directly.

## PR 2: On this day

**What members see.** When there are photos or videos posted on today's day and month in an
earlier year, Home shows an "On this day" card: "A year ago" (or just the day, "28/10", when there
are several years), the newest three as squares, tap one to open the viewer, and "See all" for a
screen of them grouped by year ("3 years ago · 28/10/2023"). No photos, no card. (The Photos screen
is lane B's and stays as it is; the Home card's "See all" is the way in.)

**Rules:** the same chats you can read, never private chats, never removed messages, never GIFs,
never from people you've blocked: exactly `club_photos`' rules. Dates are Melbourne dates. 29
February photos show on 28 February in other years.

**Database** (`20270415000100_on_this_day.sql`): `public.photos_on_this_day()` returning the same
JSON shape as `club_photos`, newest first, from at most 60 messages. Read-only, approved members only,
`security definer`, built on `private.media_json` and `private.can_read_chat`.

**Demo:** a handful of demo photos dated on today's date one and three years back.

## PR 3: Who can help

**What members see.** A "Who can help?" row on the Members tab opens a screen with two parts.

- **Members who can help:** chips for each skill; pick one and see the members who ticked it,
  your own chapter first, then by name. Tap one to open their profile (which has Message).
  Members tick their own skills from Me ("I can help with"). The skills, in the club's words:
  Servicing, Tyres, Electrics, Carbs and fuel, Diagnostics, Welding and fab, Paint and bodywork,
  Wheels and spokes, Suspension, Trailer or ute (recovery), Tools to lend.
- **Trusted mechanics:** workshops members recommend: name, suburb, phone, website, what
  they're good at, and a note. Each shows "Used by 4 members" and an "I've used them" toggle.
  Tap the phone to call, the website to open it. Any approved member adds one; whoever added it
  or any board member or the NEC edits it or takes it off the list (it's archived, never deleted).

**Rules** (`src/domain/social/help.ts`), refusals in these words and this order, the same in the
database:
- Everything: 'Sign in first.', then 'Only approved members can do that.'
- Skills: 'That isn’t one of the skills.' for anything not on the list (duplicates are ignored).
- Mechanic: name trimmed, 1 to 80 characters ('Give the workshop a name.', 'Keep the name to 80
  characters at most.'); suburb up to 60, phone up to 30, website up to 200 and must start
  with http:// or https:// ('Websites start with http:// or https://.'), speciality up to 80,
  notes up to 500 ('Keep the <field> to N characters at most.'). Blanks are stored as none.
- Editing or archiving: 'No such workshop.', then 'Only whoever added it or the board can change
  it.'; archiving twice: 'That workshop is already off the list.' An archived workshop can't be
  edited or vouched for: 'That workshop is off the list.'
- Vouching: any approved member, on a listed workshop; toggling twice takes it back.

**Database** (`20270415000200_who_can_help.sql`): a `help_skill` enum; `member_skills (member_id
pk, skills help_skill[])`, one row per member holding their list; `mechanics`; and
`mechanic_vouches (mechanic_id, member_id, vouched boolean)`. Changing your skills or taking back
a vouch is an update, so nothing is ever deleted and the paste file needs no `delete from`. RLS:
approved members read all three (skills of approved members only); nobody writes directly.
Actions: `set_skills(skills[])`, `save_mechanic(id, name, suburb, phone, website, speciality,
notes)` (a null id adds one), `archive_mechanic(id)`, `vouch_mechanic(id, on)`.
`private.is_any_board()` (lane B's) is the board-or-NEC rule, and the app mirrors it.

**Demo:** a handful of demo members with skills, and four made-up workshops (clearly fictional
names and 04xx 555 numbers).

## PR 4: Swap and sell

**What members see.** A "Swap and sell" row on the Members tab, under Who can help. The screen
lists open listings newest first as cards: first photo, title in stencil, the price ("$250",
"Swap", "Free" or "Wanted") as a chip, the seller's name and chapter, and the date listed. Filter
chips across the top: All, For sale, Swap, Free, Wanted. Below the open ones, "Recently sold" shows
what went in the last 30 days, greyed with a "Sold" chip. A listing's screen shows its photos
(swipe through), price, details, seller, and a "Message the seller" button that opens a private
chat with them (the app never writes the message). The seller sees Edit, "Mark as sold" (or "Put
back on") and "Take it down" (ConfirmButton); a board member sees "Take it down" on anyone's.
"List something" (button at the top) opens the form: kind (For sale, Swap, Free, Wanted), title,
price (for sale only), details, up to 6 photos from the library or camera.

**Rules** (`src/domain/social/swap.ts`, mirrored in the database, same words, same order):
- Sign in first; only approved members can do that; then:
- 'Pick what kind of listing it is.' (kind not one of sell, swap, free, wanted)
- 'Give it a title.' / 'Keep the title to 80 characters at most.'
- 'Put a price on it, in whole dollars.' (sell needs a whole-dollar price from 1 to 100,000; the
  others have no price, and a price sent with them is ignored)
- 'Keep the details to 1,000 characters at most.'
- 'Up to 6 photos.'
- 'That photo didn’t upload properly. Try again.' (each photo in the seller's own folder of the
  swap-media bucket, uploaded by them, not used by another listing, not twice)
- Changing: 'No such listing.', then 'Only whoever listed it can change it.', then 'That listing
  has been taken down.'. Taking down: whoever listed it or any board member; 'That listing has
  already been taken down.'. Marking sold or back on: only whoever listed it.
- Nothing is deleted: taking down sets taken_down_at and taken_down_by. Photos stay in storage.
- Approved members read listings by approved sellers that aren't taken down; a seller who is
  suspended disappears from the list. Blocked members' listings are hidden in the app (like chat).

**Database** (`20270415000300_swap_and_sell.sql`): `listing_kind` enum; `listings` (seller_id,
kind, title, price_dollars, details, listed_at, sold_at, taken_down_at, taken_down_by, with
checks); `listing_photos` (listing_id, position, path unique, width, height); a private
`swap-media` bucket (images only, 10 MB) with upload into your own `<member id>/` folder and read
for approved members; functions `save_listing(uuid, text, text, int, text, jsonb)` returning the
id (a null id adds), `mark_listing_sold(uuid, boolean)`, `take_down_listing(uuid)`. No drop, no
delete.

**Demo.** Six made-up listings across the kinds with photos from the demo's own assets, one
recently sold, one by the demo member so Edit and Mark as sold can be tried.

**Tests.** Domain rules (each refusal, the order, the price rule), demo actions, liveSocial row
mapping, parity cases for every refusal and success, and SQL tests for RLS (suspended seller
hidden, taken-down hidden), storage folder checks, and who can change what.

## PR 5: Garage build threads

**What members see.** A "Garage builds" row on the Members tab, under Swap and sell. The screen
lists project bikes (bikes marked "project" in someone's garage) that have at least one update,
the one updated most recently first. Each card shows the latest photo, the bike (nickname in
stencil, or make and model), the owner, how many updates, and the date of the last one. A bike's
build screen shows its updates newest first: date in stencil, words, and up to 4 photos each.
The owner sees "Post an update" (words and/or photos) and can take down their own update
(ConfirmButton); the board can take down anyone's. Members can't comment here; "Message the
owner" opens a private chat. Your own project bikes sit at the top under "Your projects", so a
build can be started before its first update (the garage screens on Me stay as they are).

**Rules** (`src/domain/social/builds.ts`, mirrored by the database, same words, same order):
- Sign in first; only approved members can do that; then:
- 'No such bike.'; 'Only the bike’s owner can post on its build.'; 'Build threads are for
  project bikes. Mark it as a project in your garage first.'
- 'Write something or add a photo.'; 'Keep it to 2,000 characters at most.'; 'Up to 4 photos.';
  'That photo didn’t upload properly. Try again.' (in your own folder of the build-media bucket,
  uploaded by you, on no other update, not twice).
- Taking down: 'No such update.'; 'Only whoever posted it or the board can take it down.';
  'That update has already been taken down.'.
- Nothing is deleted: an update taken down keeps its row with who took it down.
- Approved members read updates on approved owners' bikes that aren't taken down. A bike that
  stops being a project keeps its thread, read-only (no new posts).

**Database** (`20270415000400_build_threads.sql`): `build_updates` (bike_id, author_id, body,
photos jsonb, posted_at, taken_down_at, taken_down_by); a private `build-media` bucket like
swap-media; functions `post_build_update(uuid, text, jsonb)` returning the id and
`take_down_build_update(uuid)`. No drop, no delete.

**Demo.** Two project bikes with a few updates each over the last months, one of them the demo
member's.

**Tests.** Domain rules, demo actions, row mapping, parity cases for each refusal, SQL tests for
RLS and the storage folder checks.

## PR 6: History and hall of fame

**What members see.** A "History and hall of fame" row in the Members tab's club card. The screen
has two parts, switched with stencil chips: **Timeline** and **Hall of fame**.

- **Timeline:** the club's story, oldest first, grouped under stencil year headings: each entry has
  its date (a full date, "March 2019", or just the year), a title in stencil and a few lines. The
  founding of the club (from the earliest founder position) heads it automatically.
- **Hall of fame:**
  - *Founders*, from the founder positions (nobody types these).
  - *Honours* kept by the board: life members, awards, anything the club wants remembered. Each
    names a member in the app or someone who isn't (a name typed in), the honour, the year, and
    an optional line.
  - *Past office holders*, from positions that have ended: role, name and years ("2019 to 2023"),
    grouped by role in the club's role order. Chapter roles show their chapter.

**Who keeps it.** Any board member (a chapter board seat or the NEC) adds and changes timeline
entries and honours, and can take one off (kept, archived). Everyone approved reads it.

**Rules** (`src/domain/social/history.ts`, mirrored by the database, same words, same order):
- Sign in first; only approved members can do that; 'Only the board can keep the club’s history.'
- Entries: 'No such entry.'; 'That entry has been taken off.'; 'Pick a date.' (a real ISO date,
  not in the future); 'Give it a title.'; 'Keep the title to 80 characters at most.'; 'Keep the
  story to 1,000 characters at most.'. A precision of day, month or year says how to show it.
- Honours: 'No such honour.'; 'That honour has been taken off.'; 'Pick a member or type a name.'
  (exactly one); 'No such member.'; 'Keep the name to 80 characters at most.'; 'Name the honour.';
  'Keep the honour to 60 characters at most.'; 'Pick a year from 2019 on.' (2019 to this year);
  'Keep the note to 300 characters at most.'.
- Taking off: 'That entry has already been taken off.' / 'That honour has already been taken off.'.

**Database** (`20270415000500_history.sql`): `club_history` (happened_on date, precision enum,
title, story, added_by, archived_at, archived_by), `club_honours` (member_id or name, honour, year,
note, added_by, archived_at, archived_by); RLS read for approved members (archived hidden);
functions `save_history_entry(uuid, text, text, text, text)` (date and precision as text, so a date that isn't real gets the app's words), `archive_history_entry(uuid)`,
`save_honour(uuid, uuid, text, text, int, text)`, `archive_honour(uuid)`. No drop, no delete.

**Demo.** A handful of made-up timeline entries from 2019 on and two honours, with the demo's
founders and past office holders coming from its positions.

**Tests.** Domain rules and the derived lists (founders, past office holders, year groups), demo
actions, row mapping, parity cases for each refusal, SQL tests for RLS and the board check.

## PR 7: Bragging rights

**What members see.** A "Bragging rights" row in the Members tab's social card. The screen lists
the awards that are open (taking nominations, or voting) and then past results, newest first.
- An **award** has a name ("Ride of the year 2026"), a kind (a ride, a photo or a story), the year it
  covers, the day nominations close and the day voting closes. Its phase comes from today:
  *nominating* until nominations close (that day included), *voting* until voting closes, then
  *closed*.
- **Nominating:** any approved member nominates up to three things per award. A ride award takes a
  club ride from that year that has already been ridden (each ride once); a photo award takes a
  title and one photo; a story award takes a title and the story. All take an optional reason.
  Whoever nominated something, or the board, can withdraw it while nominations are open.
- **Voting:** one vote per member per award, changeable until voting closes, never for your own
  nomination. Counts stay hidden while voting is open; you see only your own vote.
- **Closed:** each nomination shows its votes, the most votes on top with a stencil "Winner" chip
  (ties share it).

**Who runs it.** Any board member or the NEC opens an award and can take one off (kept, archived).

**Rules** (`src/domain/social/brag.ts`, mirrored by the database, same words, same order). Opening:
sign in; approved; 'Only the board can run awards.'; 'Pick what the award is for.'; 'Give the award
a name.' / 'Keep the name to 60 characters at most.'; 'Pick a year from 2019 on.' (to this year);
'Nominations close first, then voting, both from today on.'. Nominating: 'No such award.'; 'That
award has been taken off.'; 'Nominations are closed.'; 'Three nominations each per award.'; then by
kind ('Pick a ride.', 'Pick a ride from that year that’s been ridden.', 'That ride is already
nominated.' / 'Give it a title.', 'Keep the title to 80 characters at most.', 'Add a photo.', 'That
photo didn’t upload properly. Try again.' / 'Tell the story.', 'Keep the story to 1,000 characters
at most.'); 'Keep the reason to 300 characters at most.'. Withdrawing: 'No such nomination.'; 'Only
whoever nominated it or the board can withdraw it.'; 'Nominations are closed.'; 'That nomination has
already been withdrawn.'. Voting: 'No such nomination.'; 'Voting isn’t open.'; 'You can’t vote for
your own nomination.'.

**Database** (`20270415000600_bragging_rights.sql`): `brag_awards`, `brag_nominations` (ride, or
title + photo jsonb, or title + story; reason; withdrawn_at/by), `brag_votes` (one row per award and
member, primary key, changed in place); a `brag-media` bucket like build-media. RLS: approved members
read awards that aren't archived and nominations that aren't withdrawn; each member reads only
their own votes. `brag_tallies()` (definer) gives vote counts for closed awards only. Functions
`open_award`, `archive_award`, `nominate`, `withdraw_nomination`, `cast_brag_vote`. No drop, no
delete.

**Demo.** Ride of the year (voting open, three rides), Best breakdown story (taking nominations)
and last year's Best photo (closed, with a winner), dated from the demo's today.

**Tests.** Domain rules and phases, demo actions, row mapping, parity cases for each refusal, SQL
tests for RLS (votes private, tallies only once closed) and the photo bucket.

## PR 8: Voice notes

**What members see.** In any chat, when the message box is empty and nothing is attached, the send
button becomes a microphone. One tap starts recording (no holding down, which is hard with gloves
and impossible for some): the composer turns into a recording bar with a red dot, the time so far
and the limit ("0:07 / 2:00", stencil), a bin button to throw it away and a send button. Recording
stops by itself at two minutes and waits to be sent or thrown away. A voice note goes on its own,
like a GIF in most chat apps: no words or photos with it. In the chat it shows as a bubble with a
44pt play/pause button, a progress bar and its length. The chat list, the pinned bar and reply
quotes say "Voice note". Voice notes never show in Photos, ride walls or On this day. If the
microphone is refused, the error bar says to turn it on in the phone's settings.

**Rules** (`src/domain/chat.ts`, mirrored by `send_message`, same words, same order, after the
existing checks): 'A voice note goes on its own.' (a voice note with words or any other media);
'That voice note didn’t record properly. Try again.' (no length, or under a millisecond); 'Voice
notes can be up to 2 minutes.' (over 120,000 ms). The database also checks the file like a photo
(in the chat's folder, uploaded by the sender, not used before, no still) and that it's an `.m4a`
or `.webm` file, and that a file storage knows to be a recording goes in only as a voice note (and a
voice note only as a recording). Reports carry a reported voice note's recording so a moderator can
listen to it.

**Recording.** `expo-audio` (SDK 58, `npx expo install expo-audio`), `RecordingPresets.HIGH_QUALITY`
(AAC in `.m4a` on phones; WebM, or MP4 on Safari, on the web). The length comes from the recorder,
not the file, because Chrome's WebM files carry no length. Phones upload as `audio/mp4`, the web as
the recording's own type. Adds a native module, so voice notes need a new development or store
build; the `fingerprint` runtime policy keeps over-the-air updates off older builds.

**Database** (`20270415000700_voice_notes.sql`, additive): `alter type chat_media_kind add value
'voice'`; the chat-media bucket also takes `audio/mp4` and `audio/webm`; `send_message` is replaced
with the voice rules; `club_photos`, `ride_walls`, `ride_wall` and `photos_on_this_day` are replaced
so they take only photos and videos (they took everything but GIFs); `chat_list`'s newest message
also says whether it's a voice note. No new value is used outside function bodies, so the paste
runs in one go.

**Demo.** One voice note in the whole-club chat (a short spoken clip bundled with the app), and
recording works in the demo too (the note stays on the phone).

**Tests.** Domain rules, demo send, feeds leaving voice notes out, row mapping, parity cases for
each refusal (with an uploaded file in the fixture), SQL tests for the file checks, the feeds and
the chat list flag.

## PR 9

Gets its own short design section added to this file before it's built, following the same shape
(what members see, rules, database, demo, tests). The table above fixes the order and scope.
