import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../domain/dates';
import { addMonths } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import {
  CHANGES_TOO_LONG,
  currentRoadRules,
  NO_RULES,
  NOT_PUBLISHER,
  PUBLISH_CONFLICT,
  roadRulesStatus,
  RULES_EMPTY,
  RULES_TOO_LONG,
  SIGN_OUTDATED,
  signoffBase,
  type RoadRulesInput,
} from '../domain/roadRules';
import type { ClubData } from '../domain/types';
import { publishRoadRules, runDemoAction, signRoadRules, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoData';

// The demo's Road Rules are dated from the real today, so its states hold whenever it's opened.
const TODAY = melbourneDate(new Date().toISOString());
const NOW = '2026-10-24T00:00:00.000Z';
const ctxFor = (meId: string | null, data: ClubData = DEMO_DATA, now = NOW): DemoCtx => ({
  data,
  me: data.members.find((m) => m.id === meId) ?? null,
  today: TODAY,
  now,
});
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('was allowed');
};
const member = (id: string) => DEMO_DATA.members.find((m) => m.id === id)!;
const input = (over: Partial<RoadRulesInput> = {}): RoadRulesInput => ({
  body: '# Road Rules\n\nRide safe.',
  changes: '',
  fresh: true,
  ...over,
});
const NO_VERSIONS: ClubData = { ...DEMO_DATA, roadRules: [], roadRulesSignoffs: [] };
const statusOf = (id: string, data: ClubData = DEMO_DATA) => roadRulesStatus(member(id), data, TODAY);

test('the demo: version 1 is a fresh, clearly labelled sample; version 2 is a small fix', () => {
  const versions = [...(DEMO_DATA.roadRules ?? [])].sort((a, b) => a.number - b.number);
  assert.deepEqual(versions.map((v) => v.number), [1, 2]);
  const [v1, v2] = versions;
  assert.ok(v1.body.startsWith('# Sample Road Rules (demo only)\n'), 'labelled as a sample on its first line');
  assert.ok(v1.body.length < 2000 && v2.body.length < 2000, 'short');
  for (const v of versions) assert.equal(v.body, v.body.trim(), 'stored trimmed, as a publish would');
  assert.equal(v1.fresh, true);
  assert.equal(v1.changes, '');
  assert.equal(v2.fresh, false, 'a small fix: sign-offs carry over');
  assert.ok(v2.changes.length > 0 && v2.changes.length <= 500, 'says what changed');
  assert.notEqual(v2.body, v1.body);
  assert.ok(Math.abs(v2.body.length - v1.body.length) < 40, 'one small wording fix');
  for (const v of versions) {
    assert.equal(v.publishedBy, 'm-rusty', 'published by the NEC Chair');
  }
  assert.equal(melbourneDate(v1.publishedAt), addMonths(TODAY, -16), 'version 1: 16 months ago');
  assert.equal(melbourneDate(v2.publishedAt), addDays(TODAY, -24), 'version 2: 24 days ago');
  assert.equal(currentRoadRules(DEMO_DATA)?.number, 2);
  assert.equal(signoffBase(DEMO_DATA)?.number, 1);
});

test('the demo: Torque is signed, Spanner is due soon, Rusty has run out, Diesel never signed', () => {
  assert.deepEqual(statusOf('m-torque'), {
    state: 'current', goodUntil: addMonths(addDays(TODAY, -5), 12), signedVersion: 2,
  });
  const spanner = statusOf('m-spanner');
  assert.equal(spanner.state, 'due_soon');
  assert.equal(spanner.signedVersion, 1);
  const spannerSigned = (DEMO_DATA.roadRulesSignoffs ?? []).find((s) => s.memberId === 'm-spanner')!;
  assert.equal(melbourneDate(spannerSigned.signedAt), addDays(addMonths(TODAY, -11), -20), '11 months and 20 days ago');
  const rusty = statusOf('m-rusty');
  assert.equal(rusty.state, 'expired');
  const rustySigned = (DEMO_DATA.roadRulesSignoffs ?? []).find((s) => s.memberId === 'm-rusty')!;
  assert.equal(melbourneDate(rustySigned.signedAt), addMonths(TODAY, -13), '13 months ago');
  assert.equal(statusOf('m-diesel').state, 'unsigned');
  assert.equal((DEMO_DATA.roadRulesSignoffs ?? []).some((s) => s.memberId === 'm-diesel'), false);
  // Every sign-off is after the version it signed was published, and on a real member.
  for (const s of DEMO_DATA.roadRulesSignoffs ?? []) {
    const v = (DEMO_DATA.roadRules ?? []).find((x) => x.number === s.version);
    assert.ok(v, `${s.memberId} signed a version that exists`);
    assert.ok(Date.parse(s.signedAt) > Date.parse(v.publishedAt), `${s.memberId} signed after it was published`);
    assert.ok(DEMO_DATA.members.some((m) => m.id === s.memberId));
  }
});

test('publishing: the NEC adds the next version, cleaned, stamped with who and when', () => {
  const d = publishRoadRules(ctxFor('m-rusty'), input({ body: '  # Road Rules v3\n\nRide safe.  ', changes: '  Tidied up. ', fresh: false }), 2);
  const v3 = currentRoadRules(d);
  assert.deepEqual(v3, {
    number: 3, body: '# Road Rules v3\n\nRide safe.', changes: 'Tidied up.', fresh: false, publishedAt: NOW, publishedBy: 'm-rusty',
  });
  assert.equal((d.roadRules ?? []).length, 3, 'the older versions stay');
  assert.equal((DEMO_DATA.roadRules ?? []).length, 2, 'the demo data is not changed in place');
  assert.equal(statusOf('m-torque', d).state, 'current', 'not fresh: sign-offs carry over');
  // A fresh version asks everyone again.
  const fresh = publishRoadRules(ctxFor('m-rusty'), input(), 2);
  assert.equal(currentRoadRules(fresh)?.fresh, true);
  assert.equal(statusOf('m-torque', fresh).state, 'unsigned');
  // A sitting chapter President is on the NEC too.
  assert.equal(currentRoadRules(publishRoadRules(ctxFor('m-smokey'), input(), 2))?.publishedBy, 'm-smokey');
});

test('publishing the first version: it always needs a fresh sign-off', () => {
  const d = publishRoadRules(ctxFor('m-rusty', NO_VERSIONS), input({ fresh: false }), 0);
  assert.equal(currentRoadRules(d)?.number, 1);
  assert.equal(currentRoadRules(d)?.fresh, true, 'whatever was asked');
  assert.equal(currentRoadRules(d)?.changes, '');
});

test('publishing: refusals in the rules’ words', () => {
  assert.equal(refusal(() => publishRoadRules(ctxFor(null), input(), 2)), 'Sign in first.');
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-dylan'), input(), 2)), 'Only approved members can do that.');
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-torque'), input(), 2)), NOT_PUBLISHER, 'a board seat is not the NEC');
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-rusty'), input(), 1)), PUBLISH_CONFLICT, 'opened on version 1');
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-rusty'), input(), 0)), PUBLISH_CONFLICT, 'opened when there were none');
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-rusty'), input({ body: ' \n ' }), 2)), RULES_EMPTY);
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-rusty'), input({ body: 'x'.repeat(20001) }), 2)), RULES_TOO_LONG);
  assert.equal(refusal(() => publishRoadRules(ctxFor('m-rusty'), input({ changes: 'x'.repeat(501) }), 2)), CHANGES_TOO_LONG);
  // At the limits, counted in code points, it publishes.
  const full = publishRoadRules(ctxFor('m-rusty'), input({ body: '🏍'.repeat(20000), changes: '🏍'.repeat(500) }), 2);
  assert.equal(currentRoadRules(full)?.body, '🏍'.repeat(20000));
});

test('signing: your one sign-off row moves to the current version, now', () => {
  const d = signRoadRules(ctxFor('m-spanner'), 2);
  const mine = (d.roadRulesSignoffs ?? []).filter((s) => s.memberId === 'm-spanner');
  assert.deepEqual(mine, [{ memberId: 'm-spanner', version: 2, signedAt: NOW }], 'one row, replaced');
  assert.equal((d.roadRulesSignoffs ?? []).length, (DEMO_DATA.roadRulesSignoffs ?? []).length);
  // Diesel's first sign-off adds a row.
  const diesel = signRoadRules(ctxFor('m-diesel'), 2);
  assert.equal((diesel.roadRulesSignoffs ?? []).length, (DEMO_DATA.roadRulesSignoffs ?? []).length + 1);
  assert.deepEqual(
    (diesel.roadRulesSignoffs ?? []).find((s) => s.memberId === 'm-diesel'),
    { memberId: 'm-diesel', version: 2, signedAt: NOW },
  );
  // Signing again while signed is fine: it moves the date on.
  const later = '2026-10-25T00:00:00.000Z';
  const again = signRoadRules(ctxFor('m-torque', DEMO_DATA, later), 2);
  assert.equal((again.roadRulesSignoffs ?? []).find((s) => s.memberId === 'm-torque')?.signedAt, later);
});

test('signing at the real today: Rusty’s run-out sign-off comes good again', () => {
  const now = new Date().toISOString();
  const d = signRoadRules(ctxFor('m-rusty', DEMO_DATA, now), 2);
  assert.equal(roadRulesStatus(member('m-rusty'), d, melbourneDate(now)).state, 'current');
});

test('signing: refusals in the rules’ words', () => {
  assert.equal(refusal(() => signRoadRules(ctxFor(null), 2)), 'Sign in first.');
  assert.equal(refusal(() => signRoadRules(ctxFor('m-dylan'), 2)), 'Only approved members can do that.');
  assert.equal(refusal(() => signRoadRules(ctxFor('m-spanner', NO_VERSIONS), 1)), NO_RULES);
  assert.equal(refusal(() => signRoadRules(ctxFor('m-spanner'), 1)), SIGN_OUTDATED, 'an older version on screen');
});

test('the parity runner knows both actions, with repeat for the length limits', () => {
  const published = runDemoAction(ctxFor('m-rusty'), {
    action: 'publishRoadRules', body: 'x', changes: '', fresh: true, seen: 2, repeat: 20000,
  });
  assert.equal(currentRoadRules(published)?.body.length, 20000);
  assert.throws(
    () => runDemoAction(ctxFor('m-rusty'), { action: 'publishRoadRules', body: 'x', changes: '', fresh: true, seen: 2, repeat: 20001 }),
    { message: RULES_TOO_LONG },
  );
  const signed = runDemoAction(ctxFor('m-diesel'), { action: 'signRoadRules', version: 2 });
  assert.equal((signed.roadRulesSignoffs ?? []).find((s) => s.memberId === 'm-diesel')?.version, 2);
  assert.throws(() => runDemoAction(ctxFor('m-diesel'), { action: 'signRoadRules', version: 1 }), { message: SIGN_OUTDATED });
});
