import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const expo = JSON.parse(readFileSync(join(__dirname, '../app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(join(__dirname, '../eas.json'), 'utf8'));

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
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryUserDefaults, ['CA92.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryFileTimestamp, ['C617.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategorySystemBootTime, ['35F9.1']);
  assert.deepEqual(reasons.NSPrivacyAccessedAPICategoryDiskSpace, ['E174.1']);
});

test('iOS store builds are submitted with the club Apple account', () => {
  assert.equal(eas.submit.production.ios?.appleId, 'apps@rustnutssmc.com.au');
});
