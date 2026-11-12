import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canQuickAnswer, quickAnswerReason } from './quickAnswer';
import { club, member, ride } from './stage4.testkit';

const today = '2026-11-12';
const now = '2026-11-12T00:00:00.000Z';

const data = (r = ride('r1')) => club({ members: [member('rider')], rides: [r] });
const me = (d: ReturnType<typeof data>) => d.members[0];

test('a coming ride that takes answers can be answered in one tap from Home', () => {
  const d = data(ride('r1', { startsAt: '2026-11-20T00:00:00.000Z' }));
  assert.equal(canQuickAnswer(me(d), d.rides[0], d, today, now), true);
});

test('a cancelled ride cannot', () => {
  const d = data(ride('r1', { startsAt: '2026-11-20T00:00:00.000Z', cancelledAt: '2026-11-10T00:00:00.000Z' }));
  assert.equal(canQuickAnswer(me(d), d.rides[0], d, today, now), false);
});

test('a ride that has already started cannot', () => {
  const d = data(ride('r1', { startsAt: '2026-11-11T00:00:00.000Z' }));
  assert.equal(canQuickAnswer(me(d), d.rides[0], d, today, now), false);
});

// The point of the gate: the one-tap Going must stop wherever the ride screen would.
const roadRules = [{ number: 1, body: '# Road Rules v1', changes: '', fresh: true, publishedAt: '2025-07-01T00:00:00.000Z', publishedBy: 'nec' }];
const coming = ride('r1', { startsAt: '2026-11-20T00:00:00.000Z' });

test('Going is not offered in one tap while the Road Rules are published and unsigned', () => {
  const d = club({ members: [member('rider')], rides: [coming], roadRules });
  assert.equal(canQuickAnswer(d.members[0], coming, d, today, now), false);
});

test('it is offered again once the Road Rules are signed', () => {
  const d = club({ members: [member('rider')], rides: [coming], roadRules, roadRulesSignoffs: [{ memberId: 'rider', version: 1, signedAt: '2026-10-01T00:00:00.000Z' }] });
  assert.equal(canQuickAnswer(d.members[0], coming, d, today, now), true);
});


test('when one tap is not offered, the card says why in the rules’ own words', () => {
  const started = club({ members: [member('rider')], rides: [ride('r1', { startsAt: '2026-11-11T00:00:00.000Z' })] });
  assert.match(quickAnswerReason(started.members[0], started.rides[0], started, today, now) ?? '', /already started/);
  const unsigned = club({ members: [member('rider')], rides: [coming], roadRules });
  assert.match(quickAnswerReason(unsigned.members[0], coming, unsigned, today, now) ?? '', /Road Rules/);
});

test('there is no reason when one tap is offered', () => {
  const d = club({ members: [member('rider')], rides: [coming] });
  assert.equal(quickAnswerReason(d.members[0], coming, d, today, now), null);
});
