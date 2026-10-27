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
earlier year, Home shows an "On this day" card: the year ("3 years ago · 28/10/2023"), a row of up
to 6 thumbnails, tap one to open the viewer, "See all" to open a list of them grouped by year. The
Photos screen gets the same strip at the top. No photos, no card.

**Rules:** the same chats you can read, never private chats, never removed messages, never GIFs,
never from people you've blocked: exactly `club_photos`' rules. Dates are Melbourne dates. 29
February photos show on 28 February in other years.

**Database** (`20270415000100_on_this_day.sql`): `public.photos_on_this_day()` returning the same
JSON shape as `club_photos`, newest year first, at most 60 items. Read-only, approved members only,
`security definer`, built on `private.media_json` and `private.can_read_chat`.

**Demo:** a handful of demo photos dated on today's date one and three years back.

## PRs 3 to 9

Each gets its own short design section added to this file before it's built, following the same
shape (what members see, rules, database, demo, tests). The table above fixes the order and scope.
