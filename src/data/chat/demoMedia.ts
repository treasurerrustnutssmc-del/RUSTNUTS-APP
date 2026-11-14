// The demo's pictures and its one sound: the only `require`s in the demo seeds, kept apart so the
// chat's words (demoChatData.ts) load under node and can be tested. The photos are drawn scenes,
// not real members' photos.

/** The demo's pictures, by the path a message stores. */
export const DEMO_MEDIA: Record<string, number> = {
  'demo/dusk-run.jpg': require('../../../assets/demo/dusk-run.jpg'),
  'demo/coast-road.jpg': require('../../../assets/demo/coast-road.jpg'),
  'demo/twisties.jpg': require('../../../assets/demo/twisties.jpg'),
  'demo/servo-night.jpg': require('../../../assets/demo/servo-night.jpg'),
  // A made-up voice note, spoken by a computer voice, not a member's. Its script is
  // assets/demo/voice-late.txt: "Gravel here. Bike's in bits again. If anyone's got a spare ten mil
  // socket, I'm buying the first round."
  'demo/voice-late.m4a': require('../../../assets/demo/voice-late.m4a'),
};
