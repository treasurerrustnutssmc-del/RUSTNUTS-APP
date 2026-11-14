// The demo clock: story dates move a whole week at a time, keeping weekday and Melbourne clock time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { melbourneInstant, melbourneHhmm } from '../domain/business';
import { addDays } from '../domain/dates';
import { melbourneDate } from '../domain/rides';
import { dayMonth, dayOrdinal, demoClock, fixed, monthName, storyDates, storyShiftDays, weekdayName } from './demoStory';

test('the shift is whole weeks and steps on Sunday, Melbourne time', () => {
  assert.equal(storyShiftDays('2026-10-25'), 0);
  assert.equal(storyShiftDays('2026-10-31'), 0);
  assert.equal(storyShiftDays('2026-11-01'), 7);
  assert.equal(storyShiftDays('2026-11-14'), 14);
  assert.equal(storyShiftDays('2026-10-24'), -7);
  assert.equal(storyShiftDays('2026-10-18'), -7);
  assert.equal(storyShiftDays('2026-10-17'), -14);
  // 13:05 UTC on Saturday is 00:05 Sunday in Melbourne: the new week has started.
  assert.equal(demoClock(new Date('2026-10-31T13:05:00.000Z')).shiftDays, 7);
  assert.equal(demoClock(new Date('2026-10-31T12:55:00.000Z')).shiftDays, 0);
});

test('in the story week every instant comes back unchanged, by the real path', () => {
  const { d, t, shiftDays } = demoClock(new Date('2026-10-28T02:00:00.000Z'));
  assert.equal(shiftDays, 0);
  assert.equal(d('2026-11-08'), '2026-11-08');
  // One per kind of time in the seeds: summer and winter time, Melbourne midnight, odd seconds.
  for (const iso of ['2026-11-07T21:30:00.000Z', '2026-10-23T20:42:17.250Z', '2027-01-29T13:00:00.000Z', '2026-09-16T09:30:00.000Z',
    '2026-07-25T00:00:00.000Z', '2026-10-24T05:30:00.000Z', '2027-02-13T08:00:00.000Z']) assert.equal(t(iso), iso);
});

test('a moved instant keeps its weekday and its Melbourne clock time across daylight saving', () => {
  // Built for Wed 14/07/2027 (winter time): 37 weeks on.
  const { d, t, shiftDays } = demoClock(new Date('2027-07-14T02:00:00.000Z'));
  assert.equal(shiftDays, 259);
  assert.equal(d('2026-11-08'), '2027-07-25');
  const ride = t('2026-11-07T21:30:00.000Z'); // Sun 08/11/2026 8:30 am
  assert.equal(ride, '2027-07-24T22:30:00.000Z');
  assert.equal(melbourneDate(ride), '2027-07-25');
  assert.equal(melbourneHhmm(ride), '08:30');
  assert.equal(melbourneHhmm(t('2027-01-29T13:00:00.000Z')), '00:00'); // an all-day ride's midnight
  assert.equal(t('2026-10-23T20:42:17.250Z'), '2027-07-09T21:42:17.250Z'); // seconds and ms kept
});

test('t() agrees with melbourneInstant on every day of two years', () => {
  // Story Wed 28/10/2026 7:30 pm, moved to each week: always Wednesday 7:30 pm.
  for (let week = -2; week < 110; week++) {
    const today = addDays('2026-10-25', week * 7 + 3);
    const moved = storyDates(today).t('2026-10-28T08:30:00.000Z');
    assert.equal(moved, melbourneInstant(addDays('2026-10-28', week * 7), '19:30'), today);
  }
});

test('a time in the hour the clocks skip moves to the next hour; in the repeated hour it is the first', () => {
  // Story Sun 25/10/2026 2:30 am, moved 49 weeks to Sun 03/10/2027, when 2:00 to 3:00 am does not exist.
  const skip = demoClock(new Date('2027-10-05T02:00:00.000Z')).t('2026-10-24T15:30:00.000Z');
  assert.equal(melbourneDate(skip), '2027-10-03');
  assert.equal(melbourneHhmm(skip), '03:30');
  // Moved 23 weeks to Sun 04/04/2027, when 2:00 to 3:00 am happens twice: the first (summer time) one.
  const twice = demoClock(new Date('2027-04-06T02:00:00.000Z')).t('2026-10-24T15:30:00.000Z');
  assert.equal(twice, '2027-04-03T15:30:00.000Z');
});

test('notAfterNow caps a stamp at now and leaves an earlier one alone', () => {
  const { notAfterNow, now } = demoClock(new Date('2027-01-01T02:00:00.000Z'));
  assert.equal(notAfterNow('2027-01-01T09:30:00.000Z'), now);
  assert.equal(notAfterNow('2026-12-31T09:30:00.000Z'), '2026-12-31T09:30:00.000Z');
});

test('date words', () => {
  assert.equal(monthName('2026-11-04'), 'November');
  assert.deepEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-30'].map(dayOrdinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th']);
  assert.equal(weekdayName('2026-11-08'), 'Sunday');
  assert.equal(dayMonth('2026-12-07'), '7 December');
  assert.equal(fixed('2019-03-09'), '2019-03-09');
});

test('building a clock is cheap: no formatter per call', () => {
  const { t } = demoClock(new Date('2027-07-14T02:00:00.000Z'));
  const started = performance.now();
  for (let i = 0; i < 2000; i++) t('2026-11-07T21:30:00.000Z');
  assert.ok(performance.now() - started < 200, 'cache the Melbourne offset per calendar date');
});

// Added beyond the plan: the two daylight-saving days in the other direction (a story instant that sits on one).
test('a story instant on a daylight-saving day moves to its clock time on an ordinary day', () => {
  // Sun 04/10/2026 (clocks went forward at 2 am) 10:00 am summer time, moved 3 weeks to Sun 25/10/2026 (built for Wed 18/11/2026).
  const { t } = storyDates('2026-11-18');
  assert.equal(t('2026-10-03T23:00:00.000Z'), melbourneInstant('2026-10-25', '10:00'));
  // Sun 05/04/2026 (clocks went back at 3 am) 1:30 am summer time and 2:30 am winter time.
  const back = storyDates(addDays('2026-10-25', -2 * 7 + 1));
  assert.equal(melbourneHhmm(back.t('2026-04-04T14:30:00.000Z')), '01:30');
  assert.equal(melbourneHhmm(back.t('2026-04-04T16:30:00.000Z')), '02:30');
});
