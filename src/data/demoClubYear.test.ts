import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_AGM_ONLY } from '../domain/clubYear';
import type { ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { withPatchInFee, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoData';
import { raiseFees, recordAgm } from './demoStage4';

const TODAY = '2026-10-15';
const base: ClubData = {
  ...DEMO_DATA,
  agms: [{ year: 2026, heldOn: '2026-08-20' }],
  feeRates: [{ chapterId: 'ch-west', fy: 2026, status: 'full', amountCents: 36000, dueOn: '2026-12-31' }],
  charges: [],
  payments: [],
};
const ctxFor = (meId: string, data: ClubData = base): DemoCtx => ({
  data, me: data.members.find((m) => m.id === meId) ?? null, today: TODAY, now: '2026-10-15T00:00:00.000Z',
});
const withMember = (id: string, patch: object, data = base): ClubData => ({
  ...data, members: data.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
});

test('raising fees charges a Full member patched this club year pro rata, everyone else the full year', () => {
  const data = withMember('m-spanner', { patchedOn: '2026-10-01' });
  const { data: after } = raiseFees(ctxFor('m-sparks', data), 'ch-west', 2026);
  const of = (id: string) => (after.charges ?? []).find((c) => c.memberId === id);
  assert.deepEqual([of('m-spanner')?.amountCents, of('m-spanner')?.description], [30000, 'Pro rata, 10 of 12 months']);
  assert.deepEqual([of('m-rusty')?.amountCents, of('m-rusty')?.description], [36000, null]);
  assert.equal(of('m-throttle'), undefined, 'no FNG rate, no FNG charge');
});

test('becoming Full adds the pro rata fee once', () => {
  const ctx = ctxFor('m-rusty');
  const patched = withMember('m-throttle', { status: 'full', patchedOn: TODAY });
  const once = withPatchInFee(ctx, 'm-throttle', patched);
  const fees = (d: ClubData) => (d.charges ?? []).filter((c) => c.memberId === 'm-throttle');
  assert.deepEqual(fees(once).map((c) => [c.fy, c.kind, c.amountCents, c.description]), [[2026, 'annual', 30000, 'Pro rata, 10 of 12 months']]);
  const again = withPatchInFee({ ...ctx, data: { ...once, members: base.members } }, 'm-throttle', once);
  assert.equal(fees(again).length, 1);
});

test('only the National Chairman or Secretary records the AGM, and recording again replaces it', () => {
  const after = recordAgm(ctxFor('m-rusty'), '2026-08-23');
  assert.deepEqual(after.agms, [{ year: 2026, heldOn: '2026-08-23' }]);
  assert.throws(() => recordAgm(ctxFor('m-sparks'), '2026-08-23'), (e) => e instanceof NotAllowedError && e.message === RECORD_AGM_ONLY);
});
