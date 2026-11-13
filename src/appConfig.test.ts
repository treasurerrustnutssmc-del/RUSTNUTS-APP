import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_LINK_HOST, APP_LINK_PATH } from './domain/appLinks';

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

test('saving a ride replay to Photos has an add-only purpose string (the share sheet crashes without it)', () => {
  assert.equal(
    expo.ios.infoPlist?.NSPhotoLibraryAddUsageDescription,
    'Rustnuts saves ride replays you choose to keep to your photos.',
  );
});

test('the share extension shows as "Rustnuts" in the iOS share sheet', async () => {
  const { shareExtensionDisplayName } = await import('../plugins/withShareExtensionPrivacy.js');
  const written = { CFBundleDisplayName: 'expo-sharing-extension', CFBundleName: '$(PRODUCT_NAME)', NSExtension: { a: 1 } };
  const named = shareExtensionDisplayName(written);
  assert.equal(named.CFBundleDisplayName, 'Rustnuts');
  assert.equal(named.CFBundleName, 'Rustnuts');
  assert.deepEqual(named.NSExtension, { a: 1 }, 'the rest of expo-sharing’s plist is kept');
});

test('the unused background "fetch" mode expo-task-manager adds is taken back out', async () => {
  const names = plugins.map(pluginName);
  assert.ok(names.includes('./plugins/withoutBackgroundFetch.js'), 'the local plugin is listed');
  const { withoutFetchMode } = await import('../plugins/withoutBackgroundFetch.js');
  assert.deepEqual(withoutFetchMode({ UIBackgroundModes: ['audio', 'fetch', 'location'], X: 1 }), {
    UIBackgroundModes: ['audio', 'location'],
    X: 1,
  });
  assert.deepEqual(withoutFetchMode({ X: 1 }), { X: 1 }, 'a plist with no background modes is left alone');
});

test('expo-system-ui is installed so the dark background and interface style reach the native app', () => {
  assert.ok(pkg.dependencies['expo-system-ui'], 'expo-system-ui is a dependency');
});

test('iPhone emergency texts can go to every ride leader (expo-sms)', () => {
  assert.ok(pkg.dependencies['expo-sms'], 'expo-sms is a dependency');
});

test('the app privacy manifest declares every data type on the App Store privacy label', () => {
  type Collected = {
    NSPrivacyCollectedDataType: string;
    NSPrivacyCollectedDataTypeLinked: boolean;
    NSPrivacyCollectedDataTypeTracking: boolean;
    NSPrivacyCollectedDataTypePurposes: string[];
  };
  const collected: Collected[] = expo.ios.privacyManifests?.NSPrivacyCollectedDataTypes ?? [];
  const p = 'NSPrivacyCollectedDataType';
  // From docs/store/privacy-answers.md (Apple table), plus merch shipping, support and feedback reports.
  const linked: Record<string, boolean> = {
    [`${p}Name`]: true,
    [`${p}EmailAddress`]: true,
    [`${p}PhoneNumber`]: true,
    [`${p}PhysicalAddress`]: true,
    [`${p}PreciseLocation`]: true,
    [`${p}OtherFinancialInfo`]: true,
    [`${p}PhotosorVideos`]: true,
    [`${p}AudioData`]: true,
    [`${p}EmailsOrTextMessages`]: true,
    [`${p}OtherUserContent`]: true,
    [`${p}SearchHistory`]: false,
    [`${p}UserID`]: true,
    [`${p}OtherDataTypes`]: true,
    [`${p}PurchaseHistory`]: true,
    [`${p}CrashData`]: false,
    [`${p}CustomerSupport`]: true,
    [`${p}OtherDiagnosticData`]: true,
    [`${p}CoarseLocation`]: true,
    [`${p}Health`]: true,
    [`${p}ProductInteraction`]: true,
  };
  const purpose = 'NSPrivacyCollectedDataTypePurpose';
  // Club-chat photos the crew puts on the public website count as the developer's own marketing.
  const purposes: Record<string, string[]> = {
    [`${p}PhotosorVideos`]: [`${purpose}AppFunctionality`, `${purpose}DeveloperAdvertising`],
  };
  assert.deepEqual(collected.map((c) => c.NSPrivacyCollectedDataType).sort(), Object.keys(linked).sort());
  for (const c of collected) {
    assert.equal(c.NSPrivacyCollectedDataTypeLinked, linked[c.NSPrivacyCollectedDataType], `${c.NSPrivacyCollectedDataType} linked`);
    assert.equal(c.NSPrivacyCollectedDataTypeTracking, false, `${c.NSPrivacyCollectedDataType} not tracking`);
    assert.deepEqual(
      c.NSPrivacyCollectedDataTypePurposes,
      purposes[c.NSPrivacyCollectedDataType] ?? [`${purpose}AppFunctionality`],
      `${c.NSPrivacyCollectedDataType} purposes`,
    );
  }
});

// Version 1.0 is iPhone only (Jeff, 13 Nov 2026). iPads run it in the iPhone-size window.
test('1.0 is an iPhone app: no iPad layout, so no iPad screenshots', () => {
  assert.equal(expo.ios.supportsTablet, false);
});

// Website links that open the app: only /open/ on www, so every other club page stays a web page.
test('Android opens only www.rustnutssmc.com.au/open links in the app, verified', () => {
  const filters = expo.android.intentFilters ?? [];
  const https = filters.filter((f: { data?: { scheme?: string }[] }) => (f.data ?? []).some((d) => d.scheme === 'https'));
  assert.equal(https.length, 1);
  const [f] = https;
  assert.equal(f.action, 'VIEW');
  assert.equal(f.autoVerify, true);
  assert.deepEqual([...f.category].sort(), ['BROWSABLE', 'DEFAULT']);
  assert.deepEqual(f.data, [{ scheme: 'https', host: APP_LINK_HOST, pathPrefix: APP_LINK_PATH }]);
});

test('iPhone opens www.rustnutssmc.com.au links in the app (the website file names the paths)', () => {
  assert.deepEqual(expo.ios.associatedDomains, [`applinks:${APP_LINK_HOST}`]);
});

// Google Play asks for a declaration and a video for every foreground-service type an Android app
// carries. Rustnuts uses two: location (live ride) and microphone (ride comms). The libraries bring
// three extras the app never starts, so the Android build leaves them out.
test('expo-audio adds no media-playback foreground service on Android (nothing calls lock-screen controls)', () => {
  const audio = pluginOptions('expo-audio');
  assert.equal(audio.enableBackgroundPlayback, false);
  assert.notEqual(audio.enableBackgroundRecording, true);
});

test('iOS keeps background audio on its own once expo-audio stops adding it', () => {
  assert.ok(expo.ios.infoPlist.UIBackgroundModes.includes('audio'), 'ride comms and the demo call keep going on a locked iPhone');
});

test('the template’s screen-overlay permission is blocked (only the dev FPS overlay uses it)', () => {
  assert.ok((expo.android.blockedPermissions ?? []).includes('android.permission.SYSTEM_ALERT_WINDOW'));
});

test('no plugin option brings a media-playback or screen-share service back', () => {
  // expo-video's two options must stay unset, not just "not true": set to false, its plugin runs after
  // app.json and strips "audio" from the iPhone's background modes, so ride comms would cut out on a
  // locked iPhone. Set to true, they bring a media-playback service back on Android.
  const video = pluginOptions('expo-video');
  assert.equal('supportsBackgroundPlayback' in video, false, 'expo-video supportsBackgroundPlayback stays unset');
  assert.equal('supportsPictureInPicture' in video, false, 'expo-video supportsPictureInPicture stays unset');
  const livekit = pluginOptions('@livekit/react-native-expo-plugin') as { android?: Record<string, unknown> };
  assert.notEqual(livekit.android?.enableScreenShareService, true);
});

test('the voice library’s unused screen-share service is taken out of the Android manifest', async () => {
  const names = plugins.map(pluginName);
  assert.ok(names.includes('./plugins/withoutScreenShareService.js'), 'the local plugin is listed');
  const { withoutScreenShare, SCREEN_SHARE_SERVICE } = await import('../plugins/withoutScreenShareService.js');
  assert.equal(SCREEN_SHARE_SERVICE, 'com.oney.WebRTCModule.MediaProjectionService');
  const manifest = () => ({
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        { $: { 'android:name': '.MainApplication' }, service: [{ $: { 'android:name': 'expo.modules.ridecomms.RideCommsService' } }] },
      ],
    },
  });
  const once = withoutScreenShare(manifest());
  assert.equal(once.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools', 'tools namespace added');
  const services = (m: typeof once) => m.manifest.application[0].service ?? [];
  assert.ok(
    services(once).some((s: { $: Record<string, string> }) => s.$['android:name'] === 'expo.modules.ridecomms.RideCommsService'),
    'ride comms service kept',
  );
  const removals = (m: typeof once) =>
    services(m).filter((s: { $: Record<string, string> }) => s.$['android:name'] === SCREEN_SHARE_SERVICE);
  assert.deepEqual(removals(once), [{ $: { 'android:name': SCREEN_SHARE_SERVICE, 'tools:node': 'remove' } }]);
  assert.equal(removals(withoutScreenShare(once)).length, 1, 'running it twice still leaves one remove marker');
  const bare = withoutScreenShare({ manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] } });
  assert.equal(removals(bare).length, 1, 'an application with no services gets the marker too');
});

// The libraries' own manifests are merged into the app at build time. If a library update renames
// the screen-share service, or a new dependency brings another foreground-service type, Play would
// ask about it again; this reads every library manifest the build can merge and catches that early.
const root = join(__dirname, '..');
const libraryDirs = (): string[] => {
  const nm = join(root, 'node_modules');
  const top = readdirSync(nm).filter((n) => !n.startsWith('.'));
  const packages = top.flatMap((n) => (n.startsWith('@') ? readdirSync(join(nm, n)).map((s) => join(nm, n, s)) : [join(nm, n)]));
  return [...packages, ...readdirSync(join(root, 'modules')).map((n) => join(root, 'modules', n))];
};
const foregroundServices = (dir: string): { name: string; types: string[] }[] => {
  const manifestPath = join(dir, 'android/src/main/AndroidManifest.xml');
  if (!existsSync(manifestPath)) return [];
  const xml = readFileSync(manifestPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const gradle = ['android/build.gradle', 'android/build.gradle.kts'].map((f) => join(dir, f)).find((f) => existsSync(f));
  const namespace =
    xml.match(/\bpackage="([^"]+)"/)?.[1] ?? (gradle ? readFileSync(gradle, 'utf8').match(/namespace\s*=?\s*["']([^"']+)["']/)?.[1] : undefined);
  return [...xml.matchAll(/<service\b[^>]*>/g)]
    .map(([tag]) => {
      const raw = tag.match(/android:name="([^"]+)"/)?.[1] ?? '';
      const types = tag.match(/android:foregroundServiceType="([^"]+)"/)?.[1]?.split('|') ?? [];
      return { name: raw.startsWith('.') ? `${namespace}${raw}` : raw, types };
    })
    .filter((s) => s.types.length > 0);
};

test('every foreground service a library brings is location or microphone, or is taken out', async () => {
  const { SCREEN_SHARE_SERVICE } = await import('../plugins/withoutScreenShareService.js');
  const found = libraryDirs().flatMap(foregroundServices);
  assert.ok(
    found.some((s) => s.name === 'expo.modules.ridecomms.RideCommsService' && s.types.includes('microphone')),
    'the scan sees ride comms (so it is reading the manifests)',
  );
  assert.ok(
    found.some((s) => s.name === SCREEN_SHARE_SERVICE),
    'the voice library still declares its screen-share service under the name the plugin removes',
  );
  for (const s of found.filter((f) => f.name !== SCREEN_SHARE_SERVICE)) {
    for (const t of s.types) assert.ok(['location', 'microphone'].includes(t), `${s.name} brings a "${t}" foreground service`);
  }
});
