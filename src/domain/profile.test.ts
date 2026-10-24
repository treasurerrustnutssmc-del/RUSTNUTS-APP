import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import {
  boardWatchList, displayName, expiryAlerts, FORMER_MEMBER, hasEarnedDisc, initials, memberName, phoneNote, profileChecklist,
} from './profile';

const d = DEMO_DATA;
const m = (id: string) => d.members.find((x) => x.id === id)!;

test('checklist spots what is missing', () => {
  const spanner = profileChecklist(m('m-spanner'), d);
  assert.ok(spanner.every((i) => i.done), 'Spanner is complete (project bike needs no rego)');

  const chook = profileChecklist(m('m-chook'), d);
  const missing = chook.filter((i) => !i.done).map((i) => i.key);
  assert.deepEqual(missing.sort(), ['emergency', 'licence']);
});

test('the board watch list leaves out Legacy members and applicants', () => {
  const west = boardWatchList(d.members, 'ch-west').map((m) => m.id);
  assert.ok(!west.includes('m-rooster'), 'Legacy member left out');
  assert.ok(!west.includes('m-dylan'), 'applicant left out');
  assert.ok(west.includes('m-gravel'));
  assert.ok(boardWatchList(d.members, null).some((m) => m.chapterId === 'ch-north'), 'national sees every chapter');
});

test('expiry alerts for the West chapter', () => {
  const west = boardWatchList(d.members, 'ch-west');
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

test('the phone line says what is actually going on', () => {
  assert.equal(phoneNote({ isSelf: true, canSee: true, hasPhone: false, name: 'Spanner' }), 'You haven’t added a mobile yet. Add it in Edit profile.');
  assert.equal(phoneNote({ isSelf: false, canSee: true, hasPhone: false, name: 'Gravel' }), 'No mobile on record for Gravel.');
  assert.equal(phoneNote({ isSelf: false, canSee: false, hasPhone: false, name: 'Gravel' }), 'Gravel hasn’t shared their number with members.');
  assert.equal(phoneNote({ isSelf: false, canSee: true, hasPhone: true, name: 'Rusty' }), null);
});

test('the member disc is earned at full membership, never given', () => {
  const approved = { approval: 'approved' as const };
  assert.equal(hasEarnedDisc({ ...approved, status: 'full' }), true);
  assert.equal(hasEarnedDisc({ ...approved, status: 'nomad' }), true, 'a nomad is a full member living away');
  for (const status of ['introduced', 'fng', 'supporter', 'family', 'legacy'] as const) {
    assert.equal(hasEarnedDisc({ ...approved, status }), false, status);
  }
  assert.equal(hasEarnedDisc({ approval: 'suspended', status: 'full' }), false, 'not while suspended');
  assert.equal(hasEarnedDisc({ approval: 'pending', status: 'full' }), false);
});

test('a member by id: their display name, or the same words everywhere once they have left', () => {
  const members = [{ ...DEMO_DATA.members[0], id: 'here', roadName: 'Torque' }];
  assert.equal(memberName('here', members), 'Torque');
  assert.equal(memberName('gone', members), 'A former member');
  assert.equal(FORMER_MEMBER, 'A former member');
});
