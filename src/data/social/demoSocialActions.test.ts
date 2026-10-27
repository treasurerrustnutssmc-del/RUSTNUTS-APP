import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA as demoData } from '../demoData';
import { setBirthday, type SocialCtx } from './demoSocialActions';
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
