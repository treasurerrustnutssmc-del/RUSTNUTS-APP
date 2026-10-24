# Ride comms (Stage 6, part 5)

Self-approved by Claude on 24 Oct 2026. Jeff can veto. Classification: **architectural** (a new
service, native code, an Edge Function and a new screen section).

## What Jeff asked for

- Replace the Discord "Ride-Comms" voice channel with voice inside the app.
- **Open mic, never push-to-talk:** hands stay on the bars.
- **Noise suppression** for wind and engine noise.
- **Mute from the headset:** riders mute with the button on their Cardo or Sena.
- **One big Connect** before rolling out and **one big Disconnect** after, so nobody touches the phone
  while riding.
- **Service:** LiveKit Cloud. Jeff chose it on 24 Oct 2026, and he creates the account and gives the
  key.

## Decisions (Claude's, Jeff can veto)

- **One voice room per ride.** It's open during the same live window as live ride mode: from 2 hours
  before the start to 2 hours after the end.
- **Who can join:** the people who can go live on that ride. The database decides with the live ride
  rules (`private.live_problem`): approved members, within the window.
- **No location needed:** voice doesn't need live location to be on. They're separate switches.
- **Nothing is recorded:** the token gives no recording rights, and no recording is set up in LiveKit.
- **Audio only:** a token can only publish a microphone, and never data or video.
- **Open mic by default:** Connect turns the microphone on. Mute is a big toggle on screen and on the
  headset button.
- **Noise:** WebRTC's own noise suppression, echo cancellation and auto gain are on, and iOS uses
  voice-chat mode (Apple's voice processing). LiveKit's Krisp filter is a later step, after a test on a
  real ride.
- **Screen off:**
  - **iPhone:** the `audio` background mode keeps the call going.
  - **Android:** a foreground service of type `microphone` keeps it going, with the notification
    "Ride comms is on. Tap to open."
- **Headset button:**
  - **Android:** a MediaSession in that service turns the button's play/pause into mute and unmute.
  - **iPhone:** the remote command centre does the same with toggle play/pause.
  - If a headset sends something else, the on-screen Mute still works.
  - This needs a real-phone test with a Cardo and a Sena.
- **Package versions:** pinned to September 2026 releases rather than last week's:
  - `@livekit/react-native` 3.0.0;
  - `@livekit/react-native-webrtc` 144.2.0;
  - `@livekit/react-native-expo-plugin` 1.0.3;
  - `livekit-client` 2.22.4.
- **No web and no Expo Go:** a development build is needed. The web preview and the demo show the
  screen with made-up riders on air, so it can be checked.

## The pieces

### Database (`20270201030000_ride_voice.sql`)

- `public.ride_voice_room(p_ride uuid) returns jsonb`. It runs as security definer, signed-in members
  only, and returns `{ room: 'ride-<id>', name: <short name> }`.
- It raises `private.live_problem`'s words when the member can't join:
  - "Sign in first.";
  - "Only approved members can do that.";
  - the live window messages.
- Tested in `supabase/tests/ride_voice_test.sql`.

### Token (`supabase/functions/ride-voice-token`, with JWT verification on)

- **The request:** `POST { rideId }`. The function calls `ride_voice_room` as the member, using
  their own JWT, so the database's rules decide.
- **The token:** it signs a LiveKit token with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, both Edge
  Function secrets that Jeff sets.
  - The identity is the member's id, and the name is their short name.
  - It's good for 3 hours.
  - Grants: `roomJoin` for that room only, `canPublish` with `canPublishSources: ['microphone']`,
    `canSubscribe`, and `canPublishData: false`.
- **The answer:** `{ url: LIVEKIT_URL, token }`.
- **When it's not set up:** if the secrets aren't set, it answers 503 "Ride comms isn't switched on
  yet."
- **Testing:** the grant logic is in `supabase/functions/_shared/voiceToken.ts` and tested with
  node:test.

### Rules (`src/domain/rideVoice.ts`, tested)

- `voiceRoster(participants, meId)`: me first, then speakers, then by name.
- **The status line**, from `voiceStatus(state)`:
  - "Not connected"
  - "Connecting…"
  - "On air · 4 riders"
  - "Muted · 4 riders"
  - "Reconnecting…"
  - "Dropped. Tap Connect to try again."
- **Messages:**
  - the microphone permission is refused: "Rustnuts needs the microphone for ride comms. Turn it on
    in your phone's settings."
  - the server isn't set up: the 503 text above.

### On the phone

- **`src/data/rideVoice.tsx`:** a `RideVoiceProvider` at the root, so a call survives moving between
  screens. Its context:
  - `state`: idle, connecting, connected, reconnecting or failed;
  - `rideId`, `participants` (id, name, speaking, muted) and `muted`;
  - `connect(rideId)`, `disconnect()` and `setMuted(b)`.
- **Native only:** the live provider uses `livekit-client` with `@livekit/react-native`
  (`registerGlobals`, `AudioSession`), and is only loaded on native builds that have the module. The
  demo and web provider fakes a room.
- **Disconnecting:** a call disconnects itself when the live window closes. Signing out disconnects
  too.
- **`modules/ride-comms`:** a local Expo module (Kotlin and Swift), set up through
  `expo-module.config.json` and never by editing `ios/` or `android/`.
  - `start(title)` / `stop()`: the Android foreground service and its MediaSession; on iOS, it
    registers the remote commands.
  - The event `onHeadsetToggle`.
  - If the module is missing (an older build), voice still works, without the headset button.
- **`app.json`:**
  - the iOS `UIBackgroundModes` gets `audio`, plus a microphone permission text for ride comms;
  - the Android permissions `RECORD_AUDIO`, `BLUETOOTH_CONNECT`, `FOREGROUND_SERVICE_MICROPHONE` and
    `FOREGROUND_SERVICE_MEDIA_PLAYBACK`;
  - the LiveKit plugin, with `audioType: 'communication'`.

### Screen

On the Live ride screen, a "Ride comms" card sits above location sharing:
- **Before connecting:** one full-width **CONNECT** button at least 88 pt tall, in the stencil font.
- **Connected:**
  - the status line;
  - a big **MUTE** / **UNMUTE** toggle;
  - who's on, with a speaking dot;
  - then one full-width **DISCONNECT**, a plain press and not a ConfirmButton, because one tap must
    end it.
- **Elsewhere in the app:** while connected, a slim "On air" bar on the tabs opens the ride.

## Testing

- **Automated:** SQL tests for `ride_voice_room`, node tests for the token grants, and the rules.
- **Screens:** checked in the demo at 390×844, connected and not.
- **Real phones**, on Jeff's list:
  - two phones in one room;
  - the screen off for 10 minutes, on iPhone and on Android;
  - the Cardo and Sena buttons;
  - wind noise at 80 km/h.

## Needs Jeff

- **LiveKit Cloud:** the account, and the URL, key and secret, set as Edge Function secrets.
- **Going live:** applying the migration and deploying the function.
- **A new build:** a development build to test.
