# Stage 6: phone superpowers (design)

Lane E of the parallel build (`/mnt/project-files/build/parallel-stages.md`). Architectural work, so this is
a written spec, approved by Claude on 24 Oct 2026 under Jeff's standing self-approval and shown to Jeff, who
can veto any part.

## What Jeff asked for

From the Ambition & Timeline doc and the project decisions:

- **Notifications.**
- **Share button**: "sharing photos, videos and links straight from your phone's share button" into the app.
- **Live ride mode** (opt-in, ride day only): split-group alerts and regroup pins for the RC and TG.
- **"I've dropped out" button** that tells the TG and RC where you are.
- **Emergency button**: shows the RC that rider's emergency contacts, with one-tap 000 and location.
- **Offline mode** for country rides with no signal.
- **Hard rule:** live location is ride day only, opt-in, switches itself off, and nothing is kept.
- **Hard rule:** no messages to members (emails, invites, pushes) until the app is finished.

## Assumptions (Claude's, Jeff can veto)

1. **Who leads a ride.** Until lane A's per-ride roles land, a *ride leader* is anyone holding an active
   Road Captain, Tail Gunner or Assistant Tail Gunner position, or a board or NEC seat. Once lane A merges,
   the ride's own RC and TG are added to that list.
2. **You see others only while you share.** Live positions are visible only to other riders sharing on the
   same ride. Nobody watches from home, the board included.
3. **No map in the first cut.** A map needs a map library and a Google Maps key (a key needs Jeff). The
   live screen lists riders with distance, direction and "last seen", and each one opens in Google Maps.
   A map can be added later without changing the data.
4. **"Nothing kept" covers alerts too.** Positions, dropped-out notes and emergency alerts are deleted
   when the ride's live window closes. Only the latest position per rider is stored, never a trail.
5. **Share into the app waits for chat.** Sharing *in* needs somewhere to put things, which is lane B's
   chat and feed. Stage 6 ships sharing a ride *out* (to Messenger and so on) now, and sharing *in* after
   lane B merges.
6. **Pushes are built but held.** The push pipeline is built and tested, with a master switch that stays
   off until launch. Android pushes also need a Firebase project (an account, so Jeff's yes), and iPhone
   needs the Apple account. Reminders a member sets on their own phone, and live-ride alerts raised by the
   app itself during a ride, are local notifications, so they need neither.

## The pieces, in build order

Each phase is its own plan and its own pull request from this lane's branch.

1. **Live ride**: live mode, dropped out, emergency, regroup pins, split alerts, local alert notifications.
2. **Offline and share out**: cached club data with an offline banner, plus a Share button on a ride.
3. **Notifications**: local ride reminders, notification settings, and the held push pipeline.
4. **Share in**: after lane B's chat is on `main`.
5. **Ride comms (voice)**: added 24 Oct 2026 at Jeff's request (relayed by lane B). See section 5.

## 1. Live ride

### The live window (`src/domain/liveRide.ts`)

- Opens **2 hours before** a ride starts.
- Closes **2 hours after** it ends. With no end time, it closes at Melbourne midnight at the end of the
  ride's last day. An all-day ride's window is its days, midnight to midnight.
- A cancelled ride has no window.
- Your own sharing stops after **12 hours** or when the window closes, whichever comes first. On a
  weekend away, that means switching it back on each morning, so it's always ride day only.

`liveProblem(me, ride, now)` says why you can't switch on, or null: sign in first, approved members only,
cancelled, "Live ride opens 2 hours before the start", "This ride's finished". The database's
`start_live_ride` gives the same answers with the same words.

### Data (migration `20270201000000_live_ride.sql`)

- `public.live_riders`: `ride_id`, `member_id`, `lat`, `lng`, `accuracy_m`, `heading`, `speed_kmh`,
  `updated_at`, `started_at`, `stops_at`. One row per rider per ride. Each update overwrites it.
- `public.ride_alerts`: `id`, `ride_id`, `member_id`, `kind` (`emergency`, `dropped`, `regroup`), `lat`,
  `lng`, `created_at`, `resolved_at`, `resolved_by`.
- Row-level security is on with no grants to `anon` or `authenticated`. Everything goes through the
  functions below (security definer), so reading the tables directly returns nothing.
- `private.live_ride_cleanup()` runs every 5 minutes from pg_cron. It deletes riders past `stops_at` and
  every rider and alert of a ride whose window has closed. The functions also ignore expired rows, so a
  late cleanup never shows anything old.

### Database actions

- `start_live_ride(ride)`: checks `liveProblem`. Creates or renews your row, with `stops_at` set to the
  earlier of window close and now plus 12 hours. No position is stored until the first update.
- `update_live_position(ride, lat, lng, accuracy, heading, speed)`: only while your row is live. Returns
  the same state as `live_ride_state`, so one call posts and polls.
- `live_ride_state(ride)`: only for someone sharing on that ride. Returns:
  - the riders: name, road name, leader or not, position, `updated_at`;
  - open alerts, with the raiser's position;
  - the phones of leaders who are sharing, so riders can ring the TG;
  - for leaders, while an emergency is open: the raiser's phone and emergency contacts.
- `raise_ride_alert(ride, kind, lat, lng)`:
  - `emergency` and `dropped`: any rider who is sharing.
  - `regroup`: leaders only. A new regroup pin replaces the last one.
  - `dropped` also stops your sharing.
- `resolve_ride_alert(alert)`: the person who raised it, or a leader. Covers "I'm OK" and "Got them".
- `stop_live_ride(ride)`: deletes your row. Your alerts stay until the window closes, so the TG still sees
  where you dropped out.

### App rules mirrored in `src/domain/liveRide.ts`

`liveWindow`, `liveProblem`, `isRideLeader`, `alertProblem` and `resolveProblem` mirror the SQL. A database
test covers each answer, and the same cases run against the demo.

The display-only helpers live there too:
- `distanceKm` and `bearing`, giving "2.4 km NE".
- `lastSeen`, giving "just now" or "4 min ago". A rider is stale after 5 minutes.
- `splitGroups(riders)`: groups riders whose latest fixes are under 5 minutes old, where riders less than
  3 km apart are in the same group. With more than one group, leaders see "Group split: 3 riders 4.2 km
  back". This is worked out on the phone and nothing is stored.

### On the phone (`src/data/liveTracker.ts`)

- **Native:** expo-location background updates, run by an expo-task-manager task.
  - Updates every 30 seconds, even standing still, at balanced accuracy (Android). iPhones only send a
    fix when the phone moves, and pause timers in the background.
  - **Known limit on iPhones:** a phone that's stopped, with the screen off, hears no new alert until it
    moves or the app is opened, and switches off late on the same terms. Part 3 fixes this with a server
    push for each new live-ride alert (`ride_alerts` joins the push outbox, sent even while the master
    switch holds other pushes once Jeff turns pushes on). Until then this goes on Jeff's phone test list.
  - Android shows a foreground-service notification: "Sharing your location with the ride".
  - The task reads the active ride and its `stops_at` from AsyncStorage. Past `stops_at`, it stops itself,
    even if the app was closed.
  - Each update's reply carries the alerts. Any alert the phone hasn't seen yet raises a local
    notification ("EMERGENCY: Rusty needs help, 2.1 km S"), so a phone in a pocket still hears it.
- **Web and Expo Go:** a foreground watch only.
- **Permissions:** foreground first, then background. If background is refused, the app still shares while
  it's open, and says so.
- **New packages:** `expo-location`, `expo-task-manager` and `expo-notifications`, added with `npx expo
  install`. They need a development build for background use, which is added to `app.json` as config
  plugins. Nothing is hand-edited in `android/` or `ios/`.
- **Live mode:** `src/data/liveRideApi.ts` wraps the RPCs.
- **Demo mode:** an in-memory copy runs the same rules, with four made-up riders placed around you who
  move a little on each poll. Demo data gains a ride that's always today, so the live screen can be shown.

### Screens

**Ride screen.** In the ride's live window, a card:
- Title: "Live ride".
- Text: "Share your location with riders on this ride. Only riders sharing can see it. Switches off at
  4:30 pm. Nothing is kept."
- A primary "Share my location" button. Once you're sharing, it becomes "Open live ride".
- Outside the window, the card isn't shown.

**Live ride screen** (`src/screens/liveRide.tsx`, stack screen `LiveRide`):
- **Top:** "Sharing. Switches off 4:30 pm", and a "Stop sharing" button.
- **Alerts** (newest first):
  - An emergency is a danger notice: who, how long ago, distance and direction, "Open in maps", and
    "Call" when a phone is known. Leaders also see the rider's emergency contacts, each with Call.
  - A dropped-out notice works the same way, in the warn tone.
  - The regroup pin is an info notice with "Open in maps".
  - Leaders see the split-group warning.
- **Riders:** one row per rider, giving name, a Leader chip, "2.4 km NE · 1 min ago", and Open in maps.
- **Actions** (sticky at the bottom, all at least 56 tall):
  - "Emergency": danger, through `ConfirmButton`, two taps to stop pocket presses.
  - "I've dropped out": secondary, through `ConfirmButton`.
  - "Drop regroup pin here": leaders only.
- **After raising an emergency:**
  - A full-width "Call 000" (a `tel:` link that works without data).
  - "Text my location", which opens SMS to the sharing leaders' phones with a maps link.
  - "I'm OK, cancel".
- **No signal:**
  - An alert raised offline is queued on the phone and sent when signal returns.
  - The screen says "No signal. Your alert will send when you're back in range. Calls to 000 can still
    work."

### Errors

- Every action shows a Notice with the database's reason.
- Location refused: "Location is off for Rustnuts. Turn it on in Settings to share."
- No fix yet: "Finding you…".

## 2. Offline and share out

### Offline (`src/data/offlineCache.ts`)

- **Saving:** after every good live load, the club data is saved to AsyncStorage under the signed-in
  user's id, with the time it was saved.
- **Starting up:** the saved copy shows at once while the fresh load runs.
- **Offline:** if a load fails because there's no connection, the app keeps showing the saved copy, with
  a warn banner: "Offline. Showing what was saved 24/10/2026 7:30 am."
- **Actions while offline** fail with "You're offline. Try again when you've got signal." There's no
  queue, except for live-ride alerts.
- **Signing out** deletes the saved copy. The copy only holds what that person was already allowed to see.

### Share out

- The ride screen gets a "Share" button using React Native's `Share` (no new package).
- It shares text like: "West breakfast run · Sat 07/11/2026 8:30 am · BP Ravenhall. RSVP in the Rustnuts
  app."
- On a web browser with no share sheet, the text is shown ready to copy.

## 3. Notifications

### Settings

- On Me, under a "Notifications" section, stored per member in `public.notification_prefs`.
- Toggles:
  - Ride reminders (on).
  - Rides I'm going to change or are cancelled (on).
  - New rides in my colours (off).
  - Board: someone's waiting for approval (on, board only).

### Ride reminders (local)

- `reminderPlan(rides, rsvps, me, prefs, now)` decides the reminders: a ride you said Going to gets one
  2 hours before it starts, and an all-day ride gets one at 7 am on its first day.
- After each load, the phone schedules what's missing and cancels what's no longer needed.
- These are on-device only and nothing is sent by the club, so they're fine before launch.

### Push (held)

- **`public.push_devices`:** each member's Expo push tokens. Saved by `register_push_device` and removed
  by `forget_push_device`, which runs on sign-out.
- **`private.push_outbox`:** filled by triggers in three cases:
  - a ride is cancelled or changes time: everyone going or maybe, with that preference on;
  - a new ride: members whose chapter colours match, with that preference on;
  - a new applicant: that chapter's board;
  - a new live-ride emergency, dropped-out rider or regroup pin: everyone sharing on that ride (for
    iPhones standing still, see part 1's known limit).
- **The `send-push` Edge Function** reads the outbox, applies the preferences, and posts to Expo's push
  service. pg_cron runs it every minute.
- **Master switch:** `private.app_settings.push_enabled` defaults to off. While it's off, the function
  marks rows "held" and sends nothing.
- **Going live needs Jeff's yes** for the Firebase project and the switch.

## 4. Share in

Self-approved 2026-10-24 once lane B's chat was on `main`. Jeff can veto.

**What it does:**
1. In Photos, Safari, Chrome, YouTube and the like, a member taps Share and then Rustnuts.
2. The app opens "Share to the club", which shows what came across and the member's chats, with Whole
   club first. That's the feed: photos posted there show in Photos.
3. Picking a chat opens it with the words and photos already in the message box. The member can add to
   it, take things out, or just press Send. Nothing is sent without that press.

**Native setup:** `expo-sharing` (SDK 58, receiving is marked experimental by Expo), set up in
`app.json`:
- **iOS:** a share extension that takes text, one web link, and up to 10 photos and videos.
- **Android:** intent filters for `text/plain`, `image/*` and `video/*`, one or several items at a time.
- It needs a new build. Expo Go and the web preview can't receive shares, and the web build never
  mounts the listener, because the library throws there.

**Rules (`src/domain/shareIn.ts`, pure and tested):**
- **What the shared items become:** `sharedDraft(items)` turns them into `{ text, media, notes }`.
  - Text and links are joined, one per line, without repeats.
  - Photos and videos become attachments, at most `MAX_MEDIA` (10).
  - Audio and other files are left out.
  - The text is cut to `MAX_BODY` (4,000 characters).
- **The notes** say what didn't come across:
  - "Only the first 10 photos and videos came across."
  - "Files and voice notes can't go in a chat, so they were left out."
  - "That was too long for one message, so it was cut to 4,000 characters."
- **Nothing usable:** if nothing came across, the screen says "Nothing here can go in a chat. Share
  photos, videos, links or words."

**On the phone (`src/data/shareIn.tsx`):**
- `IncomingShare` is mounted inside the signed-in tabs, so a share waits until the member is signed in
  and approved.
- When resolved items arrive, it measures photos and videos (their width and height, which the upload
  needs) and opens `ShareIn` with the draft.
- It then clears the items and refreshes, so sharing the same thing twice still works.
- A share that can't be read shows "That couldn't be opened. Try sharing it again."

**Screen (`src/screens/shareIn.tsx`):**
- A preview card shows the words, a strip of the photos, and any notes.
- Then come chat rows in the chat list's order, with Whole club pinned first.
- Tapping a row replaces this screen with `Chat` for that chat, with `shared: { text, media }`.
  `ChatScreen` (in a Lane E block) uses it as the starting draft and attachments.

**Testing:**
- Unit tests cover `sharedDraft`.
- The screen is checked in the demo at 390×844, with a sample share passed as a route param.
- A real-phone test (share from Photos and from Safari or Chrome, on iPhone and Android) goes on Jeff's
  test list.

**Changes from the review:**
- **The build version follows the native code.** `runtimeVersion` now uses the `fingerprint` policy,
  not `sdkVersion`. Without that, an over-the-air update carrying a new native module (this one, or
  lane B's) could reach an older build that lacks it and crash at launch.
- **Share in only loads where it can work.** It loads only when the `ExpoSharing` native module is
  there, and anything it throws is contained.
- **A link stays the link the member shared.** That holds even when the page is a picture, a PDF or a
  redirect. A link that can't be looked up with no signal still comes across, from the unresolved
  items.
- **Each shared photo or video is copied to its own name** in the cache. The library reuses the
  original file names, so two `FullSizeRender.jpg` would collide. The copies are cleared on the next
  start.
- **A video's length is read when it loads**, and a video whose length can't be read is left out with
  a note, so the 60-second limit holds. The image and thumbnail are released after measuring.
- **Sharing and screen behaviour:**
  - A second share while the screen is open starts the screen again.
  - A share that arrives while another is being measured isn't lost.
  - Android also offers Rustnuts for mixed photo and video selections (`*/*`).
- **Known, for the real-phone test:**
  - Android may reopen an old share when the app is restarted from Recents after the system closed it.
  - Single-slash `file:/` addresses on Android need checking.

## 5. Ride comms (voice)

Jeff's ask:
- It replaces the Discord "Ride-Comms" voice channel.
- **Open mic, never push-to-talk**, because hands stay on the bars.
- **Noise suppression** for wind and engine.
- **Mute from the headset:** riders mute with their Cardo or Sena button.
- **Big buttons:** one big **Connect** before rolling out and one big **Disconnect** after, so nobody
  touches the phone while riding.

Design outline (its own short spec before building):
- **Rooms:** one voice room per ride, open during the live window. Only approved members can join, and
  the server hands out a short-lived token through an Edge Function.
- **Service:** LiveKit Cloud (Jeff chose it on 24 Oct 2026).
  Creating that account and its key is Jeff's call.
- **Building:** a development build is needed, plus the provider's Expo config plugin.
- **Headset mute:** the button is read as the media play/pause key while connected.
- **Nothing is recorded.**
- **Ride chat:** voice can link to lane B's ride chat (kind `ride`) once that's on `main`.

## Testing

- **App rules** (`npm test`):
  - window edges, including daylight saving and all-day rides;
  - every refusal message;
  - leader rules;
  - distance, bearing and split grouping;
  - the reminder plan;
  - the offline cache's save, load and clear;
  - share text.
- **Database rules** (`npm run test:db`, new `supabase/tests/live_ride_test.sql`):
  - nobody can read the tables directly;
  - you can only see the state while sharing;
  - the window and the 12-hour cap;
  - alert permissions;
  - emergency contacts reach leaders only, and only while an emergency is open;
  - cleanup deletes everything after the window closes;
  - shared demo/database cases in `parity.json`.
- **Screens:** checked at 390×844 in the demo and live web builds. Background location and notifications
  can only be checked on a real phone with a development build, so that goes on Jeff's test list.

## Out of scope

- A live map.
- Ride history or replays (Stage 7).
- Headcount check-in (lane C).
- Pushes reaching anyone before launch.
