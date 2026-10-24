import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import { displayName, expiryAlerts, hasEarnedDisc, initials, profileChecklist } from './profile';

const d = DEMO_DATA;
const m = (id: string) => d.members.find((x) => x.id === id)!;

test('checklist spots what is missing', () => {
  const spanner = profileChecklist(m('m-spanner'), d);
  assert.ok(spanner.every((i) => i.done), 'Spanner is complete (project bike needs no rego)');

  const chook = profileChecklist(m('m-chook'), d);
  const missing = chook.filter((i) => !i.done).map((i) => i.key);
  assert.deepEqual(missing.sort(), ['emergency', 'licence']);
});

test('expiry alerts for the West chapter', () => {
  const west = d.members.filter((x) => x.chapterId === 'ch-west' && x.approval === 'approved');
  const alerts = expiryAlerts(west, d, '2026-10-24');
  assert.deepEqual(
    alerts.map((a) => [a.memberId, a.kind, a.state]),
    [
      ['m-gravel', 'rego', 'expired'],
      ['m-spanner', 'rego', 'soon'],
      ['m-gravel', 'licence', 'soon'],
      ['m-diesel', 'rego', 'soon'],
    ],
  );
  assert.equal(alerts[0].label, 'Rego · Tank (6BH 1FT)');
});

test('names and initials', () => {
  assert.equal(displayName(m('m-spanner')), 'Spanner');
  assert.equal(displayName(m('m-kerry')), 'Kerry');
  assert.equal(initials(m('m-kerry')), 'KM');
  assert.equal(initials(m('m-spanner')), 'SP');
});

test('FNG review schedule', async () => {
  const { nextFngReview } = await import('./profile');
  assert.deepEqual(nextFngReview('2026-03-21', '2026-10-24'), { atMonths: 9, date: '2026-12-21', overdue12: false });
  assert.deepEqual(nextFngReview('2026-07-25', '2026-10-24'), { atMonths: 6, date: '2027-01-25', overdue12: false });
  assert.deepEqual(nextFngReview('2025-08-31', '2026-10-24'), { atMonths: 15, date: '2026-11-30', overdue12: true });
});

test('the member disc is earned at full membership, never given', () => {
  const approved = { approval: 'approved' as const };
  assert.equal(hasEarnedDisc({ ...approved, status: 'full' }), true);
  assert.equal(hasEarnedDisc({ ...approved, status: 'nomad' }), true, 'a nomad is a full member living away');
  for (const status of ['introduced', 'fng', 'supporter', 'family'] as const) {
    assert.equal(hasEarnedDisc({ ...approved, status }), false, status);
  }
  assert.equal(hasEarnedDisc({ approval: 'suspended', status: 'full' }), false, 'not while suspended');
  assert.equal(hasEarnedDisc({ approval: 'pending', status: 'full' }), false);
});
