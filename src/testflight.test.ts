import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error plain .mjs script run by the TestFlight workflow; tsx loads it here.
import * as tf from '../.github/scripts/testflight.mjs';

const workflow = readFileSync(join(__dirname, '../.github/workflows/testflight.yml'), 'utf8');
const script = readFileSync(join(__dirname, '../.github/scripts/testflight.mjs'), 'utf8');

const b64url = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

test('the App Store Connect token is an ES256 JWT Apple accepts (kid, iss, aud, under 20 minutes)', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const token: string = tf.makeToken({ keyPem: pem, keyId: 'KEY123', issuerId: 'issuer-1', now: 1_000_000 });
  const [h, p, s] = token.split('.');
  assert.deepEqual(b64url(h), { alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
  const payload = b64url(p);
  assert.equal(payload.iss, 'issuer-1');
  assert.equal(payload.aud, 'appstoreconnect-v1');
  assert.equal(payload.iat, 1_000_000);
  assert.ok(payload.exp > payload.iat && payload.exp - payload.iat <= 20 * 60);
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64, 'raw r||s signature, not DER');
  assert.ok(
    verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, sig),
  );
});

test('members to add are the App Store Connect users not yet in the group, matched without case', () => {
  const users = [
    { attributes: { username: 'A@x.com', firstName: 'A', lastName: 'One' } },
    { attributes: { username: 'b@x.com', firstName: 'B', lastName: 'Two' } },
    { attributes: { username: '', firstName: 'Blank', lastName: '' } },
  ];
  const testers = [{ attributes: { email: 'a@X.com' } }];
  assert.deepEqual(tf.membersToAdd(users, testers), [{ email: 'b@x.com', firstName: 'B', lastName: 'Two' }]);
  assert.deepEqual(tf.membersToAdd([], testers), []);
});

test('the build to send is found by its build number and must have finished processing', () => {
  const builds = [
    { id: 'b4', attributes: { version: '4', processingState: 'PROCESSING', expired: false } },
    { id: 'b3', attributes: { version: '3', processingState: 'VALID', expired: false } },
  ];
  assert.equal(tf.pickBuild(builds, '3').id, 'b3');
  assert.throws(() => tf.pickBuild(builds, '4'), /still processing/);
  assert.throws(() => tf.pickBuild(builds, '9'), /no build 9/i);
});

test('the workflow keeps member names and emails out of the public log', () => {
  // The repository is public, so Actions logs are too: the script prints counts and build states only.
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*\b(email|username|firstName|lastName)\b/);
  assert.doesNotMatch(workflow, /set -x/);
});

test('the TestFlight workflow writes the key outside the checkout and adds members on a schedule', () => {
  assert.match(workflow, /write-asc-key\.py \.\.\/asc\/AuthKey\.p8/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /schedule:\s*\n\s*- cron:/);
  assert.match(workflow, /options: \[add-members, status, send-build-for-review\]/);
  assert.match(workflow, /group: testflight/, 'runs never overlap');
});
