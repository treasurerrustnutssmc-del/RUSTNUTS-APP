// Which files decide the app's runtime fingerprint (app.json: runtimeVersion.policy "fingerprint").
// A phone only takes an over-the-air update built for the same fingerprint, so anything listed
// here as skipped can change without forcing a new native build onto every test phone.
// https://docs.expo.dev/versions/v58.0.0/sdk/fingerprint/
//
// The first six are Expo's default ("balanced") skips; naming sourceSkips replaces the defaults,
// so they are spelled out. PackageJsonScriptsAll is ours: npm scripts never reach the native app,
// yet each scripts edit stranded every installed test build (31/10, and twice on 1/11).
// src/domain/buildFingerprint.test.ts fails if Expo's defaults change under us.

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: [
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'ExpoConfigVersions',
    'ExpoConfigRuntimeVersionIfString',
    'EasJson',
    'Easignore',
    'AutolinkingConfigPaths',
    'PackageJsonScriptsAll',
  ],
};
