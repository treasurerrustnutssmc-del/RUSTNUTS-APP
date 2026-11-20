import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error plain .mjs script run by the TestFlight workflow; tsx loads it here.
import * as tf from '../.github/scripts/testflight.mjs';

const workflow = readFileSync(join(__dirname, '../.github/workflows/testflight.yml'), 'utf8');
const smoke = readFileSync(join(__dirname, '../.github/workflows/ios-sim-smoke.yml'), 'utf8');
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
  const expired = [{ id: 'b2', attributes: { version: '2', processingState: 'VALID', expired: true } }];
  assert.throws(() => tf.pickBuild(expired, '2'), /expired/);
});

test('only an older build can be retired, never the newest working one', () => {
  const b = (id: string, version: string, expired = false) => ({ id, attributes: { version, processingState: 'VALID', expired } });
  const builds = [b('b4', '4'), b('b3', '3'), b('b2', '2', true)];
  assert.equal(tf.buildToRetire(builds, '3').id, 'b3');
  assert.throws(() => tf.buildToRetire(builds, '4'), /newest/);
  assert.throws(() => tf.buildToRetire(builds, '2'), /already/);
  assert.throws(() => tf.buildToRetire(builds, '9'), /no build 9/i);
});

test('"What to Test" fills an empty locale Apple already made instead of adding a second one', () => {
  const loc = (id: string, locale: string, whatsNew: string | null) => ({ id, attributes: { locale, whatsNew } });
  assert.deepEqual(tf.whatToTestStep([]), { method: 'POST' });
  assert.deepEqual(tf.whatToTestStep([loc('l1', 'en-AU', null)]), { method: 'PATCH', id: 'l1' });
  assert.deepEqual(tf.whatToTestStep([loc('l1', 'en-US', ''), loc('l2', 'en-AU', '')]), { method: 'PATCH', id: 'l2' });
  assert.equal(tf.whatToTestStep([loc('l1', 'en-AU', 'Try the rides')]), null);
});

const reply = (status: number, body: string) => async () => new Response(body, { status });

test("Apple's error details never reach the public log, only the status, code and title", async () => {
  const api = tf.client(
    'token',
    reply(409, JSON.stringify({ errors: [{ code: 'ENTITY_ERROR', title: 'Conflict', detail: 'kane@example.com is already a tester' }] })),
  );
  await assert.rejects(api.call('POST', '/v1/betaTesters', {}), (e: Error) => {
    assert.match(e.message, /409 ENTITY_ERROR: Conflict/);
    assert.doesNotMatch(e.message, /@|kane/);
    return true;
  });
  const html = tf.client('token', reply(502, '<html>bad gateway for kane@example.com</html>'));
  await assert.rejects(html.call('GET', '/v1/users?limit=200'), (e: Error) => {
    assert.match(e.message, /GET \/v1\/users → 502/);
    assert.doesNotMatch(e.message, /@|kane|limit/);
    return true;
  });
  const garbled = tf.client('token', reply(200, '{"data":[{"username":"kane@example.com"'));
  await assert.rejects(garbled.call('GET', '/v1/users'), (e: Error) => {
    assert.doesNotMatch(e.message, /@|kane/);
    return true;
  });
});

test("a member Apple won't take is a warning, not a red run, and nobody's details are printed", async () => {
  const printed: string[] = [];
  const log = (...a: unknown[]) => printed.push(a.join(' '));
  const api = {
    all: async (path: string) =>
      path.startsWith('/v1/users')
        ? [{ attributes: { username: 'kane@example.com', firstName: 'Kane', lastName: 'B' } }, { attributes: { username: 'bob@example.com' } }]
        : [],
    call: async (_m: string, _p: string, body: { data: { attributes: { email: string } } }) => {
      if (body.data.attributes.email.startsWith('kane')) throw Object.assign(new Error('POST /v1/betaTesters → 409 X: Y'), { status: 409 });
      return {};
    },
  };
  const before = process.exitCode;
  const result = await tf.addMembers(api, { log, warn: log });
  assert.deepEqual(result, { users: 2, testersBefore: 0, added: 1, skipped: 1 });
  assert.equal(process.exitCode, before);
  assert.doesNotMatch(printed.join('\n'), /@|kane|bob/i);
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
  assert.match(workflow, /options: \[add-members, status, send-build-for-review, retire-build\]/);
  assert.match(workflow, /group: testflight/, 'runs never overlap');
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /inputs\.action \|\| \(github\.event_name == 'schedule' && 'add-members' \|\| 'status'\)/);
});

test('the simulator smoke test runs by hand, one at a time anywhere, and goes red when the app closes', () => {
  assert.doesNotMatch(smoke, /^\s*push:/m, 'each run is an EAS iPhone build, so never on push');
  assert.match(smoke, /group: ios-sim-smoke\s*\n\s*cancel-in-progress: false/);
  assert.match(smoke, /exit 1/);
  assert.match(smoke, /path: \|\s*\n\s*shot\.png\s*\n\s*launch\.log\s*\n\s*reports\/\s*\n/);
  assert.doesNotMatch(smoke, /DiagnosticReports\/\s*$/m, 'only the app\'s own crash reports are uploaded');
});
