// Takes the voice library's screen-sharing service back out of the Android manifest.
//
// @livekit/react-native-webrtc's own manifest declares com.oney.WebRTCModule.MediaProjectionService
// (foregroundServiceType "mediaProjection"). It only starts after a screen-capture prompt
// (getDisplayMedia), and ride comms never shares a screen: the app publishes the microphone only and
// the ride-voice-token grant allows nothing else. Google Play asks for a declaration and a video for
// each foreground-service type an app carries, and its policy says not to carry types the app doesn't
// use, so the Android build leaves this one out. (LiveKit's own enableScreenShareService option only
// writes meta-data; it can't remove the service.)
//
// The library's manifest is merged in at build time, so this writes Android's own merge marker,
// tools:node="remove", into the app's main manifest. To bring screen sharing back one day: drop this
// plugin, add FOREGROUND_SERVICE_MEDIA_PROJECTION, allow screen_share in the voice token, and declare
// mediaProjection in Play Console.

const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SCREEN_SHARE_SERVICE = 'com.oney.WebRTCModule.MediaProjectionService';

/** The manifest with exactly one remove marker for the screen-share service; everything else is kept. */
function withoutScreenShare(manifest) {
  const withTools = AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(withTools);
  app.service = [
    ...(app.service ?? []).filter((service) => service.$?.['android:name'] !== SCREEN_SHARE_SERVICE),
    { $: { 'android:name': SCREEN_SHARE_SERVICE, 'tools:node': 'remove' } },
  ];
  return withTools;
}

const withoutScreenShareService = (config) =>
  withAndroidManifest(config, (config) => {
    config.modResults = withoutScreenShare(config.modResults);
    return config;
  });

module.exports = withoutScreenShareService;
module.exports.withoutScreenShare = withoutScreenShare;
module.exports.SCREEN_SHARE_SERVICE = SCREEN_SHARE_SERVICE;
