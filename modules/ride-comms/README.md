# ride-comms (local Expo module)

Keeps ride comms going with the screen off and turns the headset button into mute.

- `start(title)`: Android starts a foreground service of type `microphone` (the notification says the
  title) with a MediaSession for the headset button; iOS registers the remote commands.
- `stop()`: undoes it.
- Event `onHeadsetToggle`: the headset's play/pause button was pressed.

Linked automatically from `modules/` by Expo autolinking; never edit `ios/` or `android/` at the root.
The app reaches it through `src/data/rideCommsNative.ts`, which copes with builds that don't have it.
See docs/superpowers/specs/2026-10-24-ride-comms-design.md.
