# The demo club's dates follow today

Date: 14/11/2026. Kind: architectural (the demo data module becomes a builder, seven other seed
files change, every test that reads the demo is re-pointed). Launch list job 24.
Approved by Claude under Jeff's 24 Oct rule; Jeff asked for the job by card on 14/11/2026 ("I
make the reviewer demo club's dates follow today's date, so Apple's reviewer never sees stale
dates").

This is the second version. The first was read by four independent critics (a builder, a calendar
skeptic, a tests skeptic and a store reviewer's eye). The core idea held over more than 6,000
test days. Their 55 points are folded in below; most were about the half of the demo that
already counted from today, which the first version wrongly treated as sound.

## Why

Apple's and Google's reviewers sign in to the built-in demo club (persona Spanner). Half of that
club was written with fixed dates around late October 2026, and the review day is unknown: it
depends on Apple enrolling the club, so it could be December or well into 2027.

On 14/11/2026 the fixed half has already gone off:

- The showpiece ride (West breakfast run: crew, route, briefing, stops) was on 08/11 and has left
  the Rides tab. After 13/02/2027 no fixed ride is left at all.
- All three open votes are past their closing time. Nobody can vote, and the rows still read
  "closes Wed 04/11".
- No meeting is coming up, every open action item is Late, and three meetings owe minutes.
- Spanner's own rego shows a red "Expired 08/11/2026" on Home. Every licence, rego and first aid
  date lapses one by one after that.
- Home's club news names "Saturday 15 November" and "Sunday 7 December" (wrong weekdays for 2026)
  and drops off Home altogether in late December (the 60-day rule).
- Chat lines say "Breakfast run on the 8th", "Toy Run's on the 28th", "Christmas ride".

The other half (check-ins, fees, Road Rules, Rusty Bus, books, documents, social) counts from
today, but has bad days of its own:

- From 1 January to 31 July, Spanner's and Torque's Home opens on a red "Overdue" fee.
- All of July the presented June report shows the Club fund at minus $291.40.
- On Saturdays the "banked late" sausage sizzle is not late by the app's own rule.
- Each August and early September Gravel's Supporter notice quotes a record with nothing wrong.
- On the 1st of a month, and from 1 to 16 August, more than forty "happened" stamps sit ahead
  of now.

No test notices any of this: almost every test pins its own "now" in October 2026, so the suite
is green while the demo is stale.

## Goals

1. On any day the demo is opened, every dated thing reads the way it was designed: coming-up
   things are coming up, open votes can be voted on, "due soon" is due soon, and the few things
   that are late on purpose are only a little late.
2. Words agree with dates. Nothing names a month, weekday, day of the month, season or year that
   the calendar beside it contradicts.
3. One clock for the whole demo, so two files can never disagree by a day.
4. Tests that would have caught this: one that builds the demo for many different days and walks
   every date in it, and one that stops a bare date or a date-word creeping back into a seed file.

## What is in, and what is not

In:

- (A) Anything that reads wrong depending on the day the demo is opened: stale, ahead of now, or
  broken by a turn of the year where the fix is cheap.
- (B) Date-words: a month, weekday, day, season or year in a string.

Not in:

- (C) Story contradictions that are the same on every day. They are listed under "Seen, not in
  this job".
- Any change to a rule in `src/domain/**`, to a screen, to a migration or to the live data path.
  Only demo seed data, its wiring and tests. (One sound file is re-made: see "The voice note".)
- The store pictures already on Google Play (and the iPhone sets waiting for Apple) are not
  retaken. Their recipe is updated so a later retake works.
- `app.json`, `package.json`, the lockfile and `.gitignore` are not touched, so the change stays
  inside the current update runtime.

## What must not happen

- Tests that pass or fail depending on the day they run.
- A "fix" that makes everything fresh. Some states are stale on purpose, are pinned by tests and
  are shown in store pictures: one Late action item (ai-2), one meeting with overdue minutes
  (mt-2), one expired rego (Gravel's), a closed vote (v-3), the declined and the unanswered bus
  requests (bus-4, bus-6), the overdue audit request (ar-2), the fee schedule overdue for review,
  the deposit banked late (le-6), Gravel's attendance notice.
- Moving a real-world date: the constitution's 25/10/2026, `TERMS_BEGAN`, the posting rules,
  privacy and Road Rules guide dates, the club's 2019 founding.
- A change of ids or of array order in the demo data (tests use `votes[0]`, `payments[0]`,
  `members[0]`).

## Approaches considered

**A. Story time, moved a week at a time (chosen).** Keep the fixed half as a readable story
written for one week (Sun 25/10/2026 to Sat 31/10/2026). When the demo is built, move every
"recent" date in the story forward by a whole number of weeks so the story sits in the current
week. Weekdays hold (Sunday rides, Wednesday meetings), the file stays readable, and building
it for the story week gives back today's data, so existing tests keep their pinned dates. Cost:
the story is seen from 0 to 6 days later than its first day, so every designed state has to
hold across a 7-day window. That is checked by a test, for every weekday.

**B. Move by exact days.** Same idea without the week step: everything is always exactly as
far away as designed. But rides and meetings land on any weekday (a board meeting on a
Saturday, a breakfast run on a Tuesday) and every weekday word has to go. Rejected: the 7-day
window is cheap to prove and keeps the club's real rhythm.

**C. A formula per item** ("the first Sunday at least 9 days ahead"). The most flexible, but
it rewrites about 170 dates as code, the story can no longer be read, and every pinned test
expectation changes. Rejected as far more risk for little gain.

**D. Leave the dates, refresh them by hand before each review.** Rejected: the review day is
not ours to pick, and it is how the demo went stale in three weeks.

One thing no single approach can give: the store pictures were taken with the page clock on
08/11 for rides (ride day) and 28/10 for votes. Tests want the showpiece ride a fortnight
ahead; the pictures had it on the day. The story keeps the ride ahead (the designed look, and
the better one for a reviewer: answers, crew and briefing are all still open), and the picture
recipe changes instead (section 9).

## Design

### 1. Story time

New pure module `src/data/demoStory.ts` (no pictures or React, so tests can load it):

- `STORY_ANCHOR = '2026-10-25'` (a Sunday). The story is written as it stood in the week that
  starts that day.
- `storyShiftDays(today)` = `7 × floor(days from STORY_ANCHOR to today ÷ 7)`, floored toward
  minus infinity (Sat 24/10/2026 gives minus 7; existing tests use that day as their now).
- `demoClock(now: Date)` returns `{ now, today, shiftDays, d, t, notAfterNow }`:
  - `now` ISO instant; `today` its Melbourne date.
  - `d('2026-11-08')` moves a story date by `shiftDays`.
  - `t('2026-11-07T21:30:00.000Z')` moves a story instant by `shiftDays` and keeps its
    Melbourne clock time, seconds and milliseconds, so 8:30 am stays 8:30 am across daylight
    saving and an all-day ride still starts at Melbourne midnight. A time in the hour the
    clocks skip moves to the next hour; a time in the repeated hour takes the first of the two.
  - `notAfterNow(iso)` returns the earlier of `iso` and `now` (section 3).
- `storyDates(today: string)` gives the same `shiftDays`, `d` and `t` for callers that only hold
  a date.
- `fixed('2019-03-09')` returns its argument. It marks a date as fixed history on purpose, so
  the source guard can tell "left alone knowingly" from "forgotten".
- Word helpers: `monthName` ("November"), `dayOrdinal` ("8th"), `weekdayName` ("Sunday"),
  `dayMonth` ("7 December"), built from the date string, no time zone involved.

There is no shortcut for a shift of zero: `t()` always takes the real path, and at shift 0 that
path must give back its input. A unit test round-trips every story instant in the seeds.
The Melbourne offset is looked up once per calendar date and kept (a first prototype made 397
`Intl.DateTimeFormat` objects per build and took 26.8 ms; that is not to be repeated). `t()` is
cross-checked against `melbourneInstant`, and a guard test says no story instant sits on a
Sunday before 4 am Melbourne (where the daylight-saving change would bite).

### 2. What moves and what stays

In `src/data/demoData.ts`:

| Item | Treatment |
|---|---|
| Rides r-1, r-3 to r-8 (start, end, cancel time); answers; crew; briefing and its reads; stops plan; route ratings; route "updated" stamps; hub (and its closing day) and registrations; charity ride, its sign-ups and website sign-ups | story, moved by weeks |
| Meetings, action items, votes (opened, closes, closed), minutes-confirmed stamp | story, moved by weeks |
| Every licence, first aid and rego expiry | story, moved by weeks (so the mix of one expired, a few due soon, the rest far off never changes) |
| Recent people: Throttle and Lefty (joined, FNG start), Ben (joined), the two applicants (applied) | story, moved by weeks |
| Everyone else's joined and patched dates (2019 to 2025), every office term, the founders | fixed history, marked `fixed()` |
| The 22-ride 2025 season used for badges | fixed (tests pin it outside this club year). Its first day moves from `'2025-01-12'` to `'2025-01-11'`, because the rides start at 22:00Z and so fell on Mondays in Melbourne while titled "Sunday run" |
| The constitution's published stamps | fixed (the real document's date) |
| "Agreed the posting rules on" | fixed (never shown; only null or not matters) |
| Ride r-2 (North coffee and curves) | Melbourne today plus 6 days, 9:00 am to 2:00 pm (today it is 7 days out after 11 am) |
| The half already counted from today (check-ins, fees, Road Rules, bus, books, conduct, merch, auditor, documents, notices, bragging rides, shop) | same distances, counted from the one clock, with the fixes in sections 3 and 4 |

In the other seed files:

| File | Item | Treatment |
|---|---|---|
| `siteNewsData.ts` | toy run notice | posted 3 days ago; title and body from r-3's date (section 6) |
| | open day notice | posted 12 days ago; the open day is story Sat 14/11/2026, moved by weeks |
| `enquiriesData.ts` | open enquiry | created 38 hours ago |
| | handled enquiry | created 4 days ago, handled 10 hours later |
| `feedbackData.ts` | new feedback | created 5 hours ago |
| | answered feedback | created 3 days ago, replied 5 hours later |
| `sitePhotosData.ts` | Lorne photo | picked 12 days ago, decided 2 hours 20 minutes later |
| | dusk-run photo (its chat picture was posted 20 hours ago) | picked and decided 10 hours ago |
| | removed photo | picked and decided 11 days ago, removed 4 hours later |
| | photo crew | added 20 days ago |
| `chat/demoChatData.ts` | messages | minutes before now (as today) |
| | the past ride r-past-1 | Melbourne today minus 15 days, 9:00 am to 5:00 pm |
| `social/demoSocialData.ts` | mechanics "added", other clubs "at", invite "answered" stamps, invite event days | story, moved by weeks (inv-1 is r-3's day, inv-2 is r-6's day) |
| | content report cr-1 | created 9 am Melbourne yesterday (today it can be ahead of now) |
| | history, honours, awards | fixed |

"Counted back from now" stamps are never ahead of now by construction.

### 3. Nothing that has happened is ahead of now

Seen from any moment, nothing that has "happened" may be ahead of now and nothing "open" may be
behind it.

Two story literals break that and change:

- Vote v-2 (gazebo) closes Fri 30/10 7 pm, inside the week. It moves to Mon 02/11 7 pm
  (`'2026-11-02T08:00:00.000Z'`).
- Ride r-5 (West twisties) is "cancelled" on 01/12, five weeks in the future. Its cancel time
  moves to Mon 19/10 2 pm (`'2026-10-19T03:00:00.000Z'`).

Everything else in `demoData.ts`'s story half already fits.

In the today-counted half, every stamp for something that has happened goes through
`notAfterNow`. The ones that need it:

- today's check-ins and Gravel's exemption (stamped 8:30 pm and 7 pm on a meeting "today");
- the treasurer's report and the meeting report, stamped the 1st of this month at 09:30Z;
- fee charges "created 1 August", the waiver on 2 August, payments decided in early August;
- Big 4 designations on 2 August. The past Big 4 ride's designation is the earlier of 2 August
  and a week before its ride day (today it can be after the ride it designates).

### 4. The today-counted half, fixed

- **Fees never open on a red Overdue.** The seed's due date is the seed's own assumption, not a
  club rule. It stays 31/12 of the club year until that day has passed. After that it is the
  last day of next month, but never later than the club year's last day (31/07). The fee rates
  use the same day. Unchanged in the story week (31/12/2026).
- **The books balance all year.** Fund openings and the cash float are keyed to the financial
  year of the oldest ledger entry (`fyOf` of today minus 70 days), not of today, so in July the
  presented June report no longer closes below zero. Unchanged in the story week.
- **Banked late on every weekday.** The sausage sizzle (le-6) was received 51 days ago and
  banked 41 days ago (10 calendar days is more than 5 working days whatever the weekday; 9 days
  was exactly 5 on Saturdays). The auditor's request says "ten days"; the answer loses "over the
  long weekend".
- **Gravel's notice always quotes a record that is behind.** The record is written by the app's
  own `noticeRecordFrom(standingOf(...))`, taken as at the notice day (today minus 3) or, when
  that reads clean because a club year has just started, as at the 31 July before it. As at the
  notice day he is behind from 26/09 to 03/08; as at 31 July he is behind from 04/08 to 25/09.
  It is computed last, after the check-ins, rides and the 2025 season exist. The proposal loses
  its month: "Move to Supporter status from the next meeting after the reply date, unless the
  board grants relief (4.12)."
- **The check-in code stays `RN2026`.** It is a code, not a date, and the Check in screen's
  hint is the literal `RN2026`. A test ties the two together.
- **The assistant's "plan a ride" proposal** (first Sunday at least 14 days out) skips a day
  that already has a demo ride. The breakfast run is on that day every Sunday.
- **The Rusty Bus booking for Ride for Kids** loses its "the ride has passed" fallback: the ride
  is now always ahead.

### 5. What the reviewer sees, whatever the weekday

Day 0 is a Sunday and day 6 a Saturday. Ranges are days from today.

| Thing | Sunday | Saturday |
|---|---|---|
| West breakfast run (r-1), Sunday 8:30 am, crewed, with route, briefing and stops | in 14 days | in 8 days |
| North coffee and curves (r-2), needs a Tail Gunner | in 6 days | in 6 days |
| Toy Run, club lunch ride, cancelled West twisties, Ride for Kids, Big 4 weekend, North night ride | 5 to 16 weeks ahead | same, less 6 days |
| Vote for Spanner (patch Throttle), closes Wednesday 7 pm | in 10 days | in 4 days |
| Gazebo vote (waiting on Torque), closes Monday 7 pm | in 8 days | in 2 days |
| Tied vote waiting on the chair, closes Tuesday | in 9 days | in 3 days |
| Next board meeting, Wednesday 7:30 pm | in 10 days | in 4 days |
| Spanner's action item (first aid kit) | due in 7 days | due tomorrow |
| Late action item (gazebo quotes) | 5 days late | 11 days late |
| General meeting with minutes overdue | held 11 days ago | held 17 days ago |
| Spanner's rego | expires in 14 days | expires in 8 days |
| Gravel's rego (the one expired item) | expired 13 days ago | expired 19 days ago |
| Gravel's licence, Diesel's rego, Crank's first aid | due in 21 to 26 days | due in 15 to 20 days |
| Applicants waiting | applied 2 and 4 days ago | 8 and 10 days ago |
| Club open day (Home news) | in 20 days | in 14 days |

Nothing in the story half becomes late, closed or expired that was not designed that way.

### 6. Words

**Generated from the moved dates** (so they cannot disagree). Each names the date it reads:

- Meeting titles: `{Month} board meeting` (mt-1), `{Month} general meeting` (mt-2, mt-3), from
  each meeting's own Melbourne date.
- mt-1's agenda notes: `Sparks to table the {Month} figures.` (the month before mt-1's month);
  `Result due by the {Nth}.` (the day vote v-1 closes).
- v-1: `Nine months as an FNG, every ride since {Month}.` (the month Throttle's FNG time
  started).
- `National run {year}`: today's year plus 1.
- The auditor's `{Month} bank statement` (title and details): the month before the month the
  request was raised (it is raised 17 days ago).
- The old fee schedule's label `{year}–{yy}`: the club year that holds its approval day.
- Chat: `Breakfast run on the {Nth}, KSU 8:30. Tail gunner in hi-vis.` from r-1 (always within
  14 days, so "the Nth" can only mean that day); `Toy Run’s on {Weekday} {D Month}. Rusty Bus
  can carry the toys from the clubhouse.` from r-3 (five weeks out, so it carries its month).
- Home news: `Toy run, {Weekday} {D Month}` from r-3; the open day's `Saturday {D Month}`.

**The Toy Run, one set of facts.** Another club's run (Grease Monkeys MCC, for the children's
hospital) on r-3's Sunday, 10:00 am at Werribee Racecourse. West rides in together, KSU 9:00
from Laverton. Bring a wrapped toy. The Rusty Bus carries the toys from the clubhouse. Only two
places change to say so: the chat line above, and the news notice, whose body becomes "Bring a
wrapped toy. West leaves Laverton at 9am sharp and rides in to Werribee Racecourse for a 10am
start. Everyone welcome to wave us off." The ride, the minutes, the gazebo vote's details, the
invite and the history already agree.

**The made-up Christmas ride becomes the "club lunch ride"**, and its Kris Kringle a raffle. A
Christmas ride in April is exactly the stale look this job removes. Exact text:

| Where | New text |
|---|---|
| r-4 title | `Rustnuts club lunch ride` |
| r-4 notes | `Both chapters. Lunch and the raffle after.` |
| mt-2 agenda item | `Club lunch ride` |
| mt-2 minutes | `Present: 14 members.` / blank line / `Club lunch ride: lunch at the clubhouse, raffle tickets $5.` / `Toy Run: West rides together, KSU 9:00 from Laverton.` |
| ai-3 | `Book the clubhouse for the club lunch ride` |
| v-3 question | `Move the club lunch ride a week earlier?` |
| hub notes | `Bring a plate for the lunch.` |
| Code | the `xmas` name in `demoChatData.ts` becomes `lunchRide`; comments that say "Christmas ride" are corrected |

**Chat lines reworded** (old line first):

| Old | New |
|---|---|
| Who’s keen for the Christmas ride? Lunch is sorted, Kris Kringle after. | Who’s keen for the club lunch ride? Clubhouse is booked, raffle after. |
| In. Ten dollar limit on the Kris Kringle this year, Gravel. | In. Go easy on the raffle tickets this time, Gravel. |
| Sunday arvo. Not a bad way to finish the weekend. | Not a bad way to finish a ride. |
| Rego reminder for the summer runs: check yours at (link) before the Christmas ride. | Rego reminder: check yours at (link) before the club lunch ride. |
| G’day all, Ben here. Rode with North last month. Keen for the Christmas ride if there’s room. | the same, with "the club lunch ride" |
| West family day at the clubhouse on the 16th. Marquee’s up from 10 … | West family day at the clubhouse is locked in. Marquee’s up from 10, barbie at noon. Kids welcome, dogs on a lead. |
| Diesel says there’s one in our shed. I’ll bring it Sunday. | Diesel says there’s one in our shed. I’ll bring it to the next ride. |
| Meeting Thursday 7:30 at the clubhouse. Bring your Christmas ride numbers. | Meeting’s at the clubhouse, 7:30. Bring your club lunch ride numbers. |
| Done. Rusty Bus rego is due in December. | Done. Rusty Bus rego is paid up for the year. |
| Lefty’s FNG time is up in January. Worth a chat at the next meeting. | Lefty’s coming along well. Worth a chat at the next meeting. |
| Christmas ride numbers so far: 23 across both chapters. | Club lunch ride numbers are building across both chapters. |
| North will have a few more by Thursday. | North will have a few more by the meeting. |
| Can you bring the first aid kit on the 8th? | Can you bring the first aid kit to the breakfast run? |

**Other words:**

- Dylan's application note: "Been riding with the West crew for a few months. Ride a 2019 Street
  Bob." (was "since August").
- "Spring run to Lorne" becomes "Run to Lorne" (the past ride's title and the site photo's
  caption). The nominee ride "High Country weekend" becomes "High Country run" (it lands on any
  weekday).
- The meeting report's second paragraph becomes "Gravel paid twice by mistake. His refund is on
  the way." (it claimed an approval that, on most days, comes after the report was presented).
- The feedback device line "iOS 19.1 · iPhone 17" becomes "iOS 26.1 · iPhone 17" (19.1 was never
  released).

### 7. The voice note

Gravel's voice note in the club chat (`assets/demo/voice-late.m4a`, 6.3 seconds) has no script
anywhere: nobody can say whether it names a day. It is re-made from a written script, kept in
the repo beside the sound file, with the speech synthesiser already in this workspace's ffmpeg
(a computer voice, as before). The words name no day: "Gravel here. Bike's in bits again. If
anyone's got a spare ten mil socket, I'm buying the first round." Same file name and path; the
seed's length is set from the new file; the words sit in a comment beside the media entry.

### 8. One clock

- New pure module `src/data/demoSession.ts`:
  `createDemoSession(onModeChange, read = () => new Date())` returns `{ now(): Date }`. The first
  `now()` after a mode change reads the clock; later calls return the same instant.
- One instance, `demoSession`, is made in `src/data/reviewMode.ts` straight after `appMode`, so
  it is the first listener: when the reviewer signs in, the stores that reseed inside the same
  notification already see the new session.
- Everything in the demo reads that instant: `DemoClubProvider` (`buildDemoData` and
  `demoTodayRide`), `DemoChatProvider`, `DemoSocialProvider`, the three stores' demo start state
  (club news, enquiries, feedback) and the site photos store.
- So the demo is as fresh as the moment the demo club starts (app start, or entering the review
  demo), and stays put until the app is fully closed and opened again, or the reviewer signs out
  and back in. It is not rebuilt at midnight: that would wipe what the reviewer did.
- `demoData.ts` exports `buildDemoData(now: Date): ClubData`. The whole file's data is built
  inside it from `demoClock(now)`; the three module-level clock reads go. The static pieces
  (`DEMO_PERSONAS`, `DEMO_ROUTE_GPX`, the route shapes) stay at module level. The module no
  longer exports a `DEMO_DATA` value.
- The other seeds become functions of the clock: `demoSiteNews(now)`, `demoEnquiries(now)`,
  `demoFeedback(now)`, `demoSitePhotos(meId, mediaIdFor, now)`, `demoSitePhotoCrew(now)`,
  `demoPastRides(now)`. `demoChatData(now, rides)` and `demoTodayRide(now)` lose their default
  clocks. `demoSocialData(today)` keeps its shape. No clock parameter anywhere has a default.
- The demo's picture and sound table (`DEMO_MEDIA`, the only `require`s) moves to
  `src/data/chat/demoMedia.ts`, so `demoChatData.ts` loads under node and its words can be
  tested.
- "Today's coffee run (demo)" keeps its id, title and its always-on window (the Google Play
  location video notes and the picture recipe rely on them).
- The club context's shape (`ClubContextValue`) does not change.

### 9. Tests

**First, a record of today's data.** Before any change, the demo is dumped to JSON with the
clock pinned to the story instant. The builder is first made with no value changed and proved
equal to that record. Every later change is then checked as a difference against it, and the
final list of differences is reviewed line by line.

**The story instant** is `STORY_NOW` = Sun 25/10/2026 9:00 pm Melbourne
(`2026-10-25T10:00:00.000Z`): after the constitution's fixed stamp that afternoon and after the
meeting's 7 pm and 8:30 pm check-in stamps, so nothing is clamped in the pinned build. The
testkit `src/data/demoStory.testkit.ts` exports `STORY_NOW`, `STORY_TODAY` and `DEMO_DATA =
buildDemoData(STORY_NOW)`.

**New tests, written first and failing first:**

- `demoStory.test.ts`, `demoSession.test.ts`: the clock and the session.
- `demoFresh.test.ts` builds the demo for a spread of instants: each weekday at 00:05, 09:00,
  19:30 and 23:55 Melbourne; 31/12, 01/01; 30/06, 01/07, 15/07, 31/07; 01/08, 02/08, 05/08,
  15/08, 11/09, 26/09; the daylight-saving days 03 to 05/04/2027 and 02 to 04/10/2027;
  29/02/2028; days in 2028 and 2030. On each it checks:
  - **Every date in the built data, by walking the whole object.** Each date-valued key is
    classed as happened (never after now), planned (may be ahead) or fixed. A key the test does
    not know fails it, so a new field cannot slip through. Planned keys: action item and audit
    request due days, bus booking days, charge and fee-rate due days, meeting starts, licence,
    first aid and rego expiries, hub closing days, ride starts and ends, notice reply-by days,
    vote closing times.
  - The table in section 5 through the app's own rules (`businessFor`, `expiryAlerts`,
    `upcomingByMonth`, `minutesState`, `eligibilityProblem`, `patchVoteTooEarly`, the 60-day
    vote limit, `fngDue`, the crew first aid rule).
  - Rides on their weekdays at their Melbourne times; briefing order (Diesel read, then the
    update, then Spanner read, all before the ride); the hub's closing day between today and its
    ride.
  - Section 4: Gravel's record reads behind; le-6 is banked late; no presented report closes
    below zero; no fee reads Overdue for Spanner or Torque; the open session's code equals the
    Check in screen's hint and checks a member in.
  - Every generated word matches its date, and no string holds "Christmas" or "Kris Kringle".
  - The states the four real-clock test files used to check against the machine's day (below).
- `demoSeedsFresh.test.ts` does the same for the other seeds: invites match their rides, both
  news notices are still on Home, board lists look tended, photo stamps are in order and after
  the chat picture, the past ride, the generated chat lines, the assistant's proposal on each
  weekday.
- `demoSeedDates.test.ts`, a guard on the seed sources (comments stripped):
  - every ISO date or instant literal is the direct argument of `d(`, `t(` or `fixed(`;
  - no `new Date()` without an argument and no `Date.now()`; no clock parameter with a default;
  - no capitalised month or weekday name as a whole word, "the Nth", season or holiday word,
    "weekend", "tonight", "tomorrow", "yesterday", "last night", "last/next week/month/year", or
    a bare 20xx year in a string, unless the exact string is on the allowed list.
  - The allowed list (each true on any day): bike model years and the two bios; "EST 2019";
    `RN2026`; "Move board meetings to Tuesdays?"; "Good Friday Appeal"; the Geelong plan's
    "first Tuesday" and "third Sunday"; "the Monday after the meeting" (twice); the sample
    bylaws' "last Thursday" and "last Wednesday" lines; the 2025 season's "Sunday run", "Big 4:
    Summer send-off" and "Big 4: Winter warmer"; the enquiry's "Sunday runs"; the bus log's
    "last night"; "Rode with North last month".

**Existing tests:**

- The 33 test files that read the demo take `DEMO_DATA` from the testkit and keep every pinned
  date. `DEMO_ROUTE_GPX` and `demoTodayRide` still come from `demoData`, so
  `demoRoutes.test.ts` and `liveRideDemo.test.ts` get a second import line. Imports left unused
  are removed (lint covers tests).
- The four files that read the machine's clock on purpose (`demoBus`, `demoRoadRules`,
  `demoGoingGate`, one test in `demoCrew`) were the only many-day check of the today-counted
  half. Their "the demo: ..." state tests move into the loop of instants above. Their action
  tests use the pinned cast, with every `new Date()` and `todayIso()` replaced by the pinned
  instant. The Ride for Kids fallback branch and its test title go; the r-1 date workaround in
  `demoGoingGate` goes; `demoCrew`'s manager check moves a club-wide ride inside the fortnight
  in the test, so both outcomes are still exercised.
- After this no test reads the demo against the day it runs. (The database parity tests keep
  the real Melbourne date on purpose.)

**Then:** `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`, and a look at the
demo at 390×844 with the page clock on 14/11/2026, 31/12/2026, 15/02/2027 and 20/07/2027, as
Spanner and as Torque: Home, Rides, the breakfast run, Meetings and votes, Chat, Invites, Board.

### 10. Store pictures and documents

The eight pictures on Google Play stay as they are. Their recipe (outside the repo, in the
project files) is brought into step so a later retake works: the 28/10 special clock for the
votes scene goes (chat's 1 pm time of day and Home's 90-minute wind-back stay: they are times of
day, not stale dates); the live ride scene opens "Today's coffee run"; a scene that can't find
what it clicks fails the run instead of quietly reusing an old capture; the notes say the pinned
date only keeps retakes repeatable. A retake will show new dates and the club lunch ride, and
picture 06 would lose the live ride button, so the alt text table in
`docs/store/images/README.md` is updated at the retake, not now. Nothing needs a retake before
launch.

`docs/handover/2026-10-25-rusty-bus.md` gets a dated note that the "ride has passed" fallback is
gone.

The App Review notes and the Google Play sign-in instructions (Store paperwork doc) were read
for this job on 14/11/2026. Neither names a demo date. They rely only on the path
"Today's coffee run (demo)", then "Open live ride", then "Share my location", which this job
keeps and tests.

## Left as it is

- The West monthly meeting is told three ways: a check-in "today" (and 28 and 56 days ago), a
  Wednesday board meeting on the Meetings list, and sample bylaws that say "last Wednesday". They
  are two feeds and a sample. The chat line no longer adds a weekday.
- In the morning, two members are already checked in to a meeting the chat says is at 7:30.
- "Ride of the year" is named for today's year while its nominees are dated last year from
  1 January to about 10 April.
- Office terms read "ending" from 02/06/2028 and "ended" from 02/08/2028. Revisit before then.
- A demo left open across Melbourne midnight keeps yesterday's "today" rows (standing can read
  behind and the Home check-in card goes) until the app is fully closed and opened again, or the
  reviewer signs out and back in.
- From 1 August to about 12 September the new club year has no Big 4 history. From about 1 May
  to 31 July the Big 4 weekend falls in the next club year, so standing lines read "needs 1"
  with none to come.
- On 1 August the claimed payment pay-4 is a day older than its charge.
- On the 1st of a month before 10:00 (11:00 in summer time) last month's treasurer's and meeting
  reports read "Presented" on the last day of that month. Their stamps are before now, as they must
  be, and the screens take the stamp's UTC date, not its Melbourne date (`treasury.tsx`,
  `meetingReport.tsx`); a live report presented in Melbourne's morning shows the same. Follow-up
  outside this job: those screens should use `melbourneDate(presentedAt)`.
- The Big 4 weekend lands on 25 to 27/12/2027 when viewed in the week of 19/09/2027.
- The minutes demo's drafted action item is due 14 days after its meeting, which can be a few
  days past. Realistic.
- Five form hints on screens ("Toy run, Sunday 7 December", "November board meeting", "September
  bank statement", "Review of the books, July to September 2026", "National run 2027") and the
  23 "Use DD/MM/YYYY, like 08/11/2026." hints. Not demo data; the live app shows them too.
- The breakfast run's chat is reached from the ride's page, not the chat list (the list shows
  rides within 7 days).
- The demo feedback's "v0.1.0" line (not a date).

## Seen, not in this job

Story contradictions that are the same on every day. Worth a tidy-up after launch:

- A past bus booking carried "the gazebo" while the vote to buy one is still open.
- The Ride for Kids bus booking's driver is Gravel; Sparks signed up for the bus job "driving".
- The Ride for Kids blurb says the bus "carries the toys" (that is the Toy Run).
- The breakfast run's briefing warns of kangaroos at dusk on a ride home by lunch.
- The auditor's first review is dated before the late deposit it mentions.
- North's chat talks about a coffee run yesterday while North coffee and curves is 6 days ahead.
- The family day: a chat post, a bus booking weeks ahead and a family barbecue 14 days ago.

## Calls Claude made (Jeff can veto)

1. The made-up Christmas ride is renamed "club lunch ride".
2. The showpiece ride sits 8 to 14 days ahead, not on the day, and the picture recipe changes
   to suit.
3. The store pictures are not retaken for this.
4. From January the demo's fee due date moves along, so Home never opens on a red "Overdue".
5. The demo voice note is re-made from a written script (nobody knew what the old one said).
6. One set of Toy Run facts (section 6).

## How it reaches phones

Demo data ships inside the app's JavaScript. A merge to `main` publishes only to the test
("preview") channel. A store install opens the JavaScript that was built into it, so the sure
way for a reviewer to see current dates is a new store build made after this is merged. Jeff
chose on 14/11/2026 that the public Android release goes to Google only once this job is in
that build. The iPhone build will be made from `main` later, so it has this either way.
