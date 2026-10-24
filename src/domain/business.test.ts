import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import { businessFor, melbourneHhmm, melbourneInstant, parseTime } from './business';

const d = DEMO_DATA;
const me = (id: string) => d.members.find((m) => m.id === id)!;
const NOW = '2026-10-24T02:00:00.000Z'; // Sat 24/10/2026, 1 pm in Melbourne

test('a member sees the votes they’re on, their own action items and the open meetings', () => {
  const b = businessFor(me('m-spanner'), d, NOW);
  assert.deepEqual(b.needsMe.map((v) => v.id), ['v-1'], 'Throttle’s patch vote waits on Spanner');
  assert.deepEqual(b.openVotes.map((v) => v.id), [], 'not the board’s gazebo vote');
  assert.deepEqual(b.closedVotes.map((v) => v.id), ['v-3']);
  assert.deepEqual(b.myActions.map((a) => a.id), ['ai-1']);
  assert.deepEqual(b.otherActions, [], 'nobody else’s items');
  assert.deepEqual(b.upcoming.map((m) => m.id), [], 'board and NEC meetings stay with the board');
  assert.deepEqual(b.past.map((p) => p.meeting.id), ['mt-2', 'mt-3'], 'newest first');
  assert.equal(b.runsAny, false);
  assert.equal(b.summary, '1 vote needs you · 1 action item');
});

test('a board member sees their scope’s business, with what needs them first', () => {
  const b = businessFor(me('m-torque'), d, NOW);
  assert.deepEqual(b.needsMe.map((v) => v.id), ['v-2'], 'the gazebo vote; Torque already voted on the patch');
  assert.deepEqual(b.openVotes.map((v) => v.id), ['v-1']);
  assert.deepEqual(b.myActions.map((a) => a.id), [], 'Torque’s own item is done');
  assert.deepEqual(b.otherActions.map((a) => a.id), ['ai-2', 'ai-1'], 'open West items, soonest due first');
  assert.deepEqual(b.upcoming.map((m) => m.id), ['mt-1']);
  assert.equal(b.past.find((p) => p.meeting.id === 'mt-2')!.state, 'overdue', 'ten days on, past the seven (10.8)');
  assert.equal(b.runsAny, true);
  assert.equal(b.summary, '1 vote needs you · Next meeting Wed 04/11 · Minutes due for 1 meeting');
});

test('the NEC sees every chapter, and the whole club’s meetings', () => {
  const b = businessFor(me('m-rusty'), d, NOW);
  assert.deepEqual(b.upcoming.map((m) => m.id), ['mt-1', 'mt-4']);
  assert.ok(b.otherActions.some((a) => a.id === 'ai-4'), 'North’s items too');
});

test('nothing for applicants or the signed out', () => {
  for (const who of [me('m-dylan'), null]) {
    const b = businessFor(who, d, NOW);
    assert.equal(b.needsMe.length + b.upcoming.length + b.past.length + b.myActions.length + b.closedVotes.length, 0);
    assert.equal(b.summary, null);
  }
});

test('a vote past its closing time no longer asks for a ballot', () => {
  const b = businessFor(me('m-spanner'), d, '2026-11-05T00:00:00.000Z');
  assert.deepEqual(b.needsMe, []);
  assert.deepEqual(b.openVotes.map((v) => v.id), ['v-1'], 'it waits for the board to close it');
});

test('typed times', () => {
  assert.equal(parseTime('19:30'), '19:30');
  assert.equal(parseTime('7:30 pm'), '19:30');
  assert.equal(parseTime('7.30PM'), '19:30');
  assert.equal(parseTime('7pm'), '19:00');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12:15 pm'), '12:15');
  assert.equal(parseTime('7'), null, 'morning or night?');
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime('13pm'), null);
  assert.equal(parseTime('7:60'), null);
  assert.equal(parseTime('soon'), null);
});

test('Melbourne wall-clock times become instants, either side of daylight saving', () => {
  assert.equal(melbourneInstant('2026-11-04', '19:30'), '2026-11-04T08:30:00.000Z', 'AEDT, UTC+11');
  assert.equal(melbourneInstant('2026-07-01', '19:30'), '2026-07-01T09:30:00.000Z', 'AEST, UTC+10');
  assert.equal(melbourneInstant('2026-10-04', '02:30'), null, 'the hour the clocks skip');
  assert.equal(melbourneHhmm('2026-11-04T08:30:00.000Z'), '19:30');
  assert.equal(melbourneHhmm('2026-11-04T13:05:00.000Z'), '00:05');
});
