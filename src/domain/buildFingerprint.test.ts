import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DEFAULT_SOURCE_SKIPS, SourceSkips, createFingerprintAsync } from '@expo/fingerprint';

// Test phones only take an over-the-air update whose runtime fingerprint matches their build.
// npm scripts never reach the native app, so a scripts edit must not strand every installed build
// (it did on 31/10, twice on 1/11).
const root = join(__dirname, '../..');

test('npm scripts are left out of the runtime fingerprint', async () => {
  const fingerprint = await createFingerprintAsync(root, { platforms: ['android'], silent: true });
  const ids = fingerprint.sources.map((s) => ('id' in s ? s.id : s.filePath));
  assert.ok(!ids.includes('packageJson:scripts'), `scripts are still hashed: ${ids.filter((i) => i.startsWith('packageJson')).join(', ')}`);
});

test('the fingerprint config keeps every default skip and adds only the scripts', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(join(root, 'fingerprint.config.js')) as { sourceSkips: string[] };
  const skips = config.sourceSkips.reduce((bits, key) => {
    const bit = SourceSkips[key as keyof typeof SourceSkips];
    assert.equal(typeof bit, 'number', `unknown source skip ${key}`);
    return bits | bit;
  }, SourceSkips.None);
  assert.equal(skips, DEFAULT_SOURCE_SKIPS | SourceSkips.PackageJsonScriptsAll);
});
