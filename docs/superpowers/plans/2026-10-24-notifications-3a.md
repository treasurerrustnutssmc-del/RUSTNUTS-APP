# Notification settings and ride reminders (Stage 6, part 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members choose which notifications they want on Me, and the phone reminds them before a ride
they said Going to.

**Architecture:**
- **Preferences:** one row per member in `public.notification_prefs`, read in the club load and saved by an
  RPC. The demo keeps them in memory.
- **Reminders:** a pure `reminderPlan` decides which reminders should exist. A small native module
  schedules the missing ones with expo-notifications and cancels the rest after every load.
- **Push:** nothing in this part. The held push pipeline is part 3b, and it uses these preferences.

**Tech Stack:** Supabase Postgres (RLS + security definer RPC), expo-notifications (already installed in
part 1), node:test.

**Spec:** `docs/superpowers/specs/2026-10-24-phone-superpowers-design.md`, section 3 ("Settings" and
"Ride reminders").

## Global Constraints

- **Migration:** `supabase/migrations/20270201010000_notification_prefs.sql`. It must not contain the
  word "drop".
- **Defaults:**
  - ride reminders: on;
  - ride changes: on;
  - new rides in my colours: off;
  - approvals: on, and shown only to board and national.
- **Reminder times:**
  - a timed ride: 2 hours before it starts;
  - an all-day ride: 7:00 am Melbourne time on its first day.
- **Which rides:**
  - only Going answers, on rides that aren't cancelled;
  - only reminders still in the future;
  - at most the next 30 (the iPhone limit is 64 scheduled notifications).
- **Copy:**
  - title "Ride in 2 hours" (timed) or "Ride today" (all day);
  - body "West breakfast run · 8:30 am · BP Ravenhall", leaving out the location when there isn't one.
- **No messages from the club:** reminders are on-device only. Nothing is sent to members.
- **Shared files:** only add, in one block per file marked `// Lane E: notifications`.

## Review Focus

1. **Answer changed to Maybe, or the ride cancelled:** its reminder is cancelled on the next load. Test in
   Task 2 (`reminderDiff`).
2. **A ride that moves time:** the reminder is rescheduled, not duplicated. Task 2: the id stays the same
   and the time differs, so it counts as cancel plus add.
3. **Reminders turned off:** every scheduled reminder is cancelled. Task 2.
4. **Sign-out or another person signing in:** the last person's reminders are cancelled. Task 3 runs the
   sync with an empty plan when `me` is null.
5. **Daylight saving day:** 7 am on the first Sunday in October is still 7 am local time. Test in Task 2.

---

### Task 1: Preferences in the database

**Files:**
- Create: `supabase/migrations/20270201010000_notification_prefs.sql`
- Create: `supabase/tests/notification_prefs_test.sql`, wired into `scripts/test-db.sh` the same way
  `live_ride_test.sql` is.

**Interfaces:**
- Table `public.notification_prefs`:
  - `member_id uuid primary key references public.members on delete cascade`;
  - `ride_reminders bool not null default true`;
  - `ride_changes bool not null default true`;
  - `new_rides bool not null default false`;
  - `approvals bool not null default true`;
  - `updated_at timestamptz not null default now()`.
- RLS is on. The `select` policy is `member_id = auth.uid()`. There's no direct write.
- `public.save_notification_prefs(p_ride_reminders bool, p_ride_changes bool, p_new_rides bool,
  p_approvals bool) returns void`:
  - it upserts the caller's row;
  - it raises 'Sign in first.' when signed out;
  - it raises 'Only approved members can do that.' when the caller isn't approved.

- [ ] **Step 1:** Write the failing SQL tests:
  - the defaults when no row exists (the app applies them, so the table is just empty);
  - saving, then reading your own row;
  - you can't read another member's row;
  - anon is refused;
  - a pending member is refused.
- [ ] **Step 2:** Run `npm run test:db` and expect it to fail.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `npm run test:db` and expect it to pass.
- [ ] **Step 5:** Commit.

### Task 2: The rules

**Files:**
- Create: `src/domain/notifications.ts`, `src/domain/notifications.test.ts`
- Modify: `src/domain/types.ts` (Lane E block): `NotificationPrefs` and the optional
  `ClubData.notificationPrefs?: NotificationPrefs | null`.

**Interfaces:**
- `interface NotificationPrefs { rideReminders: boolean; rideChanges: boolean; newRides: boolean; approvals: boolean }`
- `DEFAULT_PREFS: NotificationPrefs`
- `interface Reminder { id: string; rideId: string; at: string; title: string; body: string }`. The id is
  `ride-<rideId>`.
- `reminderPlan(rides: Ride[], rsvps: Rsvp[], meId: string | null, prefs: NotificationPrefs, now: string): Reminder[]`
  returns the reminders sorted by `at`, at most 30.
- `reminderDiff(plan: Reminder[], scheduled: { id: string; at: string }[]): { add: Reminder[]; cancel: string[] }`.
  A changed `at` counts as cancel plus add.

- [ ] **Step 1:** Write the failing tests:
  - a Going timed ride gives a reminder 2 h before, with the title and body copy;
  - an all-day ride gives one at 7 am Melbourne time, including on the DST start day (4/10/2026);
  - Maybe, Can't, cancelled and past rides give none;
  - prefs off gives none;
  - `meId` null gives none;
  - the 30 cap;
  - the diff: a new ride, a removed one, a moved one, and no change.
- [ ] **Step 2:** Run `npm test` and expect it to fail.
- [ ] **Step 3:** Implement. Use `melbourneDate`/`melbourneTime` from `rides.ts`. Find 7 am by searching
  the UTC hours of that day for the one whose Melbourne time is "7:00 am".
- [ ] **Step 4:** Run `npm test` and expect it to pass.
- [ ] **Step 5:** Commit.

### Task 3: Loading, saving and scheduling

**Files:**
- Modify (Lane E blocks):
  - `src/data/liveData.ts`: read the caller's `notification_prefs` row into `notificationPrefs`;
  - `src/data/database.types.ts`;
  - `src/data/clubContext.ts`: an optional `saveNotificationPrefs?: (p: NotificationPrefs) => Promise<void>`;
  - `src/data/LiveClubProvider.tsx` and `src/data/DemoClubProvider.tsx`: implement it.
- Create: `src/data/reminders.ts`:
  - `syncReminders(plan: Reminder[]): Promise<void>`, native only;
  - `ReminderSync`, a component that renders nothing and runs the sync whenever the data, `me` or the
    prefs change.
- Modify: `src/navigation/RootNavigator.tsx` (Lane E block): render `<ReminderSync />` once.

- [ ] **Step 1:** Write the failing test in `src/data/liveData.test.ts`: the prefs row maps to
  `notificationPrefs`, and a missing row gives null (the app then uses `DEFAULT_PREFS`).
- [ ] **Step 2:** Implement:
  - `syncReminders` reads the scheduled notifications with `data.kind === 'ride-reminder'` and applies
    `reminderDiff`;
  - it uses a date trigger, with Android channel `ride-reminders` at default importance;
  - it asks for notification permission only when the plan isn't empty;
  - with an empty plan, it cancels all ride reminders.
- [ ] **Step 3:** Run `npm test`, `npm run typecheck` and `npx expo lint`, and expect them to pass.
- [ ] **Step 4:** Commit.

### Task 4: Settings on Me

**Files:**
- Create: `src/screens/notificationSettings.tsx`: `NotificationSettings`, a card of `Toggle`s that saves on
  change and shows any error in a danger `Notice`.
- Modify: `src/screens/me.tsx` (Lane E block):
  - a "Notifications" `SectionTitle` and the card, above Privacy;
  - the Privacy note now describes live ride as it is ("Live ride location sharing is always your
    choice, switches off after the ride, and keeps nothing.").

- [ ] **Step 1:** Implement. The approvals toggle shows only when `level` is board or national. Each
  toggle's description:
  - "A reminder 2 hours before rides you’re going to.";
  - "When a ride you’re going to changes time or is cancelled.";
  - "When a ride is added in your colours.";
  - "When someone in your chapter is waiting for approval."
  - The push-based toggles get a note: "Comes with the app’s launch."
- [ ] **Step 2:** Check Me at 390×844 in the demo as a member and as board. Run Impeccable's critique,
  audit and polish by hand.
- [ ] **Step 3:** Commit.

### Task 5: Review and ship

- [ ] **Step 1:** An independent reviewer checks the diff against the spec and this plan. Fix Critical
  and Important findings.
- [ ] **Step 2:** Rebase, run all four checks, open the PR and merge.
- [ ] **Step 3:** Going live (the migration) waits on Jeff's yes, the same as part 1.
