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
  // Every target day from two weeks before the anchor to two years on, clock-change Sundays included:
  // a story instant at 8:30 am and 7:30 pm lands on the same clock time on its moved day.
  for (let day = -14; day < 770; day++) {
    const target = addDays('2026-10-25', day);
    const sd = storyDates(target);
    const storyDay = addDays(target, -sd.shiftDays);
    for (const hhmm of ['08:30', '19:30']) {
      assert.equal(sd.t(melbourneInstant(storyDay, hhmm)!), melbourneInstant(target, hhmm), `${target} ${hhmm}`);
    }
  }
});

test('seconds and milliseconds carry over when either end is a clock-change Sunday', () => {
  // Story Sun 25/10/2026 10:00:17.250 am moved 49 weeks to Sun 03/10/2027 (clocks go forward that morning).
  assert.equal(storyDates('2027-10-05').t('2026-10-24T23:00:17.250Z'), '2027-10-02T23:00:17.250Z');
  // Sun 04/10/2026 (clocks went forward) 10:00:17.250 am, moved 3 weeks to an ordinary Sunday.
  assert.equal(storyDates('2026-11-18').t('2026-10-03T23:00:17.250Z'), '2026-10-24T23:00:17.250Z');
  // Sun 05/04/2026 (clocks went back) 9:15:42.999 pm, moved 52 weeks to Sun 04/04/2027, also a clock-change day.
  assert.equal(storyDates('2027-10-26').t('2026-04-05T11:15:42.999Z'), '2027-04-04T11:15:42.999Z');
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

test('a cold build makes no Intl.DateTimeFormat per date or per call, clock-change Sundays included', () => {
  // Targets in 2030, which no other test here builds for, so nothing is kept from earlier tests.
  const Real = Intl.DateTimeFormat;
  let made = 0;
  const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    made++;
    return new Real(...args);
  } as unknown as typeof Intl.DateTimeFormat;
  Counting.prototype = Real.prototype;
  Counting.supportedLocalesOf = Real.supportedLocalesOf;
  const stories = Array.from({ length: 60 }, (_, i) => new Date(Date.parse('2026-10-24T23:00:00.000Z') + i * 26 * 3_600_000 + 17_250).toISOString());
  // Sun 06/10/2030 (clocks go forward) is a target: the story's Sun 25/10/2026 10:00 am moved there.
  const builds = ['2030-03-12', '2030-04-09', '2030-07-17', '2030-10-08'];
  const moved: string[] = [];
  Intl.DateTimeFormat = Counting;
  try {
    for (const today of builds) {
      const { t } = storyDates(today);
      for (const iso of stories) moved.push(t(iso));
    }
  } finally {
    Intl.DateTimeFormat = Real;
  }
  assert.ok(made <= 1, `made ${made} Intl.DateTimeFormat objects`);
  // And the answers are the ones melbourneInstant gives.
  let i = 0;
  for (const today of builds) {
    const sd = storyDates(today);
    for (const iso of stories) {
      const storyDay = melbourneDate(iso);
      const want = melbourneInstant(addDays(storyDay, sd.shiftDays), melbourneHhmm(iso)) ?? null;
      if (want !== null) assert.equal(Date.parse(moved[i]) - (Date.parse(iso) % 60_000), Date.parse(want), `${today} ${iso}`);
      i++;
    }
  }
  assert.ok(moved.includes(new Date(Date.parse(melbourneInstant('2030-10-06', '10:00')!) + 17_250).toISOString()));
});
