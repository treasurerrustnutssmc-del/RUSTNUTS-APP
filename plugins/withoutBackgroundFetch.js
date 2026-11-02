// Takes the "fetch" background mode back out of the iOS Info.plist.
//
// expo-task-manager's plugin always adds UIBackgroundModes "fetch" (for expo-background-fetch /
// expo-background-task). Rustnuts only runs a background location task during a live ride, and
// keeps ride comms going with "audio", so "fetch" is unused. App Review asks about every background
// mode an app declares, so we don't declare one we don't use.
//
// expo-task-manager isn't listed in app.json; it is applied as an auto plugin after the listed ones,
// and Info.plist mods run in reverse order, so this mod runs after its mod wherever it's listed.

const { withInfoPlist } = require('expo/config-plugins');

/** The Info.plist without the "fetch" background mode; everything else is kept. */
function withoutFetchMode(infoPlist) {
  if (!Array.isArray(infoPlist.UIBackgroundModes)) return infoPlist;
  return { ...infoPlist, UIBackgroundModes: infoPlist.UIBackgroundModes.filter((mode) => mode !== 'fetch') };
}

const withoutBackgroundFetch = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults = withoutFetchMode(config.modResults);
    return config;
  });

module.exports = withoutBackgroundFetch;
module.exports.withoutFetchMode = withoutFetchMode;
