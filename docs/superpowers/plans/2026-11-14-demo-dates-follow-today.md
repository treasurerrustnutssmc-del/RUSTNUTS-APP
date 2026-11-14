# The Demo Club's Dates Follow Today: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On any day the built-in demo club is opened, every dated thing in it reads as it was designed to, and its words agree with its dates.

**Architecture:** The fixed half of the demo stays a readable story written for the week of Sun 25/10/2026, and a small pure clock module moves every "recent" story date forward by whole weeks to the current week. `demoData.ts` becomes `buildDemoData(now)`; the smaller seed files become functions of the same clock; one session instant (`demoSession`) feeds every provider and store. Tests read a build pinned to the story week, plus new tests that build the demo for 130 instants and walk every date in it.

**Tech Stack:** TypeScript, Node's built-in test runner through tsx (`npm test`), Expo/React Native (providers and stores only), ffmpeg (one sound file). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-demo-dates-follow-today-design.md` (read it first; this plan argues from it and does not repeat its tables: section 2's tables, section 5's table and section 6's exact wording are requirements).

## Global Constraints

- No change to any rule in `src/domain/**`, any screen, any migration or the live data path. Only demo seeds, their wiring, `src/data/assistantDemo.ts`, one sound file and tests.
- No change to `app.json`, `package.json`, the lockfile, `.gitignore`, `plugins/**`, `modules/**` or `google-services.json`. The update runtime fingerprint must not move.
- Ids and array order in the demo data stay exactly as they are (`votes[0]`, `payments[0]`, `members[0]` are used by index in tests). No top-level key of `ClubData` is added, removed or reordered.
- `STORY_ANCHOR = '2026-10-25'` (a Sunday). Shift = `7 × floor(days from anchor to today ÷ 7)`, floored toward minus infinity.
- `STORY_NOW = new Date('2026-10-25T10:00:00.000Z')` (Sun 25/10/2026 9:00 pm Melbourne).
- Day arithmetic is on the Melbourne date (`melbourneDate`, `addDays`). Times are built with `melbourneInstant(date, 'HH:MM')` from `src/domain/business.ts`. Never `setUTCDate`, never a device-local date.
- No seed file may read the machine clock: no `new Date()` without an argument, no `Date.now()`, no clock parameter with a default.
- Never moved: joined/patched dates from 2019 to 2025, every office term in the story half, the 2025 badge season, the constitution stamps `'2026-10-25T03:00:00.000Z'`, `postingRulesAcceptedOn`, `TERMS_BEGAN`, `PRIVACY_UPDATED_ON`, `POSTING_RULES_UPDATED_ON`, the Road Rules guide date, the social history and honours years.
- Stale on purpose, and must stay so on every instant: ai-2 Late; mt-2 minutes overdue; Gravel's rego expired; v-3 closed and carried; bus-4 declined; bus-6 never answered; ar-2 overdue; the fee schedule overdue for review; le-6 banked late; Gravel's open attendance notice.
- `demoTodayRide` keeps its id `'r-today'`, its title `'Today’s coffee run (demo)'`, and its now-minus-1-hour to now-plus-3-hours window. The check-in code stays `'RN2026'`.
- House wording: every new or changed string must pass `src/houseWording.test.ts`. No em-dashes in user-facing text. Dates shown as DD/MM/YYYY. Curly apostrophes in seed strings, as the file already uses.
- `src/domain/reviewer.ts` holds the store-review sign-in code. Never copy it into a test name, comment, commit message or report.
- Commit trailer on every commit: the `Co-Authored-By` line your own session's attribution instruction gives (it names whoever wrote the commit), and
  `Claude-Session: https://claude.ai/code/session_01MyjnUrnEZ8ecDYD7iXSxXi`. Branch `claude/project-thread-uuwiox` only. No `git reset --hard`, no force push, no push at all from a task (the coordinator pushes).
- Before calling any task done: `npm test`, `npm run typecheck`, `npx expo lint` (and `npm run test:db` at the end; it does not read demo data). Baseline on `main`: 3,155 tests, 0 fail (4 website tests skip in some checkouts; that is the environment, not this change).

## The record of today's data (done before Task 1)

`/tmp/claude-0/-home-claude/15e8e4b5-1dbc-5b05-8c5e-a19d6786296d/scratchpad/job24/snapshot/before.json` is the unchanged module's `DEMO_DATA` and `demoSocialData('2026-10-25')`, dumped with the clock pinned to `STORY_NOW`. `compare.ts` beside it prints every difference between that record and `buildDemoData(STORY_NOW)`:

`node --import tsx /tmp/claude-0/-home-claude/15e8e4b5-1dbc-5b05-8c5e-a19d6786296d/scratchpad/job24/snapshot/compare.ts`

Each task from 2 on runs it and puts the output in its report. The expected differences are listed per task; anything else is a mistake.

## Review Focus

1. **A day in the hour the clocks skip or repeat** (first Sunday of October, first Sunday of April): a moved story time must still be a real instant at the same clock time, or the next hour. Tests in Task 1.
2. **The Saturday night of a week** (23:55, the last minutes before the shift steps on): nothing "open" may already be behind now. Tests in Task 3.
3. **The first minutes of a Melbourne day and the 1st of a month** (00:05, when UTC is still on yesterday): today's rows are on today's Melbourne date and no stamp is ahead of now. The walk in Task 4.
4. **The turn of the club year and the financial year** (30/06 to 31/07, 01/08 to 26/09): fees, books, Big 4 and Gravel's notice. Tests in Task 4.
5. **A reviewer signing in days after the app's code loaded:** the demo is built for the session instant, not for module load. Tests in Tasks 1 and 5; the source guard in Task 6 pins it.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/data/demoStory.ts` (new) | The demo clock: anchor, shift, `d()`, `t()`, `notAfterNow`, `fixed`, the date-word helpers. Pure. |
| `src/data/demoSession.ts` (new) | One instant per demo session, reset on a mode change. Pure. |
| `src/data/reviewMode.ts` | Makes the one `demoSession` straight after `appMode`. |
| `src/data/demoStory.testkit.ts` (new) | `STORY_NOW`, `STORY_TODAY`, `DEMO_DATA` (the demo built for the story instant), `INSTANTS`, `builtFor(instant)`. Test-only. |
| `src/data/demoData.ts` | `buildDemoData(now)`: the whole club. Static exports unchanged. |
| `src/data/demoFresh.test.ts` (new) | The club data on every instant. |
| `src/data/chat/demoMedia.ts` (new) | `DEMO_MEDIA`: the only picture and sound `require`s. |
| `src/data/chat/demoChatData.ts` | Chat words and `demoPastRides(now)`; loads under node. |
| `src/data/social/demoSocialData.ts`, `siteNewsData.ts`, `enquiriesData.ts`, `feedbackData.ts`, `sitePhotosData.ts` | Seeds as functions of the clock. |
| `src/data/DemoClubProvider.tsx`, `chat/DemoChatProvider.tsx`, `social/DemoSocialProvider.tsx`, `siteNews.tsx`, `enquiries.tsx`, `feedback.tsx`, `sitePhotos.tsx` | Read `demoSession.now()`. |
| `src/data/assistantDemo.ts` | The ride proposal skips a day that has a demo ride. |
| `src/data/demoSeedsFresh.test.ts` (new) | The other seeds on every instant. |
| `src/data/demoSeedDates.test.ts` (new) | Source guard. |
| `assets/demo/voice-late.m4a`, `assets/demo/voice-late.txt` (new) | The re-made voice note and its script. |

---

### Task 1: The demo clock and the demo session

**Files:**
- Create: `src/data/demoStory.ts`, `src/data/demoStory.test.ts`, `src/data/demoSession.ts`, `src/data/demoSession.test.ts`

**Interfaces:**
- Consumes: `melbourneDate` (`src/domain/rides.ts`), `melbourneInstant`, `melbourneHhmm` (`src/domain/business.ts`), `addDays`, `daysBetween`, `weekday` (`src/domain/dates.ts`).
- Produces:
  ```ts
  // src/data/demoStory.ts
  export const STORY_ANCHOR = '2026-10-25';
  export interface StoryDates {
    /** Whole weeks, in days, from the story week to today's week. */
    shiftDays: number;
    /** A story date (YYYY-MM-DD) moved to today's week. */
    d: (storyDate: string) => string;
    /** A story instant moved the same number of days, at the same Melbourne clock time. */
    t: (storyInstant: string) => string;
  }
  export interface DemoClock extends StoryDates {
    now: string;    // ISO instant
    today: string;  // its Melbourne date
    /** The earlier of an instant and now: something that has happened is never stamped ahead of now. */
    notAfterNow: (iso: string) => string;
  }
  export function storyShiftDays(today: string): number;
  export function storyDates(today: string): StoryDates;
  export function demoClock(now: Date): DemoClock;
  /** Marks a date as fixed history on purpose. Returns its argument. */
  export function fixed<T extends string>(iso: T): T;
  /** 'November' */ export function monthName(dateIso: string): string;
  /** '8th' */ export function dayOrdinal(dateIso: string): string;
  /** 'Sunday' */ export function weekdayName(dateIso: string): string;
  /** '7 December' */ export function dayMonth(dateIso: string): string;

  // src/data/demoSession.ts
  export interface DemoSession { now(): Date }
  /** `onModeChange` registers a listener (appMode.subscribe); `read` is the clock. */
  export function createDemoSession(onModeChange: (listener: () => void) => unknown, read?: () => Date): DemoSession;
  ```
  `createDemoSession`'s `read` default (`() => new Date()`) is the one place in the demo that reads the machine clock.

- [ ] **Step 1: Write the failing tests** in `src/data/demoStory.test.ts` (`node:test`, `node:assert/strict`):

```ts
test('the shift is whole weeks and steps on Sunday, Melbourne time', () => {
  assert.equal(storyShiftDays('2026-10-25'), 0);
  assert.equal(storyShiftDays('2026-10-31'), 0);
  assert.equal(storyShiftDays('2026-11-01'), 7);
  assert.equal(storyShiftDays('2026-11-14'), 14);
  assert.equal(storyShiftDays('2026-10-24'), -7);
  assert.equal(storyShiftDays('2026-10-18'), -7);
  assert.equal(storyShiftDays('2026-10-17'), -14);
  // 13:05 UTC on Saturday is 00:05 Sunday in Melbourne: the new week has started.
  assert.equal(demoClock(new Date('2026-10-31T13:05:00.000Z')).shiftDays, 7);
  assert.equal(demoClock(new Date('2026-10-31T12:55:00.000Z')).shiftDays, 0);
});

test('in the story week every instant comes back unchanged, by the real path', () => {
  const { d, t, shiftDays } = demoClock(new Date('2026-10-28T02:00:00.000Z'));
  assert.equal(shiftDays, 0);
  assert.equal(d('2026-11-08'), '2026-11-08');
  // One per kind of time in the seeds: summer and winter time, Melbourne midnight, odd seconds.
  for (const iso of ['2026-11-07T21:30:00.000Z', '2026-10-23T20:42:17.250Z', '2027-01-29T13:00:00.000Z', '2026-09-16T09:30:00.000Z',
    '2026-07-25T00:00:00.000Z', '2026-10-24T05:30:00.000Z', '2027-02-13T08:00:00.000Z']) assert.equal(t(iso), iso);
});

test('a moved instant keeps its weekday and its Melbourne clock time across daylight saving', () => {
  // Built for Wed 14/07/2027 (winter time): 37 weeks on.
  const { d, t, shiftDays } = demoClock(new Date('2027-07-14T02:00:00.000Z'));
  assert.equal(shiftDays, 259);
  assert.equal(d('2026-11-08'), '2027-07-25');
  const ride = t('2026-11-07T21:30:00.000Z'); // Sun 08/11/2026 8:30 am
  assert.equal(ride, '2027-07-24T22:30:00.000Z');
  assert.equal(melbourneDate(ride), '2027-07-25');
  assert.equal(melbourneHhmm(ride), '08:30');
  assert.equal(melbourneHhmm(t('2027-01-29T13:00:00.000Z')), '00:00'); // an all-day ride's midnight
  assert.equal(t('2026-10-23T20:42:17.250Z'), '2027-07-09T21:42:17.250Z'); // seconds and ms kept
});

test('t() agrees with melbourneInstant on every day of two years', () => {
  // Story Wed 28/10/2026 7:30 pm, moved to each week: always Wednesday 7:30 pm.
  for (let week = -2; week < 110; week++) {
    const today = addDays('2026-10-25', week * 7 + 3);
    const moved = storyDates(today).t('2026-10-28T08:30:00.000Z');
    assert.equal(moved, melbourneInstant(addDays('2026-10-28', week * 7), '19:30'), today);
  }
});

test('a time in the hour the clocks skip moves to the next hour; in the repeated hour it is the first', () => {
  // Story Sun 25/10/2026 2:30 am, moved 49 weeks to Sun 03/10/2027, when 2:00 to 3:00 am does not exist.
  const skip = demoClock(new Date('2027-10-05T02:00:00.000Z')).t('2026-10-24T15:30:00.000Z');
  assert.equal(melbourneDate(skip), '2027-10-03');
  assert.equal(melbourneHhmm(skip), '03:30');
  // Moved 23 weeks to Sun 04/04/2027, when 2:00 to 3:00 am happens twice: the first (summer time) one.
  const twice = demoClock(new Date('2027-04-06T02:00:00.000Z')).t('2026-10-24T15:30:00.000Z');
  assert.equal(twice, '2027-04-03T15:30:00.000Z');
});

test('notAfterNow caps a stamp at now and leaves an earlier one alone', () => {
  const { notAfterNow, now } = demoClock(new Date('2027-01-01T02:00:00.000Z'));
  assert.equal(notAfterNow('2027-01-01T09:30:00.000Z'), now);
  assert.equal(notAfterNow('2026-12-31T09:30:00.000Z'), '2026-12-31T09:30:00.000Z');
});

test('date words', () => {
  assert.equal(monthName('2026-11-04'), 'November');
  assert.deepEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-30'].map(dayOrdinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th']);
  assert.equal(weekdayName('2026-11-08'), 'Sunday');
  assert.equal(dayMonth('2026-12-07'), '7 December');
  assert.equal(fixed('2019-03-09'), '2019-03-09');
});

test('building a clock is cheap: no formatter per call', () => {
  const { t } = demoClock(new Date('2027-07-14T02:00:00.000Z'));
  const started = performance.now();
  for (let i = 0; i < 2000; i++) t('2026-11-07T21:30:00.000Z');
  assert.ok(performance.now() - started < 200, 'cache the Melbourne offset per calendar date');
});
```

  And in `src/data/demoSession.test.ts`:

```ts
test('one instant per session; a mode change starts a new one', () => {
  const listeners: (() => void)[] = [];
  const clock = [new Date('2026-11-14T02:00:00.000Z'), new Date('2026-11-17T02:00:00.000Z')];
  let reads = 0;
  const session = createDemoSession((l) => listeners.push(l), () => clock[reads++]);
  assert.equal(reads, 0, 'nothing is read until someone asks');
  assert.equal(session.now().toISOString(), '2026-11-14T02:00:00.000Z');
  assert.equal(session.now(), session.now());
  assert.equal(reads, 1);
  listeners.forEach((l) => l());
  assert.equal(reads, 1, 'still lazy after a mode change');
  assert.equal(session.now().toISOString(), '2026-11-17T02:00:00.000Z');
});
```

- [ ] **Step 2: Run** `node --import tsx --test src/data/demoStory.test.ts src/data/demoSession.test.ts`. Expected: FAIL, cannot find the modules.
- [ ] **Step 3: Implement** both modules to the interfaces. `t()`: take the instant's Melbourne date and wall time (the offset for a calendar date is looked up once and kept in a module-level `Map`), add `shiftDays` to the date, rebuild the instant from the target date's offset, keep seconds and milliseconds. No branch for `shiftDays === 0`. The word helpers work from the `YYYY-MM-DD` string with fixed English name tables (no `Intl`).
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm run typecheck`, `npx expo lint`.
- [ ] **Step 5: Commit:** "Demo clock and demo session: story dates move a week at a time".

### Task 2: `buildDemoData(now)`, with no value changed

A structural step. After it the club data is built from one instant, and built for `STORY_NOW` it is exactly the recorded data.

**Files:**
- Modify: `src/data/demoData.ts` (whole file), `src/data/DemoClubProvider.tsx:15,30`, `src/data/reviewMode.ts`
- Create: `src/data/demoStory.testkit.ts`, `src/data/demoFresh.test.ts`
- Modify: the 33 test files that import from `demoData` (`grep -rln "demoData'" src --include=*.test.ts`)

**Interfaces:**
- Consumes: `demoClock` (Task 1), `createDemoSession` (Task 1).
- Produces:
  ```ts
  // src/data/demoData.ts
  export function buildDemoData(now: Date): ClubData;   // replaces `export const DEMO_DATA`
  export function demoTodayRide(now: Date): Ride;        // no default any more
  export const DEMO_PERSONAS, DEMO_ROUTE_GPX;            // unchanged
  // src/data/reviewMode.ts, straight after `appMode` is made
  export const demoSession = createDemoSession(appMode.subscribe);
  // src/data/demoStory.testkit.ts
  export const STORY_NOW: Date;                 // new Date('2026-10-25T10:00:00.000Z')
  export const STORY_TODAY: string;             // '2026-10-25'
  export const DEMO_DATA: ClubData;             // buildDemoData(STORY_NOW)
  export const INSTANTS: string[];              // see below
  export function builtFor(instant: string): ClubData;   // memoised buildDemoData(new Date(instant))
  ```
  `INSTANTS`: each of these Melbourne days at `00:05`, `09:00`, `19:30` and `23:55` (through `melbourneInstant`): `2026-10-24`, `2026-10-25`, `2026-10-31`, the week `2026-11-15` to `2026-11-21`, `2026-12-31`, `2027-01-01`, `2027-02-15`, `2027-04-03`, `2027-04-04`, `2027-04-05`, `2027-06-30`, `2027-07-01`, `2027-07-15`, `2027-07-20`, `2027-07-31`, `2027-08-01`, `2027-08-02`, `2027-08-05`, `2027-08-15`, `2027-09-11`, `2027-09-26`, `2027-10-02`, `2027-10-03`, `2027-10-04`, `2028-02-29`, `2028-11-14`, `2030-06-15`.

- [ ] **Step 1: Write the failing tests** in `src/data/demoFresh.test.ts`:

```ts
test('the demo is built for the instant it is given, not for the machine clock', () => {
  const a = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  const b = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  assert.deepEqual(a, b);
  assert.notEqual(a, b);                       // a fresh object each time: the provider owns its copy
  assert.equal(a.checkinSessions!.find((s) => s.id === 'cs-today')!.heldOn, '2027-03-10');
  assert.equal(a.busBookings!.find((x) => x.id === 'bus-2')!.firstDay, '2027-03-10');
});

test('same ids, same order, same keys, whatever the instant', () => {
  const shape = (data: ClubData) => Object.fromEntries(Object.entries(data).map(([key, rows]) =>
    [key, Array.isArray(rows) ? rows.map((row, i) => (row as { id?: string }).id ?? i) : typeof rows]));
  for (const instant of INSTANTS) assert.deepEqual(shape(builtFor(instant)), shape(DEMO_DATA), instant);
  assert.equal(DEMO_DATA.rides.some((r) => r.id === 'r-today'), false);
});
```

- [ ] **Step 2: Run** `node --import tsx --test src/data/demoFresh.test.ts`. Expected: FAIL, `buildDemoData` is not exported.
- [ ] **Step 3: Turn `demoData.ts` into a builder.** Everything from `export const DEMO_DATA: ClubData = {` to the end of the file goes inside `export function buildDemoData(now: Date): ClubData`, with these rules (a mechanical first cut exists at `/tmp/claude-0/-home-claude/15e8e4b5-1dbc-5b05-8c5e-a19d6786296d/scratchpad/job24/exp-builder/_x/wrap.mjs`; read it, do not trust it):
  - `DEMO_PERSONAS`, `demoTodayRide`, `DEMO_ROUTE_GPX`, the route tables, `member`, `priv` and pure text constants stay at module level. Any module-level table that holds a date literal used by the story (the routes' `updatedAt`) is read inside the builder.
  - `s4Today` becomes `clock.today`; `Date.now()` becomes `new Date(clock.now).getTime()`; `daysFromNow` keeps its formula but counts from `now` (its values change in Task 4, not here).
  - No `new Date()` without an argument and no `Date.now()` remains in the file. `demoTodayRide(now: Date)` loses its default.
  - Keep the statement order, every id, every value.
- [ ] **Step 4: Create the testkit** as in Interfaces, and add `demoSession` to `reviewMode.ts`.
- [ ] **Step 5: Re-point the tests.** `DEMO_DATA` comes from the testkit (`'./demoStory.testkit'`, `'../demoStory.testkit'`, `'../data/demoStory.testkit'`); `DEMO_ROUTE_GPX` and `demoTodayRide` still come from `demoData`, so `demoRoutes.test.ts` and `liveRideDemo.test.ts` get a second import line, and `demoTodayRide()` calls in tests pass an instant. In the four files that read the machine clock on purpose (`demoBus.test.ts` 32 and 108, `demoRoadRules.test.ts` 24 and 153, `demoGoingGate.test.ts` 15-16, `demoCrew.test.ts` 158), every `new Date()` and `todayIso()` becomes `STORY_NOW` or `STORY_TODAY`. Remove imports this leaves unused. No assertion is weakened; a test that cannot pass with the clock in the story week is listed in the report, not deleted (Task 4 deals with those four files' state tests).
- [ ] **Step 6: `DemoClubProvider.tsx`:** the `useState` initialiser takes `const now = demoSession.now()` once and uses it for `buildDemoData(now)` and `demoTodayRide(now)`.
- [ ] **Step 7: Prove it is the same data.** Run `compare.ts` (see "The record of today's data"). Expected: `differences: 0`. Then `npm test` (expected: the baseline counts plus the new tests, 0 fail), `npm run typecheck`, `npx expo lint`.
- [ ] **Step 8: Commit:** "Demo data is built from one clock (no value changed)".

### Task 3: The story moves, and its words with it

**Files:**
- Modify: `src/data/demoData.ts` (the story half only: everything before the "Stage 4" banner, plus the routes' stamps)
- Test: `src/data/demoFresh.test.ts`

**Interfaces:**
- Consumes: `demoClock`, word helpers (Task 1); `buildDemoData`, `INSTANTS`, `builtFor` (Task 2).
- Produces: no new export. The story half of `buildDemoData`'s result follows today.

- [ ] **Step 1: Add the failing tests** to `src/data/demoFresh.test.ts`. Each loops over `INSTANTS` with `now` the instant, `today = melbourneDate(now)`, `data = builtFor(now)`, and puts the instant in every assertion message. A working sketch of most of these calls is at `/tmp/claude-0/-home-claude/15e8e4b5-1dbc-5b05-8c5e-a19d6786296d/scratchpad/job24/exp-builder/_x/table.ts`.
  - **"the business story"** through `businessFor(member, data, now)`: Spanner `needsMe` ids `['v-1']`, closed votes include `'v-3'`, `myActions` ids `['ai-1']`; Torque `needsMe` `['v-2']`, `upcoming` `['mt-1']`; Rusty `upcoming` `['mt-1', 'mt-4']`; the past meeting mt-2 is in the overdue-minutes state and mt-3 approved (use the state names `businessFor` returns in `past`); for every vote with `closedAt === null`: `openedAt <= now < closesAt` and `closesAt − openedAt <= 60 days`; v-3 `closedAt <= now`; ai-1 and ai-4 `dueOn >= today`; ai-2 `dueOn` is 5 to 11 days before today; ai-3 `doneOn < dueOn`; mt-1 is 4 to 10 days ahead, on a Wednesday, `melbourneHhmm` `'19:30'`; mt-2 was held 11 to 17 days ago.
  - **"days to each vote's close"**: v-1 4 to 10 (a Wednesday, `'19:00'`), v-2 2 to 8 (a Monday, `'19:00'`), v-4 3 to 9 (a Tuesday).
  - **"rides"**: r-1 starts 8 to 14 days after today, on a Sunday, `'08:30'`, ends `'12:00'` the same day; r-3, r-4, r-6, r-7, r-8 start after now; r-3, r-4, r-5, r-6 are Sundays and r-7, r-8 Saturdays; r-7 is all-day with start and end at `'00:00'` Melbourne; r-5 `cancelledAt <= now`.
  - **"the breakfast run's paperwork"**: Diesel's read `<` briefing `updatedAt` `<` Spanner's read `<` now, and Spanner's read `<` r-1 start; every crew member on r-1 has a `going` answer; for every `crew` row with role `tail_gunner` or `assistant_tail_gunner`, that member's `firstAidExpiry >=` the ride's Melbourne date.
  - **"expiries"**: `expiryAlerts(data.members, data, today)` (import from `src/domain/profile`, shape as `src/domain/profile.test.ts:28-41`) has exactly one `expired` alert, Gravel's rego (13 to 19 days ago); Spanner's rego is `soon` (8 to 14 days ahead); Gravel's licence, Diesel's rego and Crank's first aid are `soon` (15 to 26 days ahead).
  - **"people"**: a patch vote on Throttle is not too early (`patchVoteTooEarly` / the vote-opening rule as `src/domain/votes.test.ts:149` calls it); `fngDue` and `eligibilityProblem` give the same answers for Throttle and Lefty as they do for `DEMO_DATA` at `STORY_NOW`; the applicants applied 2 to 10 days ago.
  - **"the lunch ride's sleepover"**: the hub for r-4 has `today <= closesOn <=` r-4's Melbourne date.
  - **"words agree with dates"**: mt-1 title is `` `${monthName(mt-1 day)} board meeting` ``, mt-2 and mt-3 `` `${monthName(day)} general meeting` ``; mt-1's agenda notes are `` `Sparks to table the ${monthName(last day of the month before mt-1's)} figures.` `` and `` `Result due by the ${dayOrdinal(day v-1 closes)}.` ``; v-1 `details` is `` `Nine months as an FNG, every ride since ${monthName(Throttle's fngStartedOn)}.` ``; Dylan's `applicationNote` is the spec's; across `rides`, `votes`, `actionItems`, `meetings` (titles, agenda, minutes), `rideHubs` and `privates`, no string matches `/Christmas|Kris Kringle/`; r-4, mt-2, ai-3, v-3 and the hub notes are exactly the spec's section 6 text.
- [ ] **Step 2: Run** `node --import tsx --test src/data/demoFresh.test.ts`. Expected: the new tests FAIL (dates in 2026, "November board meeting" in 2027). Keep the output for the report: it is the evidence that the test would have caught the stale demo.
- [ ] **Step 3: Move the story.** In `buildDemoData`, with `const { d, t } = clock;`:
  - Wrap every story date in `d('…')` and every story instant in `t('…')`, per the spec's section 2 table: rides r-1, r-3 to r-8 (`startsAt`, `endsAt`, `cancelledAt`); all `rsvps`, `crew`, `briefings`, `briefingReads`, `ridePlans`, `routeRatings`, routes' `updatedAt`, `rideHubs` (`closesOn`, `updatedAt`), `hubRegistrations`, `charityRides`, `websiteSignups`, `charitySignups`; all `meetings`, `actionItems`, `votes`; every `licenceExpiry`, `firstAidExpiry`, `regoExpiry`; `joinedOn`/`fngStartedOn` of m-throttle and m-lefty, `joinedOn` of m-ben, `appliedOn` of m-dylan and m-josh. Literals stay as written: the file must still read as the story of that week.
  - The two story changes: v-2 `closesAt: t('2026-11-02T08:00:00.000Z')`; r-5 `cancelledAt: t('2026-10-19T03:00:00.000Z')`.
  - Generated words and renames: exactly the spec's section 6 (the rows that live in `demoData.ts`'s story half).
  - Comments that describe the old fixed dates or the Christmas ride are rewritten to say what is true now.
- [ ] **Step 4: Run** the test file: PASS on every instant. Run `compare.ts`. Expected differences, and no others: v-2 `closesAt`; r-5 `cancelledAt`; the reworded strings (r-4 title and notes, mt-2 agenda and minutes, ai-3 title, v-3 question, hub notes, Dylan's note). Titles and notes generated from dates must be unchanged at `STORY_NOW`.
- [ ] **Step 5:** `npm test`: a pinned test that named the old wording is updated to the new wording; no pinned date changes. `npm run typecheck`, `npx expo lint`. Commit: "Demo story moves a week at a time; its words follow its dates".

### Task 4: The half that already counted from today

**Files:**
- Modify: `src/data/demoData.ts` (from the "Stage 4" banner to the end), `src/data/demoBus.test.ts`, `src/data/demoRoadRules.test.ts`, `src/data/demoGoingGate.test.ts`, `src/data/demoCrew.test.ts`
- Test: `src/data/demoFresh.test.ts`

**Interfaces:**
- Consumes: `clock.notAfterNow`, `fixed`, word helpers (Task 1); `INSTANTS`, `builtFor` (Task 2); `standingOf` (`src/domain/standing.ts`), `noticeRecordFrom` (`src/domain/notices.ts`), `bankedLate`, `reportFor` (`src/domain/ledger.ts`), `dueState`, `chargeBalance`, `fyOf` (`src/domain/fees.ts`).
- Produces: no new export.

- [ ] **Step 1: Add the failing tests** to `src/data/demoFresh.test.ts`, each over `INSTANTS`:
  - **"every date in the demo is on the right side of now"**: walk the whole built object. For every string value matching `/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/`, take its path with array indexes dropped (`ledger.approvals.approvedAt`). The path must be in `PLANNED` or `HAPPENED`, or the test fails naming it. `HAPPENED` values must be `<= now` (instants) or `<= today` (dates). `PLANNED` is exactly: `actionItems.dueOn`, `auditRequests.dueOn`, `busBookings.firstDay`, `busBookings.lastDay`, `charges.dueOn`, `feeRates.dueOn`, `meetings.startsAt`, `privates.licenceExpiry`, `privates.firstAidExpiry`, `registrations.regoExpiry`, `rideHubs.closesOn`, `rides.startsAt`, `rides.endsAt`, `statusNotices.respondBy`, `votes.closesAt`. `HAPPENED` is every other date path in the data (99 paths in all today; list them in the test, do not compute the list from the data).
  - **"nothing open is behind now"**: `statusNotices[0].respondBy >= today`; `auditRequests` ar-1 `dueOn >= today` and ar-2 `dueOn < today`; r-2 starts exactly 6 days after today at `'09:00'` Melbourne and ends `'14:00'` the same day.
  - **"fees never open on a red Overdue"**: for every charge, `dueState(charge, chargeBalance(charge, data.payments!), today) !== 'overdue'`; every `feeRates[].dueOn` equals the charges' `dueOn`; on instants up to 31/12 of the club year the due day is that 31/12; after it, it is the last day of the month after today's, capped at the next 31/07.
  - **"the books balance all year"**: for the presented report month (`treasurerReports[0].month`) and for today, no fund's closing balance from `reportFor` (call it as the treasurer screen does) is below zero, and the cash float is 40000 cents.
  - **"the sausage sizzle is banked late on every weekday"**: `bankedLate(le-6)` is true; ar-1 `details` contains `'ten days'`; ar-1 `answer` does not contain `'weekend'`.
  - **"Gravel's notice quotes a record that is behind"**: `statusNotices[0].record` equals `noticeRecordFrom(standingOf(gravel, data, D))` for `D` = the notice day or the 31 July before it, and the standing it came from has its monthly-meetings line in state `'behind'`; `givenOn` is today minus 3; the proposal is the spec's sentence.
  - **"the check-in code is the one the screen shows"**: the open session's `code` is `'RN2026'` and equals the `placeholder` read from `src/screens/checkin.tsx` with a regex; checking Spanner in with it through the demo's check-in action succeeds.
  - **"Big 4 designations come before their rides"**: for each `big4Rides` row, `designatedAt <` its ride's `startsAt`, and `<= now`.
  - **"words in this half"**: nc-1 title `` `National run ${Number(today.slice(0, 4)) + 1}` ``; ar-2 title `` `${monthName(first day of the month before the month of today minus 17 days)} bank statement` `` and its `details` names the same month; the fee schedule version's label is `` `${cy}–${String(cy + 1).slice(2)}` `` with `cy` the club year (`clubYearOf`) of its `approvedOn`; r-brag-3's title is `'High Country run'`; `meetingReports[0].notes` ends with the spec's sentence; every 2025 season ride titled `'Sunday run'` is on a Sunday in Melbourne.
  - **The state tests of the four real-clock files**, moved here and run on every instant: the "the demo: …" tests at `demoBus.test.ts:78-196`, `demoRoadRules.test.ts:50-94`, `demoGoingGate.test.ts:47-58`, `demoCrew.test.ts:132-171`. Their action tests stay in their files on the pinned cast. In `demoBus` the Ride for Kids fallback branch and "or a month out with no ride once it’s past" go from the title; in `demoGoingGate` the workaround that copies r-2's times onto r-1 goes; `demoCrew`'s manager check moves a club-wide ride inside the fortnight in the test, so both outcomes are exercised.
- [ ] **Step 2: Run** the test file. Expected: FAIL (stamps ahead of now on the 1st and in early August, Overdue from January, a negative report in July, not banked late on Saturdays, a clean record in August). Keep the output for the report.
- [ ] **Step 3: Fix the half**, per the spec's sections 3 and 4:
  - `at(...)` results for things that have happened go through `clock.notAfterNow`. The calendar critic's scan of which paths run ahead, and when, is at `/tmp/claude-0/-home-claude/15e8e4b5-1dbc-5b05-8c5e-a19d6786296d/scratchpad/job24/exp-calendar/scan.log`; the walk is the authority.
  - `s4Due`: 31/12 of the club year while `today <=` it; after, the last day of the month after today's, capped at `${s4Year + 1}-07-31`. `rate()` uses it.
  - `fundOpenings` and `cashFloats`: `fy: fyOf(ago(70))`.
  - le-6 `receivedOn: ago(51)`; ar-1 details "ten days"; ar-1 answer `'The float tin sat with Sparks for more than a week. From next month the Treasurer banks it on the Monday after the meeting.'`
  - Big 4: r-7 `designatedAt: notAfterNow(at(`${s4Year}-08-02`))`; the past ride's is the earlier of that and `at(` its ride day minus 7 `)`, then `notAfterNow`.
  - Gravel's notice: computed last, after the 2025 season block, as the spec's section 4 says; replace the `statusNotices` literal's `record` and `proposal`.
  - r-2: `melbourneInstant(addDays(today, 6), '09:00')` to `'14:00'`; `daysFromNow` goes.
  - Ride for Kids: delete the "ride has passed" fallback; bus-1 always has `rideId: 'r-6'` on r-6's Melbourne date.
  - Words: nc-1, ar-2, the fee schedule label, r-brag-3, the meeting report note, as the spec's section 6.
  - 2025 season: first day `fixed('2025-01-11')`.
- [ ] **Step 4: Run** the test file: PASS on every instant. Run `compare.ts`. Expected differences beyond Task 3's, and no others: r-2 `startsAt`/`endsAt`; le-6 `receivedOn`; ar-1 `details` and `answer`; `statusNotices[0].proposal` (and `record` only if the app's own wording differs from the hand-written one: say which); r-brag-3 title; `meetingReports[0].notes`; the 2025 season's 22 rides, sessions and attendance one day earlier; r-big4-past `designatedAt` only if the rule moves it at `STORY_NOW`. Fees, openings, floats and every other stamp must be unchanged at `STORY_NOW`.
- [ ] **Step 5:** `npm test` (pinned tests that named a changed value are updated to the new value, with the reason in the report), `npm run typecheck`, `npx expo lint`. Commit: "Demo: the today-counted half holds on every day of the year".

### Task 5: The other seeds, one session clock, the voice note

**Files:**
- Create: `src/data/chat/demoMedia.ts`, `src/data/demoSeedsFresh.test.ts`, `assets/demo/voice-late.txt`
- Replace: `assets/demo/voice-late.m4a`
- Modify: `src/data/chat/demoChatData.ts`, `src/data/chat/DemoChatProvider.tsx:11,27-28`, `src/data/social/demoSocialData.ts`, `src/data/social/DemoSocialProvider.tsx:7,14-15`, `src/data/siteNewsData.ts:27-47`, `src/data/siteNews.tsx:39-57`, `src/data/enquiriesData.ts:31-54`, `src/data/enquiries.tsx:36-53`, `src/data/feedbackData.ts`, `src/data/feedback.tsx:78-95`, `src/data/sitePhotosData.ts:51-77`, `src/data/sitePhotos.tsx:27-33,119`, `src/data/assistantDemo.ts:88-96`
- Modify tests that call the old constants: `src/data/enquiriesData.test.ts`, `src/data/feedbackData.test.ts`, `src/data/sitePhotosData.test.ts`, and any other the type checker or `npm test` names.

**Interfaces:**
- Consumes: `storyDates`, `demoClock`, word helpers (Task 1); `demoSession` (Task 2); `buildDemoData`, `INSTANTS`, `builtFor` (Tasks 2 to 4).
- Produces:
  ```ts
  // src/data/chat/demoMedia.ts
  export const DEMO_MEDIA: Record<string, number>;                  // moved, unchanged
  // src/data/chat/demoChatData.ts (no asset imports)
  export function demoPastRides(now: Date): Ride[];                 // replaces DEMO_PAST_RIDES
  export function demoChatData(now: Date, rides: Ride[]): ChatData; // no defaults
  // seeds
  export function demoSiteNews(now: Date): SiteNews[];              // replaces DEMO_SITE_NEWS
  export function demoEnquiries(now: Date): Enquiry[];              // replaces DEMO_ENQUIRIES (the file's real element type)
  export function demoFeedback(now: Date): Feedback[];              // replaces DEMO_FEEDBACK (the file's real element type)
  export function demoSitePhotos(meId: string, mediaIdFor: (path: string) => string | null, now: Date): SitePhoto[];
  export function demoSitePhotoCrew(now: Date): SitePhotoCrew[];    // replaces DEMO_SITE_PHOTO_CREW (the file's real element type)
  export function demoSocialData(today: string): SocialData;        // signature unchanged
  ```

- [ ] **Step 1: Write the failing tests** in `src/data/demoSeedsFresh.test.ts`, over `INSTANTS` (`now`, `today`, `data = builtFor(now)`):
  - **invites match the calendar:** with `social = demoSocialData(today)`: inv-1 `eventOn === melbourneDate(r-3.startsAt)`, inv-2 `eventOn === melbourneDate(r-6.startsAt)`; the same invite-list calls as `src/data/social/demoSocialActions.test.ts:213-217` give at least 3 upcoming and both outgoing invites on r-4; every `answeredAt`, mechanics `added` and other-clubs `at` stamp is `<= now`; cr-1 `createdAt <= now` and is `'09:00'` Melbourne on today minus 1.
  - **club news stays on Home:** `publicNews(demoSiteNews(new Date(now)), new Date(now))` (call it as Home does) has both notices; the toy run notice's title is `` `Toy run, ${weekdayName(day)} ${dayMonth(day)}` `` with `day = melbourneDate(r-3.startsAt)` and its body is the spec's; the open day notice's body contains `` `Saturday ${dayMonth(openDay)}` `` with `openDay` a Saturday 14 to 20 days after today; `createdAt` values are now minus 3 days and now minus 12 days; `postedBy` is `'demo-pres'` on both.
  - **board lists look tended:** enquiries and feedback stamps exactly as the spec's section 2 table; every stamp `<= now`; the device line is `'iOS 26.1 · iPhone 17'`.
  - **site photos:** stamps exactly as the spec's table; every `pickedAt <= decidedAt <= now`; the dusk-run photo was picked after its chat picture was posted (20 hours before now); the removed one has `removedAt >= decidedAt`; the Lorne caption is `'Run to Lorne'`; crew `addedAt` is now minus 20 days.
  - **the past ride:** `demoPastRides(new Date(now))[0]` has id `'r-past-1'`, title `'Run to Lorne'`, Melbourne date today minus 15, `'09:00'` to `'17:00'`; its two chat messages (14 days ago) are after its end.
  - **chat words:** with `chat = demoChatData(new Date(now), data.rides)`: one message body is `` `Breakfast run on the ${dayOrdinal(melbourneDate(r-1.startsAt))}, KSU 8:30. Tail gunner in hi-vis.` `` and one is `` `Toy Run’s on ${weekdayName(day)} ${dayMonth(day)}. Rusty Bus can carry the toys from the clubhouse.` `` (r-3's day); with `rides = []` they are `'Breakfast run is on, KSU 8:30. Tail gunner in hi-vis.'` and `'Toy Run’s coming up. Rusty Bus can carry the toys from the clubhouse.'`; every "New" line in the spec's chat table is present word for word and no "Old" line is; no body matches `/Christmas|Kris Kringle|Thursday|Sunday|weekend|December|January|summer/`; every message's `createdAt <= now`; the voice note's `durationMs` is within 100 ms of the real file's length (read with `ffprobe` if it is on the path, else skip that one assertion).
  - **the assistant's ride proposal:** for each instant, the day the "plan a ride" answer in `src/data/assistantDemo.ts` proposes is a Sunday at least 14 days ahead that has no ride in `data.rides` on that Melbourne date.
  - **the session feeds everything:** a source check that `DemoClubProvider.tsx`, `DemoChatProvider.tsx`, `DemoSocialProvider.tsx`, `siteNews.tsx`, `enquiries.tsx`, `feedback.tsx` and `sitePhotos.tsx` each contain `demoSession.now()` and none contains `new Date()` passed to a demo seed function.
- [ ] **Step 2: Run** `node --import tsx --test src/data/demoSeedsFresh.test.ts`. Expected: FAIL (the functions do not exist; `demoChatData.ts` cannot load under node because of the picture `require`s).
- [ ] **Step 3: Implement**, per the spec's sections 2, 6, 7 and 8:
  - `demoMedia.ts` takes `DEMO_MEDIA` (with the transcript of the voice note in a comment); `DemoChatProvider.tsx` and `DemoSocialProvider.tsx` import it from there.
  - `demoChatData.ts`: the spec's chat table; the two generated lines read r-1 and r-3 from `rides`; `xmas` becomes `lunchRide`; `demoPastRides(now)`.
  - `demoSocialData`: `const { d, t } = storyDates(today)` on the stamps the spec's table names; cr-1 through `melbourneInstant(addDays(today, -1), '09:00')`; history and honours literals untouched (Task 6 marks them).
  - `demoSiteNews`, `demoEnquiries`, `demoFeedback`, `demoSitePhotos`, `demoSitePhotoCrew`: stamps counted back from `now` as the spec's table says. The toy run's day is `storyDates(today).t('2026-11-28T23:00:00.000Z')`, the same literal as r-3; the open day is `storyDates(today).d('2026-11-14')`.
  - Stores: the demo branch of each `startState()` (and `sitePhotos.tsx`'s `demoMediaId` and its `set(...)`) calls the function with `demoSession.now()`.
  - Providers: `DemoChatProvider` uses `demoSession.now()` for `demoPastRides` and `demoChatData`; `DemoSocialProvider` uses `melbourneDate(demoSession.now().toISOString())`, not the context's per-render `today`.
  - `assistantDemo.ts`: after finding the first Sunday at least 14 days out, step on a week at a time while a ride in the context's data falls on that Melbourne date.
  - The voice note: write `assets/demo/voice-late.txt` (the spec's sentence, one line), then `ffmpeg -f lavfi -i "flite=textfile=assets/demo/voice-late.txt:voice=rms" -ac 1 -ar 22050 -c:a aac -b:a 32k -y assets/demo/voice-late.m4a`; set the seed's duration from `ffprobe` (milliseconds, rounded to 100).
- [ ] **Step 4: Run** the new test, then `npm test`, `npm run typecheck`, `npx expo lint`. Run `compare.ts`: the only new differences are in `social` (cr-1 `createdAt`; nothing else at `STORY_NOW`).
- [ ] **Step 5: Commit:** "Demo chat, invites, news and board lists follow the same session clock".

### Task 6: The guard on the seed files

**Files:**
- Create: `src/data/demoSeedDates.test.ts`
- Modify: the seed files, only to wrap fixed history in `fixed('…')`

**Interfaces:**
- Consumes: the seed sources as text (pattern: `src/houseWording.test.ts`, which also shows how comments are stripped); `fixed` (Task 1).

- [ ] **Step 1: Write the test.** It reads `src/data/demoData.ts`, `src/data/chat/demoChatData.ts`, `src/data/social/demoSocialData.ts`, `src/data/siteNewsData.ts`, `src/data/enquiriesData.ts`, `src/data/feedbackData.ts`, `src/data/sitePhotosData.ts`, strips comments, and fails with file and line on:
  - an ISO date or instant literal (`/\b(19|20)\d\d-\d\d-\d\d(T[\d:.]+Z)?\b/` inside quotes) that is not the direct argument of `d(`, `t(` or `fixed(`;
  - `new Date()` with no argument, `Date.now()`, or a parameter default that reads the clock (`= new Date`), anywhere in those files;
  - inside a string literal: a capitalised month or weekday name as a whole word; `/\bthe \d{1,2}(st|nd|rd|th)\b/`; `/Christmas|Easter|Kris Kringle|summer|winter|spring|autumn|weekend|tonight|tomorrow|yesterday|last night|(last|next) (week|month|year)/i`; a bare `/\b20\d\d\b/`; unless the exact string is in `ALLOWED`, which holds only the spec's section 9 allowed list, each entry with its reason.
  - Also: `ALLOWED` has no entry that matches nothing (a stale allowance fails).
  - Every `d('…')` and `t('…')` literal in those files comes back unchanged from `storyDates('2026-10-25')` (the real path at shift 0), and no `t('…')` literal is on a Sunday before 4:00 am Melbourne (where a daylight-saving change would move it).
- [ ] **Step 2: Run it.** Expected: FAIL on the fixed-history literals not yet marked, and on nothing else. Anything else it finds is a miss from Tasks 3 to 5 and is fixed in the seed, not allowed.
- [ ] **Step 3: Mark fixed history** with `fixed('…')`: member joined/patched dates 2019 to 2025, the story half's office terms, the 2025 season's first day, the constitution stamps, `postingRulesAcceptedOn`, the social history, honours and awards. No value changes: `compare.ts` shows no new difference.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npx expo lint`. Commit: "Guard: no bare date or date-word in the demo seeds".

### Task 7: The picture recipe and the notes

**Files (outside the repo unless marked):**
- Modify: `/mnt/project-files/build/store/images/scripts/capture.js`, `/mnt/project-files/build/store/images/scripts/HOW-TO-REMAKE.md` (read each again just before writing; another thread may have changed it)
- Modify (repo): `docs/handover/2026-10-25-rusty-bus.md:55`

- [ ] **Step 1:** `capture.js`: drop `meet` from `CLOCK_FOR` (line 22), so the votes scene uses the main page clock; chat's clock and Home's 90-minute wind-back stay. The live scene clicks `'Today’s coffee run'` then `'Open live ride'`; the ride scene opens `'West breakfast run'`. Before each screenshot, assert the scene's expected text is on the page; a failed scene makes the process exit non-zero and never leaves an old capture behind.
- [ ] **Step 2:** Run the capture into a scratch folder (never over the picture set) against a demo web build of this branch, following `HOW-TO-REMAKE.md`. Expected: all eight scenes, exit code 0. Look at each picture.
- [ ] **Step 3:** `HOW-TO-REMAKE.md`: the pinned date only keeps retakes repeatable; the 28/10 special case is gone; picture 03 uses the always-on ride; the set on the listing predates this change (old ride names and dates); at the next retake, update the alt text table in the repo's `docs/store/images/README.md` (picture 06 loses the live ride button).
- [ ] **Step 4:** The Rusty Bus handover: add a dated line (14/11/2026) under line 55 that the "ride has passed" fallback is gone because Ride for Kids is now always ahead. Commit: "Rusty Bus handover: the passed-ride fallback is gone".

### Task 8: Prove it

- [ ] `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`: all clean, output kept.
- [ ] The runtime fingerprint is unchanged: `createFingerprintAsync(root, { platforms: [p], silent: true })` from `expo/fingerprint` for android and ios gives the same hash on this branch as on `main` in the same checkout (on `main` here: android `d9eb89ba7ddb61e920be5a0bd626d4d82025210a`, ios `0cf536f760a43a23a3d7f74ec9ad52c32680164e`).
- [ ] `compare.ts`: the final list of differences, read line by line against Tasks 3 to 5's expected lists.
- [ ] Demo web build at 390×844 with the page clock on 14/11/2026, 31/12/2026, 15/02/2027 and 20/07/2027, as Spanner and as Torque: Home, Rides, West breakfast run, Meetings and votes, Chat, Invites, Board. Look at every picture for a stale date, a wrong weekday or month word, or anything red that the spec does not list. Play the voice note once.
- [ ] Independent review of the whole diff against the spec; fix Critical and Important findings.
