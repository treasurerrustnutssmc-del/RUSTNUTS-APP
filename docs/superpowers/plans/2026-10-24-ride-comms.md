# Ride comms (Stage 6, part 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riders join their ride's voice room with one big Connect: an open mic, muted from the headset,
and kept going with the screen off.

**Architecture:**
- The database decides who may join, using the live ride rules.
- An Edge Function turns that into a LiveKit token.
- A provider at the app root holds the call.
- A small local Expo module keeps Android's microphone alive and reads the headset button.

**Tech Stack:**
- Postgres (security definer);
- a Deno Edge Function with `livekit-server-sdk`;
- `livekit-client` and `@livekit/react-native`;
- a local Expo module in Kotlin and Swift;
- node:test.

**Spec:** `docs/superpowers/specs/2026-10-24-ride-comms-design.md`

## Global Constraints

- **Migration:** `supabase/migrations/20270201030000_ride_voice.sql`. It has no "drop" and no
  "delete".
- **Package versions** are pinned exactly: `@livekit/react-native@3.0.0`,
  `@livekit/react-native-webrtc@144.2.0`, `@livekit/react-native-expo-plugin@1.0.3` and
  `livekit-client@2.22.4`.
- **Tokens:**
  - audio only: `canPublishSources: ['microphone']`, `canPublishData: false`, and no recording grants;
  - good for 3 hours;
  - the room is `ride-<rideId>`.
- **Copy:** exactly as the spec words it.
- **Shared files:** additions only, in blocks marked `// Lane E: ride comms`.
- **No pop-ups:** Disconnect is a plain button, and nothing uses `Alert`.

## Review Focus

1. **A member who's not allowed asks for a token** (pending, outside the window, signed out): it's
   refused with the live ride's words. Tested in SQL.
2. **The secrets aren't set:** the function answers 503 with the spec's words, and the app shows them.
   Tested in TS (`tokenRequest`).
3. **An older build without the native modules gets this code over the air:** the app doesn't crash,
   and the card says to update the app. Tested by keeping the module optional.
4. **The live window closes while connected:** it disconnects by itself. Tested in the provider rule
   `shouldHangUp(ride, now)`.
5. **Two quick taps on Connect:** one connection. A guard in the provider's `connect`.

---

### Task 1: Who may join (SQL, test first)

- `public.ride_voice_room(p_ride uuid) returns jsonb`. It raises `private.live_problem(p_ride)` when
  that isn't null, and returns `{room, name}`.
- Its grants: execute for authenticated only.
- Tests in `supabase/tests/ride_voice_test.sql`, wired into `scripts/test-db.sh`:
  - an approved member inside the window gets `ride-<id>`;
  - a pending member, anon, before the window and a cancelled ride are each refused with the live
    ride's words.

### Task 2: Token logic (TS, test first)

- `supabase/functions/_shared/voiceToken.ts`:
  - `voiceGrant(room: string)` returns the VideoGrant object;
  - `TOKEN_TTL_SECONDS = 10800`;
  - `missingSecrets(env)` returns the 503 message or null.
- Tests in `src/data/voiceToken.test.ts`.
- `supabase/functions/ride-voice-token/index.ts`: the Deno entry point, excluded in `tsconfig.json`.

### Task 3: Rules (TS, test first)

- `src/domain/rideVoice.ts`:
  - `VoiceParticipant { id; name; speaking; muted }`;
  - `voiceRoster(ps, meId)`;
  - `voiceStatus(state, count, muted)`;
  - `shouldHangUp(ride, now)`;
  - the `VOICE_MSG` copy.

### Task 4: The call

- `src/data/rideVoice.tsx` holds the context and `RideVoiceProvider`. On a native build with LiveKit's
  module it uses LiveKit; otherwise it's the demo version.
- `src/data/rideVoiceLive.ts` does the LiveKit work:
  - `AudioSession` configuration (iOS playAndRecord and voiceChat; Android communication);
  - mic capture options `{ noiseSuppression: true, echoCancellation: true, autoGainControl: true }`;
  - participants from `room.remoteParticipants` and their speaking and mute events.
- `modules/ride-comms` is the local Expo module, wrapped by `src/data/rideCommsNative.ts`, which
  returns null when the module is missing.
- `app.json`: the permissions, background mode and plugin from the spec.

### Task 5: Screen

- `src/screens/rideComms.tsx`: `RideCommsCard`, shown on Live ride, and `OnAirBar`, shown above the
  tabs while connected.
- Check at 390×844 in the demo, before connecting and while connected.

### Task 6: Review and ship

- An independent reviewer, then all four checks, the PR and the merge.
- Going live (the migration, the function, the secrets) waits on Jeff.
