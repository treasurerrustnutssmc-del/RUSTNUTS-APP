import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  type RoadRulesInput,
} from '../domain/roadRules';
import type { ClubData } from '../domain/types';
import { publishRoadRules, runDemoAction, signRoadRules, type DemoCtx } from './demoActions';
import { DEMO_DATA, STORY_NOW, STORY_TODAY } from './demoStory.testkit';

// The demo's Road Rules are dated from its today, so its states hold whenever it's opened. Here the
// demo is the one built for the story instant.
const TODAY = STORY_TODAY;
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

// The demo's own versions and sign-off states, checked on every instant in the testkit's list, are in demoFresh.test.ts.

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

test('signing on the demo’s today: Rusty’s run-out sign-off comes good again', () => {
  const now = STORY_NOW.toISOString();
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
