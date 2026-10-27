import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIRTHDAY_BAD_DAY,
  BIRTHDAY_MISSING,
  birthdayLabel,
  birthdayProblem,
  shoutoutDayLabel,
  shoutoutLine,
  shoutoutsFor,
  type Birthday,
} from './shoutouts';
import type { Member } from '../types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west',
  fullName: m.id,
  roadName: null,
  status: 'full',
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  bio: null,
  sharePhone: false,
  appliedOn: null,
  onHiatus: false,
  ...m,
});

const me = member({ id: 'me', fullName: 'Me Myself' });
const bday = (memberId: string, month: number, day: number): Birthday => ({ memberId, month, day });

test('birthdays and patch anniversaries in the next 7 days, in order', () => {
  const members = [
    me,
    member({ id: 'a', fullName: 'Alf', patchedOn: '2023-10-30' }),
    member({ id: 'b', fullName: 'Bea' }),
    member({ id: 'c', fullName: 'Cat', patchedOn: '2020-10-27' }),
    member({ id: 'd', fullName: 'Dan' }),
    member({ id: 'e', fullName: 'Eve', patchedOn: '2021-11-03' }), // 7 days away: outside
  ];
  const list = shoutoutsFor(me, members, [bday('b', 10, 27), bday('d', 11, 2), bday('a', 10, 27)], '2026-10-27');
  assert.deepEqual(
    list.map((s) => [s.member.id, s.kind, s.date, s.daysAway, s.years]),
    [
      ['a', 'birthday', '2026-10-27', 0, null],
      ['b', 'birthday', '2026-10-27', 0, null],
      ['c', 'patch', '2026-10-27', 0, 6],
      ['a', 'patch', '2026-10-30', 3, 3],
      ['d', 'birthday', '2026-11-02', 6, null],
    ],
  );
});

test('the window crosses the new year', () => {
  const members = [me, member({ id: 'a', patchedOn: '2024-01-02' })];
  const list = shoutoutsFor(me, members, [bday('me', 1, 1)], '2026-12-29');
  assert.deepEqual(
    list.map((s) => [s.member.id, s.kind, s.date, s.years]),
    [
      ['me', 'birthday', '2027-01-01', null],
      ['a', 'patch', '2027-01-02', 3],
    ],
  );
});

test('29 February shows on 28 February in other years, and on the day in leap years', () => {
  const members = [me, member({ id: 'a' }), member({ id: 'b', patchedOn: '2024-02-29' })];
  const birthdays = [bday('a', 2, 29)];
  const plain = shoutoutsFor(me, members, birthdays, '2027-02-28', 1);
  assert.deepEqual(plain.map((s) => [s.member.id, s.kind, s.date]), [['a', 'birthday', '2027-02-28'], ['b', 'patch', '2027-02-28']]);
  const leap = shoutoutsFor(me, members, birthdays, '2028-02-28', 2);
  assert.deepEqual(leap.map((s) => [s.member.id, s.date]), [['a', '2028-02-29'], ['b', '2028-02-29']]);
});

test('patch anniversaries: Full and Nomad only, from one year on', () => {
  const members = [
    me,
    member({ id: 'full', patchedOn: '2025-10-27' }),
    member({ id: 'nomad', status: 'nomad', patchedOn: '2022-10-27' }),
    member({ id: 'legacy', status: 'legacy', patchedOn: '2020-10-27' }),
    member({ id: 'fng', status: 'fng', patchedOn: '2024-10-27' }),
    member({ id: 'fresh', patchedOn: '2026-10-27' }), // patched today: not an anniversary
    member({ id: 'future', patchedOn: '2027-10-27' }),
  ];
  const list = shoutoutsFor(me, members, [], '2026-10-27', 1);
  assert.deepEqual(list.map((s) => [s.member.id, s.years]), [['full', 1], ['nomad', 4]]);
});

test('only approved members, and nobody for a viewer who is not approved', () => {
  const members = [
    me,
    member({ id: 'pending', approval: 'pending' }),
    member({ id: 'suspended', approval: 'suspended', patchedOn: '2020-10-27' }),
  ];
  const birthdays = [bday('pending', 10, 27), bday('suspended', 10, 27), bday('me', 10, 27)];
  assert.deepEqual(shoutoutsFor(me, members, birthdays, '2026-10-27').map((s) => s.member.id), ['me']);
  const waiting = member({ id: 'w', approval: 'pending' });
  assert.deepEqual(shoutoutsFor(waiting, [...members, waiting], birthdays, '2026-10-27'), []);
  assert.deepEqual(shoutoutsFor(null, members, birthdays, '2026-10-27'), []);
});

test('the viewer comes first among the same day and kind', () => {
  const aaron = member({ id: 'aaron', fullName: 'Aaron' });
  const zed = { ...me, fullName: 'Zed' };
  const list = shoutoutsFor(zed, [zed, aaron], [bday('aaron', 10, 27), bday('me', 10, 27)], '2026-10-27');
  assert.deepEqual(list.map((s) => s.member.id), ['me', 'aaron']);
});

test('the viewer is marked, and a birthday for someone not in the list is skipped', () => {
  const list = shoutoutsFor(me, [me], [bday('me', 10, 28), bday('gone', 10, 28)], '2026-10-27');
  assert.equal(list.length, 1);
  assert.equal(list[0].isMe, true);
});

test('lines and day labels', () => {
  const [mine, theirs, patch1, patch5] = [
    { kind: 'birthday', isMe: true, years: null },
    { kind: 'birthday', isMe: false, years: null },
    { kind: 'patch', isMe: false, years: 1 },
    { kind: 'patch', isMe: true, years: 5 },
  ] as const;
  assert.equal(shoutoutLine(mine), 'Your birthday');
  assert.equal(shoutoutLine(theirs), 'Birthday');
  assert.equal(shoutoutLine(patch1), '1 year patched');
  assert.equal(shoutoutLine(patch5), '5 years patched');
  assert.equal(shoutoutDayLabel('2026-10-27', 0), 'Today');
  assert.equal(shoutoutDayLabel('2026-10-28', 1), 'Tomorrow');
  assert.equal(shoutoutDayLabel('2026-10-30', 3), 'Fri 30/10');
});

test('birthday problems, in the database order', () => {
  assert.equal(birthdayProblem(null, null), null); // taking it off
  assert.equal(birthdayProblem(10, null), BIRTHDAY_MISSING);
  assert.equal(birthdayProblem(null, 3), BIRTHDAY_MISSING);
  assert.equal(birthdayProblem(13, 1), BIRTHDAY_BAD_DAY);
  assert.equal(birthdayProblem(0, 1), BIRTHDAY_BAD_DAY);
  assert.equal(birthdayProblem(4, 31), BIRTHDAY_BAD_DAY);
  assert.equal(birthdayProblem(2, 30), BIRTHDAY_BAD_DAY);
  assert.equal(birthdayProblem(2, 0), BIRTHDAY_BAD_DAY);
  assert.equal(birthdayProblem(2, 29), null);
  assert.equal(birthdayProblem(12, 31), null);
  assert.equal(birthdayProblem(1.5, 2), BIRTHDAY_BAD_DAY);
});

test('a birthday reads as day and month', () => {
  assert.equal(birthdayLabel({ memberId: 'x', month: 3, day: 7 }), '7 March');
  assert.equal(birthdayLabel(null), 'Not shared');
});
