# iPhone readiness: what the audit found and what we change

31/10/2026. Bounded fixes from a four-way audit of the app's first iPhone build and App Store review
risks (62 agents: four auditors, two skeptics per finding). Approved by Claude (Jeff's standing call),
shown to Jeff, who can veto. The first iOS simulator build (EAS 41190d88) already compiles, so this is
about uploads, App Review and iPhone behaviour, not compiling.

## The split

- **This spec, this branch (`claude/project-thread-fknpum`):** config, runtime and paperwork fixes
  that need no database change.
- **Separate thread (asked for):** the Guideline 1.2 user-generated-content safeguards. They need
  SQL (terms acceptance stored server-side, reports on listings/builds/nominations/profiles, a
  suspension that removes posting rights) and a live paste, so they get their own spec and lane.
- **Paperwork doc** (Store paperwork, Claude Doc): rewritten review notes, the full current age rating
  questionnaire (18+ override), privacy label corrections. Claude edits it directly.

## Why one PR for everything in `app.json`

Any `app.json` change alters the Android runtime fingerprint (measured: 6c6e6e65 → 3848c580), which
cuts Jeff's S25 preview build off from over-the-air updates until a new Android build is installed.
So every iOS `app.json` change lands in this one PR, and a new Android preview build is made from CI
and installed on the S25 straight after it merges. JS-only changes don't move the fingerprint.

## Changes

### 1. Upload validation (app.json, package.json, a local plugin)

- `ios.privacyManifests` UserDefaults reasons: `CA92.1` + `1C8F.1` (the app reads App Group defaults
  that the share extension writes).
- New local config plugin `plugins/withShareExtensionPrivacy.js`, listed in `plugins` **before**
  `"expo-sharing"` (xcodeproj mods run in reverse order, so it must run after the extension target
  exists). It writes `ios/expo-sharing-extension/PrivacyInfo.xcprivacy` (NSPrivacyTracking false,
  empty tracking domains and collected types, UserDefaults `1C8F.1`, FileTimestamp `C617.1`) and adds
  it to the **extension target's own** Resources phase. Don't use `addResourceFile` /
  `pbxResourcesBuildPhaseObj` (they find the main app's phase by comment); find the target named
  `expo-sharing-extension` in the native target section and the entry of its `buildPhases` whose
  value is a `PBXResourcesBuildPhase`. Proven by a scratch prebuild: the file is in that phase.
- Build the two SDWebImage consumers from source so the ipa doesn't embed a privacy-manifest-less
  SDWebImage.framework: `package.json` → `"expo": { "autolinking": { "ios": { "buildFromSource":
  ["expo-image", "expo-image-manipulator"] } } }`. Re-run the ios-simulator CI build afterwards.

### 2. Purpose strings (app.json)

- One camera sentence on both `expo-image-picker.cameraPermission` and `expo-camera.cameraPermission`:
  "Rustnuts uses your camera to scan the club's check-in code at rides and meetings, and to take
  photos and videos for club chats." (image-picker's value is the one that wins today; setting both
  makes it order-proof).
- `expo-camera.microphonePermission`: the shared mic sentence instead of `false` (false deletes the key
  and only plugin order saves it now).
- `expo-location`: `motionUsagePermission: false` (never used), `locationAlwaysPermission` real text
  (same as the always-and-when-in-use text), `locationFullAccuracyPermission: false`.
- Test in `src/appConfig.test.ts`: both camera strings identical; no plugin option left at a default
  `$(PRODUCT_NAME)` string for the permissions we use.

### 3. Time-sensitive ride alerts

- `ios.entitlements`: `com.apple.developer.usernotifications.time-sensitive: true`.
- `src/data/liveTracker.ts` live-alert local notification: `interruptionLevel: 'timeSensitive'`.
- `supabase/functions/_shared/sendPush.ts`: `interruptionLevel?: 'time-sensitive'` on `ExpoMessage`,
  set for kind `live-alert` only. (Edge function redeploy is Jeff's paste, later; no SQL.)

### 4. Live ride on iPhone (`src/data/liveTracker.ts`)

- On iOS, start `Location.startLocationUpdatesAsync(LIVE_TASK, …)` as soon as foreground permission
  is granted, before asking for Always, and return `'background'` when it starts (iOS keeps a
  foreground-started task running behind the blue pill with When-In-Use). Always stays optional and is
  asked once (flag in AsyncStorage), failures caught. Android path unchanged.
- `deferredUpdatesInterval: 25_000` on iOS only (iOS ignores `timeInterval`).
- JS throttle in `handleFix`: run the `stopsAt` check first; skip the `update_live_position` post when
  a post is in flight or the last attempt was under 25 s ago, unless an alert or stop is queued;
  still tell listeners the fix so the rider's own pin moves. Tests on the pure throttle decision.

### 5. Ride comms on iPhone (`src/data/rideVoiceLive.ts`)

- iOS `audioCategoryOptions: ['allowBluetooth', 'defaultToSpeaker']`; keep `voiceChat`; no
  `mixWithOthers` (a mixable session can't own Now Playing, which the headset-button mute needs).
  Drop or comment the unused first argument of `setupIOSAudioManagement`.

### 6. The review demo must make sound (`src/data/rideVoice.tsx`)

- In demo mode on a phone, Connect plays a bundled looping clip (`assets/sounds/demo_ride_comms.wav`,
  made in the repo's scripts folder: low engine rumble with radio squelch, under 10 s, 16-bit mono
  PCM, no speech) through expo-audio after `setAudioModeAsync({ playsInSilentMode: true,
  shouldPlayInBackground: true })`, so a reviewer who locks the phone still hears it; Disconnect stops
  it and restores the audio mode. Web keeps the silent demo. The card's "Demo: the other riders are
  made up" line gains "and this is sample audio".
- The voice-note recorder's `setAudioModeAsync` calls (`src/ui/VoiceBits.tsx`) keep
  `shouldPlayInBackground: true` while on a call (demo or real), the same way line 192 checks
  `onCall`, so recording a voice note doesn't kill background audio.

### 7. Submit and docs

- `eas.json` `submit.production.ios`: add `"appName": "Rustnuts SMC", "language": "en-AU"` (test).
- `docs/store/production-build.md`: the iOS first-time steps (interactive `eas credentials -p ios`
  with Account Holder/Admin Apple ID: distribution cert, both bundle ids, app group, push key; create
  the App Store Connect app by hand as "Rustnuts SMC", English (Australia); check the first ipa for
  `Frameworks/SDWebImage.framework/PrivacyInfo.xcprivacy` and `PlugIns/*.appex/PrivacyInfo.xcprivacy`).
- `site/support.html` beside privacy.html: what the app is, legal name, how accounts work, deletion,
  `mailto:apps@rustnutssmc.com.au`; linked from index.html. Support URL becomes
  https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/support.html.
- `docs/store/privacy-answers.md`: Apple adds Diagnostics › Crash Data (Linked: No; the Expo update
  client sends the last fatal JS error and a random install id) and Purchases › Purchase History
  (merch orders, paid outside the app); remove both from "Not collected". Google: App info and
  performance › Crash logs; Financial info › Purchase history.
- `src/domain/privacyPolicy.ts`: one sentence on update error reports going to Expo; then
  `npm run build:privacy` so `site/privacy.html` matches (its test checks this).

## Decisions

- iPad stays declared (`supportsTablet: true`): the 640 pt content cap already exists and the iPad
  screenshots are made. Check the map, scanner, video and chat-with-keyboard in landscape on an iPad
  once TestFlight exists; drop iPad for 1.0 only if that check fails.
- GIPHY stays at rating R; the age rating is overridden to 18+ (the club is adults only, and Google is
  already "18 and over").
- The 'fetch' background mode comes from expo-task-manager and stays.

## Not in scope

Guideline 1.2 safeguards (separate thread), the Apple account itself, the live SQL for the edge
function redeploy, iPad landscape testing (needs a device).
