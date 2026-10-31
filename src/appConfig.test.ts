import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const expo = JSON.parse(readFileSync(join(__dirname, '../app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(join(__dirname, '../eas.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

type PluginEntry = string | [string, Record<string, unknown>?];
const plugins: PluginEntry[] = expo.plugins;
const pluginName = (p: PluginEntry) => (typeof p === 'string' ? p : p[0]);
const pluginOptions = (name: string): Record<string, unknown> => {
  const entry = plugins.find((p) => pluginName(p) === name);
  assert.ok(entry, `plugin ${name} is listed`);
  return typeof entry === 'string' ? {} : (entry[1] ?? {});
};

test('iOS builds answer the export question themselves (HTTPS and WebRTC only, both exempt)', () => {
  assert.equal(expo.ios.config?.usesNonExemptEncryption, false);
});

test('iOS privacy manifest says no tracking and gives a reason for each required-reason API', () => {
  const pm = expo.ios.privacyManifests;
  assert.equal(pm?.NSPrivacyTracking, false);
  const reasons = Object.fromEntries(
    (pm?.NSPrivacyAccessedAPITypes ?? []).map((t: { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] }) => [
      t.NSPrivacyAccessedAPIType,
      t.NSPrivacyAccessedAPITypeReasons,
    ]),
  );
  // React Native and AsyncStorage use these; Apple rejects uploads that use them without a reason.
  // 1C8F.1 covers the App Group defaults the share extension writes and the app reads.
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryUserDefaults, ['CA92.1', '1C8F.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryFileTimestamp, ['C617.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategorySystemBootTime, ['35F9.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryDiskSpace, ['E174.1']);
});

test('the share extension gets its own privacy manifest, added after expo-sharing creates the target', () => {
  const names = plugins.map(pluginName);
  const ours = names.indexOf('./plugins/withShareExtensionPrivacy.js');
  const sharing = names.indexOf('expo-sharing');
  assert.ok(ours >= 0, 'the local plugin is listed');
  assert.ok(sharing >= 0, 'expo-sharing is listed');
  // Xcode project mods run in reverse list order, so listing ours first makes it run after the target exists.
  assert.ok(ours < sharing, 'the local plugin is listed before expo-sharing');
});

test('the share extension privacy manifest declares the APIs the extension touches and no tracking', async () => {
  const { shareExtensionPrivacyManifest } = await import('../plugins/withShareExtensionPrivacy.js');
  const manifest = shareExtensionPrivacyManifest();
  assert.equal(manifest.NSPrivacyTracking, false);
  assert.deepEqual(manifest.NSPrivacyTrackingDomains, []);
  assert.deepEqual(manifest.NSPrivacyCollectedDataTypes, []);
  const reasons = Object.fromEntries(
    manifest.NSPrivacyAccessedAPITypes.map((t) => [t.NSPrivacyAccessedAPIType, t.NSPrivacyAccessedAPITypeReasons]),
  );
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryUserDefaults, ['1C8F.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryFileTimestamp, ['C617.1']);
});

test('camera purpose strings agree, whichever plugin writes last', () => {
  const picker = pluginOptions('expo-image-picker');
  const camera = pluginOptions('expo-camera');
  assert.equal(typeof camera.cameraPermission, 'string');
  assert.equal(camera.cameraPermission, picker.cameraPermission);
  assert.match(String(camera.cameraPermission), /check-in code/);
  assert.match(String(camera.cameraPermission), /photos and videos/);
});

test('microphone purpose string is set on every plugin that can write it', () => {
  const picker = pluginOptions('expo-image-picker');
  const camera = pluginOptions('expo-camera');
  const audio = pluginOptions('expo-audio');
  assert.equal(typeof camera.microphonePermission, 'string');
  assert.ok(String(camera.microphonePermission).length > 0);
  assert.equal(camera.microphonePermission, picker.microphonePermission);
  assert.equal(audio.microphonePermission, picker.microphonePermission);
});

test('location permissions: no motion or precise-location prompts, and a real Always sentence', () => {
  const loc = pluginOptions('expo-location');
  assert.equal(loc.motionUsagePermission, false);
  assert.equal(loc.locationFullAccuracyPermission, false);
  assert.equal(typeof loc.locationAlwaysPermission, 'string');
  assert.doesNotMatch(String(loc.locationAlwaysPermission), /PRODUCT_NAME/);
  assert.equal(loc.locationAlwaysPermission, loc.locationAlwaysAndWhenInUsePermission);
});

test('no permission we use is left at a plugin default "$(PRODUCT_NAME)" sentence', () => {
  const used: Record<string, string[]> = {
    'expo-image-picker': ['photosPermission', 'cameraPermission', 'microphonePermission'],
    'expo-camera': ['cameraPermission', 'microphonePermission'],
    'expo-audio': ['microphonePermission'],
    'expo-location': ['locationWhenInUsePermission', 'locationAlwaysAndWhenInUsePermission', 'locationAlwaysPermission'],
  };
  for (const [name, keys] of Object.entries(used)) {
    const options = pluginOptions(name);
    for (const key of keys) {
      const value = options[key];
      assert.equal(typeof value, 'string', `${name}.${key} is written out`);
      assert.ok(String(value).startsWith('Rustnuts'), `${name}.${key} names the app itself`);
    }
  }
});

test('live ride alerts may break through Focus as time-sensitive notifications', () => {
  assert.equal(expo.ios.entitlements?.['com.apple.developer.usernotifications.time-sensitive'], true);
});

test('the SDWebImage consumers build from source so the ipa carries no manifest-less framework', () => {
  const from: string[] = pkg.expo?.autolinking?.ios?.buildFromSource ?? [];
  assert.ok(from.includes('expo-image'));
  assert.ok(from.includes('expo-image-manipulator'));
});

test('iOS store builds are submitted with the club Apple account to the right App Store listing', () => {
  const ios = eas.submit.production.ios;
  assert.equal(ios?.appleId, 'apps@rustnutssmc.com.au');
  assert.equal(ios?.appName, 'Rustnuts SMC');
  assert.equal(ios?.language, 'en-AU');
});
