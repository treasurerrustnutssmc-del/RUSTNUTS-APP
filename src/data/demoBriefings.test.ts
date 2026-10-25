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
  READ_OUTDATED,
  readState,
  RIDE_CANCELLED,
  SAVE_CONFLICT,
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
/** The version of r-1's briefing in the demo data. */
const R1_AT = '2026-10-23T09:15:00.000Z';
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
  }, null);
  assert.deepEqual(briefingOf('r-2', d), {
    rideId: 'r-2',
    hazards: ['Wet leaves on the Black Spur'],
    changes: 'Regroup at Pyalong.',
    notes: '',
    updatedAt: NOW,
    updatedBy: 'm-smokey',
  });
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-2', input(), null)), NOT_WRITER, 'West’s board can’t write a North ride’s');
  assert.equal((d.briefings ?? []).length, (DEMO_DATA.briefings ?? []).length + 1, 'one more briefing');
  assert.equal(DEMO_DATA.briefings?.some((b) => b.rideId === 'r-2'), false, 'the demo data is not changed in place');
});

test('saving again replaces the ride’s briefing, and older reads go stale', () => {
  const d = saveBriefing(ctxFor('m-torque', DEMO_DATA, LATER), 'r-1', input({ notes: 'Bring cash.' }), R1_AT);
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
  const d = saveBriefing(ctxFor('m-spanner', data), 'r-1', input(), R1_AT);
  assert.equal(briefingOf('r-1', d)?.updatedBy, 'm-spanner');
  // As Tail Gunner, he can't.
  assert.equal(refusal(() => saveBriefing(ctxFor('m-spanner'), 'r-1', input(), R1_AT)), NOT_WRITER);
});

test('saving: refusals in the rules’ words', () => {
  assert.equal(refusal(() => saveBriefing(ctxFor(null), 'r-1', input(), R1_AT)), 'Sign in first.');
  assert.equal(refusal(() => saveBriefing(ctxFor('m-dylan'), 'r-1', input(), R1_AT)), 'Only approved members can do that.');
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-nope', input(), null)), NO_RIDE);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-5', input(), null)), RIDE_CANCELLED);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque', DEMO_DATA, '2026-11-09T00:00:00.000Z'), 'r-1', input(), R1_AT)), BRIEFING_LOCKED);
  assert.equal(
    refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ hazards: Array.from({ length: 13 }, (_, i) => `Hazard ${i + 1}`) }), R1_AT)),
    TOO_MANY_HAZARDS,
  );
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', { hazards: [' ', ''], changes: '  ', notes: '' }, R1_AT)), BRIEFING_EMPTY);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ hazards: ['x'.repeat(121)] }), R1_AT)), HAZARD_TOO_LONG);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ changes: 'x'.repeat(2001) }), R1_AT)), TEXT_TOO_LONG);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input({ notes: 'x'.repeat(2001) }), R1_AT)), TEXT_TOO_LONG);
  // At the limits, and counted in code points, it saves.
  const full = saveBriefing(ctxFor('m-torque'), 'r-1', input({ hazards: ['🏍'.repeat(120)], changes: 'x'.repeat(2000), notes: '🏍'.repeat(2000) }), R1_AT);
  assert.equal(briefingOf('r-1', full)?.notes, '🏍'.repeat(2000));
});

test('reading: Got it records a read now, and reading again moves it', () => {
  const d = readBriefing(ctxFor('m-rusty'), 'r-1', R1_AT);
  assert.deepEqual(
    (d.briefingReads ?? []).filter((r) => r.memberId === 'm-rusty'),
    [{ rideId: 'r-1', memberId: 'm-rusty', readAt: NOW }],
  );
  assert.equal(readState(member('m-rusty'), 'r-1', d), 'current');
  const again = readBriefing(ctxFor('m-diesel', d, LATER), 'r-1', R1_AT);
  const diesel = (again.briefingReads ?? []).filter((r) => r.rideId === 'r-1' && r.memberId === 'm-diesel');
  assert.deepEqual(diesel, [{ rideId: 'r-1', memberId: 'm-diesel', readAt: LATER }], 'one read each, moved to now');
  assert.equal(readState(member('m-diesel'), 'r-1', again), 'current', 'no longer out of date');
});

test('reading: refused with no briefing, allowed on a cancelled ride that has one', () => {
  assert.equal(refusal(() => readBriefing(ctxFor(null), 'r-1', R1_AT)), 'Sign in first.');
  assert.equal(refusal(() => readBriefing(ctxFor('m-dylan'), 'r-1', R1_AT)), 'Only approved members can do that.');
  assert.equal(refusal(() => readBriefing(ctxFor('m-spanner'), 'r-nope', null)), NO_RIDE);
  assert.equal(refusal(() => readBriefing(ctxFor('m-spanner'), 'r-2', null)), NO_BRIEFING);
  const withBriefing: ClubData = {
    ...DEMO_DATA,
    briefings: [
      ...(DEMO_DATA.briefings ?? []),
      { rideId: 'r-5', hazards: ['Fog'], changes: '', notes: '', updatedAt: '2026-10-20T00:00:00.000Z', updatedBy: 'm-torque' },
    ],
  };
  const d = readBriefing(ctxFor('m-spanner', withBriefing), 'r-5', '2026-10-20T00:00:00.000Z');
  assert.equal(readState(member('m-spanner'), 'r-5', d), 'current');
});

test('the parity runner knows both actions, with the version seen', () => {
  const saved = runDemoAction(ctxFor('m-smokey'), {
    action: 'saveBriefing', ride: 'r-2', hazards: ['Fog'], changes: '', notes: '', seen: null,
  });
  assert.ok(briefingOf('r-2', saved));
  const read = runDemoAction(ctxFor('m-rusty'), { action: 'readBriefing', ride: 'r-1', seen: R1_AT });
  assert.equal(readState(member('m-rusty'), 'r-1', read), 'current');
  assert.throws(() => runDemoAction(ctxFor('m-rusty'), { action: 'readBriefing', ride: 'r-1', seen: null }), { message: READ_OUTDATED });
  assert.throws(
    () => runDemoAction(ctxFor('m-torque'), { action: 'saveBriefing', ride: 'r-1', hazards: ['Fog'], changes: '', notes: '', seen: null }),
    { message: SAVE_CONFLICT },
  );
});

test('saving also marks the writer’s own read, at the same time', () => {
  const d = saveBriefing(ctxFor('m-torque', DEMO_DATA, LATER), 'r-1', input({ notes: 'Bring cash.' }), R1_AT);
  const torque = (d.briefingReads ?? []).filter((r) => r.rideId === 'r-1' && r.memberId === 'm-torque');
  assert.deepEqual(torque, [{ rideId: 'r-1', memberId: 'm-torque', readAt: LATER }], 'one read, stamped with the save');
  assert.equal(briefingOf('r-1', d)?.updatedAt, LATER);
  assert.equal(readState(member('m-torque'), 'r-1', d), 'current', 'the writer isn’t asked to read their own update');
  // A writer who had read an older version gets theirs moved too, not a second one.
  // Diesel is r-1's Road Captain.
  const diesel = saveBriefing(ctxFor('m-diesel', DEMO_DATA, LATER), 'r-1', input(), R1_AT);
  const reads = (diesel.briefingReads ?? []).filter((r) => r.rideId === 'r-1' && r.memberId === 'm-diesel');
  assert.deepEqual(reads, [{ rideId: 'r-1', memberId: 'm-diesel', readAt: LATER }]);
  assert.equal(readState(member('m-spanner'), 'r-1', d), 'stale', 'everyone else’s read still goes stale');
});

test('saving over someone else’s newer save is refused, and changes nothing', () => {
  const older = '2026-10-22T00:00:00.000Z';
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input(), older)), SAVE_CONFLICT);
  assert.equal(refusal(() => saveBriefing(ctxFor('m-torque'), 'r-1', input(), null)), SAVE_CONFLICT, 'opened when there was none');
  // Who may write comes first.
  assert.equal(refusal(() => saveBriefing(ctxFor('m-spanner'), 'r-1', input(), older)), NOT_WRITER);
  // A new briefing with no version is fine.
  assert.ok(briefingOf('r-2', saveBriefing(ctxFor('m-smokey'), 'r-2', input(), null)));
});

test('Got it on an older version is refused, and the read stays as it was', () => {
  assert.equal(refusal(() => readBriefing(ctxFor('m-diesel'), 'r-1', '2026-10-22T10:00:00.000Z')), READ_OUTDATED);
  assert.equal(refusal(() => readBriefing(ctxFor('m-diesel'), 'r-1', null)), READ_OUTDATED, 'no version at all');
  assert.equal(refusal(() => readBriefing(ctxFor('m-spanner'), 'r-2', '2026-10-22T10:00:00.000Z')), NO_BRIEFING, 'no briefing comes first');
  assert.equal(readState(member('m-diesel'), 'r-1', DEMO_DATA), 'stale');
  // The version on screen, to the millisecond, is allowed.
  const d = readBriefing(ctxFor('m-diesel'), 'r-1', R1_AT);
  assert.equal(readState(member('m-diesel'), 'r-1', d), 'current');
});
