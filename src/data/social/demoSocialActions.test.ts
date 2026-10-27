import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA as demoData } from '../demoData';
import { archiveMechanic, saveMechanic, setBirthday, setSkills, vouchMechanic, type SocialCtx } from './demoSocialActions';
import { demoSocialData } from './demoSocialData';

const ctxAs = (memberId: string): SocialCtx => ({
  social: demoSocialData('2026-10-27'),
  club: demoData,
  me: demoData.members.find((m) => m.id === memberId) ?? null,
  today: '2026-10-27',
});

test('the demo has a birthday today and one later this week', () => {
  const b = demoSocialData('2026-10-27').birthdays;
  assert.deepEqual(b.find((x) => x.memberId === 'm-torque'), { memberId: 'm-torque', month: 10, day: 27 });
  assert.deepEqual(b.find((x) => x.memberId === 'm-smokey'), { memberId: 'm-smokey', month: 10, day: 30 });
});

test('sharing, changing and taking off a birthday', () => {
  const ctx = ctxAs('m-rusty');
  const changed = setBirthday(ctx, 1, 2).birthdays.filter((b) => b.memberId === 'm-rusty');
  assert.deepEqual(changed, [{ memberId: 'm-rusty', month: 1, day: 2 }]);
  assert.equal(setBirthday(ctx, null, null).birthdays.some((b) => b.memberId === 'm-rusty'), false);
});

test('refusals come from the shared rules', () => {
  assert.throws(() => setBirthday(ctxAs('m-rusty'), 4, 31), /That day isn’t in that month\./);
  assert.throws(() => setBirthday({ ...ctxAs('m-rusty'), me: null }, 1, 1), /Sign in first\./);
});

test('the demo always has On this day photos: a year ago and three years ago', async () => {
  const { onThisDay } = await import('../../domain/social/onThisDay');
  for (const today of ['2026-10-28', '2027-02-28', '2027-01-01', '2026-12-31']) {
    const groups = onThisDay(demoSocialData(today).pastPhotos, today);
    assert.deepEqual(groups.map((g) => [g.yearsAgo, g.items.length]), [[1, 2], [3, 1]], today);
  }
  // A leap day has no date a year back: the demo stays valid, with nothing to show.
  assert.deepEqual(onThisDay(demoSocialData('2028-02-29').pastPhotos, '2028-02-29'), []);
});

test('setting skills keeps each one once, and replaces what was there', () => {
  const ctx = ctxAs('m-rusty');
  const mine = setSkills(ctx, ['tyres', 'welding', 'tyres']).skills.filter((s) => s.memberId === 'm-rusty');
  assert.deepEqual(mine, [{ memberId: 'm-rusty', skills: ['tyres', 'welding'] }]);
  assert.throws(() => setSkills(ctx, ['juggling']), /That isn’t one of the skills\./);
});

const blank = { id: null, name: 'Shed Sixteen', suburb: ' Footscray ', phone: '', website: '', speciality: '', notes: '' };

test('adding a workshop, then the one who added it changes it', () => {
  const ctx = { ...ctxAs('m-rusty'), now: '2026-10-27T01:00:00Z' };
  const { social, id } = saveMechanic(ctx, blank);
  const added = social.mechanics.find((m) => m.id === id);
  assert.equal(added?.name, 'Shed Sixteen');
  assert.equal(added?.suburb, 'Footscray');
  assert.equal(added?.addedBy, 'm-rusty');
  const changed = saveMechanic({ ...ctx, social }, { ...blank, id, name: 'Shed 16' });
  assert.equal(changed.id, id);
  assert.equal(changed.social.mechanics.find((m) => m.id === id)?.name, 'Shed 16');
  assert.equal(changed.social.mechanics.length, social.mechanics.length);
});

test('only whoever added a workshop or the board can change it or take it off', () => {
  // mech-1 was added by m-spanner.
  assert.throws(() => saveMechanic(ctxAs('m-chook'), { ...blank, id: 'mech-1' }), /Only whoever added it or the board can change it\./);
  assert.throws(() => archiveMechanic(ctxAs('m-chook'), 'mech-1'), /Only whoever added it or the board can change it\./);
  const off = archiveMechanic(ctxAs('m-spanner'), 'mech-1');
  assert.ok(off.mechanics.find((m) => m.id === 'mech-1')?.archivedAt);
  assert.throws(() => archiveMechanic({ ...ctxAs('m-spanner'), social: off }, 'mech-1'), /That workshop is already off the list\./);
  assert.throws(() => vouchMechanic({ ...ctxAs('m-chook'), social: off }, 'mech-1', true), /That workshop is off the list\./);
});

test('vouching for a workshop and taking it back', () => {
  const ctx = ctxAs('m-spanner');
  const on = vouchMechanic(ctx, 'mech-4', true).vouches.filter((v) => v.mechanicId === 'mech-4' && v.memberId === 'm-spanner');
  assert.deepEqual(on, [{ mechanicId: 'mech-4', memberId: 'm-spanner', vouched: true }]);
  const off = vouchMechanic(ctx, 'mech-4', false).vouches.filter((v) => v.mechanicId === 'mech-4' && v.memberId === 'm-spanner');
  assert.deepEqual(off, [{ mechanicId: 'mech-4', memberId: 'm-spanner', vouched: false }]);
  assert.throws(() => vouchMechanic(ctx, 'nope', true), /No such workshop\./);
});
