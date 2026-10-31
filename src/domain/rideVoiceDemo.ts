// Ride comms in the demo: a reviewer (or anyone trying the app) has nobody to talk to, so Connect
// plays a made-up room with sample audio. The pure decisions live here so they can be tested
// without a phone; src/data/rideVoice.tsx does the playing.

/** Shown on the comms card in the demo, under the open-mic explanation. */
export const DEMO_COMMS_CAPTION = 'Demo: the other riders are made up, and this is sample audio.';

/** The phone's audio settings around the demo clip: it has to keep going with the phone locked
 *  (App Review may well lock it), and let the background go again once the call ends. */
export function demoCallAudioMode(step: 'connect' | 'disconnect'): { playsInSilentMode: true; shouldPlayInBackground: boolean } {
  return { playsInSilentMode: true, shouldPlayInBackground: step === 'connect' };
}

/** The voice-note recorder's audio settings. On a ride call (demo or real) background audio stays
 *  on, so opening the microphone for a note doesn't cut the call off behind a locked screen; off a
 *  call the background setting is left as it was. */
export function voiceNoteAudioMode(
  recording: boolean,
  onCall: boolean,
): { allowsRecording: boolean; playsInSilentMode: true; shouldPlayInBackground?: true } {
  return onCall
    ? { allowsRecording: recording, playsInSilentMode: true, shouldPlayInBackground: true }
    : { allowsRecording: recording, playsInSilentMode: true };
}
