import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEFING_EMPTY,
  BRIEFING_LOCKED,
  briefingOf,
  HAZARD_TOO_LONG,
  NO_BRIEFING,
  NO_RIDE,
  NOT_WRITER,
  readState,
  RIDE_CANCELLED,
  TEXT_TOO_LONG,
  TOO_MANY_HAZARDS,
  type BriefingInput,
} from '../domain/briefings';
import type { ClubData } from '../domain/types';
import { readBriefing, runDemoAction, saveBriefing, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoData';

const NOW = '2026-10-24T00:00:00.000Z';
const LATER = '2026-10-25T00:00:00.000Z';
const ctxFor = (meId: string | null, data: ClubData = DEMO_DATA, now = NOW): DemoCtx => ({
  data,
  me: data.members.find((m) => m.id === meId) ?? null,
  today: now.slice(0, 10),
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
const input = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  hazards: ['Wet leaves on the Black Spur'],
  changes: '',
  notes: '',
  ...over,
});

test('the demo: the West breakfast run has a briefing, North coffee and curves has none', () => {
  const b = briefingOf('r-1', DEMO_DATA);
  assert.ok(b, 'r-1 has a briefing');
  assert.deepEqual(b.hazards, [
    'Fresh gravel on the Ballan–Daylesford Rd after Korweinguboora',
    'Kangaroos at dusk on the way home',
    'Roadworks at Bacchus Marsh: 40 km/h',
  ]);
  assert.equal(b.changes, 'Single file through Myrniong, no staggered formation');
  assert.equal(b.notes, 'Breakfast at the Daylesford bakery, cash only.');
  assert.ok(b.updatedBy && DEMO_DATA.members.some((m) => m.id === b.updatedBy), 'written by a demo member');
  const ride = DEMO_DATA.rides.find((r) => r.id === 'r-1')!;
  assert.ok(Date.parse(b.updatedAt) < Date.parse(ride.startsAt), 'written before the ride');
  assert.equal(briefingOf('r-2', DEMO_DATA), undefined);
});

test('the demo: Spanner has read it, Diesel read an older version', () => {
  assert.equal(readState(member('m-spanner'), 'r-1', DEMO_DATA), 'current');
  assert.equal(readState(member('m-diesel'), 'r-1', DEMO_DATA), 'stale');
  assert.equal(readState(member('m-rusty'), 'r-1', DEMO_DATA), 'none');
  const ride = DEMO_DATA.rides.find((r) => r.id === 'r-1')!;
  for (const r of DEMO_DATA.briefingReads ?? []) {
    assert.ok(Date.parse(r.readAt) < Date.parse(ride.startsAt), 'every read is before the ride');
  }
});

test('saving: a board member writes a new briefing, cleaned, stamped with who and when', () => {
  // Smokey is North's President, and r-2 is a North ride.
  const d = saveBriefing(ctxFor('m-smokey'), 'r-2', {
    hazards: ['  Wet leaves on the Black Spur ', '', '   '],
    changes: '  Regroup at Pyalong. ',
    notes: '',
  });
  assert.deepEqual(briefingOf('r-2', d), {
    rideId: 'r-2',
    hazards: ['Wet leaves on the Black Spur'],
    changes: 'Regroup at Pyalong.',
    notes: '',
    updatedAt: NOW,
    updatedBy: 'm-smokey',
  });
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-2', input())), NOT_WRITER, 'West’s board can’t write a North ride’s');
  assert.equal((d.briefings ?? []).length, (DEMO_DATA.briefings ?? []).length + 1, 'one more briefing');
  assert.equal(DEMO_DATA.briefings?.some((b) => b.rideId === 'r-2'), false, 'the demo data is not changed in place');
});

test('saving again replaces the ride’s briefing, and older reads go stale', () => {
  const d = saveBriefing(ctxFor('m-torque', DEMO_DATA, LATER), 'r-1', input({ notes: 'Bring cash.' }));
  const mine = (d.briefings ?? []).filter((b) => b.rideId === 'r-1');
  assert.equal(mine.length, 1, 'one briefing per ride');
  assert.deepEqual(mine[0].hazards, ['Wet leaves on the Black Spur']);
  assert.equal(mine[0].notes, 'Bring cash.');
  assert.equal(mine[0].updatedAt, LATER);
  assert.equal(readState(member('m-spanner'), 'r-1', d), 'stale', 'Spanner read the old one');
});

test('saving: the ride’s Road Captain writes it without a board seat', () => {
  // Spanner holds no board or ride committee seat. Make him this ride's Road Captain.
  const data: ClubData = {
    ...DEMO_DATA,
    crew: (DEMO_DATA.crew ?? [])
      .filter((k) => !(k.rideId === 'r-1' && k.memberId === 'm-spanner'))
      .map((k) => (k.rideId === 'r-1' && k.role === 'road_captain' ? { ...k, memberId: 'm-spanner' } : k)),
  };
  const d = saveBriefing(ctxFor('m-spanner', data), 'r-1', input());
  assert.equal(briefingOf('r-1', d)?.updatedBy, 'm-spanner');
  // As Tail Gunner, he can't.
  assert.equal(refusal(() => saveBriefing(ctxFor('m-spanner'), 'r-1', input())), NOT_WRITER);
});

test('saving: refusals in the rules’ words', () => {
  assert.equal(refusal(() => saveBriefing(ctxFor(null), 'r-1', input())), 'Sign in first.');
  assert.equal(refusal(() => saveBriefing(ctxFor('m-dylan'), 'r-1', input())), 'Only approved members can do that.');
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-nope', input())), NO_RIDE);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-5', input())), RIDE_CANCELLED);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque', DEMO_DATA, '2026-11-09T00:00:00.000Z'), 'r-1', input())), BRIEFING_LOCKED);
  assert.equal(
    refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ hazards: Array.from({ length: 13 }, (_, i) => `Hazard ${i + 1}`) }))),
    TOO_MANY_HAZARDS,
  );
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', { hazards: [' ', ''], changes: '  ', notes: '' })), BRIEFING_EMPTY);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ hazards: ['x'.repeat(121)] }))), HAZARD_TOO_LONG);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ changes: 'x'.repeat(2001) }))), TEXT_TOO_LONG);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ notes: 'x'.repeat(2001) }))), TEXT_TOO_LONG);
  // At the limits, and counted in code points, it saves.
  const full = saveBriefing(ctxFor('m-torque'), 'r-1', input({ hazards: ['🏍'.repeat(120)], changes: 'x'.repeat(2000), notes: '🏍'.repeat(2000) }));
  assert.equal(briefingOf('r-1', full)?.notes, '🏍'.repeat(2000));
});

test('reading: Got it records a read now, and reading again moves it', () => {
  const d = readBriefing(ctxFor('m-rusty'), 'r-1');
  assert.deepEqual(
    (d.briefingReads ?? []).filter((r) => r.memberId === 'm-rusty'),
    [{ rideId: 'r-1', memberId: 'm-rusty', readAt: NOW }],
  );
  assert.equal(readState(member('m-rusty'), 'r-1', d), 'current');
  const again = readBriefing(ctxFor('m-diesel', d, LATER), 'r-1');
  const diesel = (again.briefingReads ?? []).filter((r) => r.rideId === 'r-1' && r.memberId === 'm-diesel');
  assert.deepEqual(diesel, [{ rideId: 'r-1', memberId: 'm-diesel', readAt: LATER }], 'one read each, moved to now');
  assert.equal(readState(member('m-diesel'), 'r-1', again), 'current', 'no longer out of date');
});

test('reading: refused with no briefing, allowed on a cancelled ride that has one', () => {
  assert.equal(refusal(() => readBriefing(ctxFor(null), 'r-1')), 'Sign in first.');
  assert.equal(refusal(() => readBriefing(ctxFor('m-dylan'), 'r-1')), 'Only approved members can do that.');
  assert.equal(refusal(() => readBriefing(ctxFor('m-spanner'), 'r-nope')), NO_RIDE);
  assert.equal(refusal(() => readBriefing(ctxFor('m-spanner'), 'r-2')), NO_BRIEFING);
  const withBriefing: ClubData = {
    ...DEMO_DATA,
    briefings: [
      ...(DEMO_DATA.briefings ?? []),
      { rideId: 'r-5', hazards: ['Fog'], changes: '', notes: '', updatedAt: '2026-10-20T00:00:00.000Z', updatedBy: 'm-torque' },
    ],
  };
  const d = readBriefing(ctxFor('m-spanner', withBriefing), 'r-5');
  assert.equal(readState(member('m-spanner'), 'r-5', d), 'current');
});

test('the parity runner knows both actions', () => {
  const saved = runDemoAction(ctxFor('m-smokey'), {
    action: 'saveBriefing', ride: 'r-2', hazards: ['Fog'], changes: '', notes: '',
  });
  assert.ok(briefingOf('r-2', saved));
  const read = runDemoAction(ctxFor('m-rusty'), { action: 'readBriefing', ride: 'r-1' });
  assert.equal(readState(member('m-rusty'), 'r-1', read), 'current');
});
