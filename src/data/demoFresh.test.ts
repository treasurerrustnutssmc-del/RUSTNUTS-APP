// The demo club on every instant: built for the day it is opened, never for the machine clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessFor, melbourneHhmm } from '../domain/business';
import { eligibilityProblem } from '../domain/crew';
import { addDays, daysBetween } from '../domain/dates';
import { fngDue } from '../domain/joining';
import { expiryAlerts } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { ClubData } from '../domain/types';
import { patchVoteTooEarly } from '../domain/votes';
import { buildDemoData, demoTodayRide } from './demoData';
import { dayOrdinal, monthName, weekdayName } from './demoStory';
import { DEMO_DATA, INSTANTS, STORY_TODAY, builtFor } from './demoStory.testkit';

test('the demo is built for the instant it is given, not for the machine clock', () => {
  const a = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  const b = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  assert.deepEqual(a, b);
  assert.notEqual(a, b); // a fresh object each time: the provider owns its copy
  assert.equal(a.checkinSessions!.find((s) => s.id === 'cs-today')!.heldOn, '2027-03-10');
  assert.equal(a.busBookings!.find((x) => x.id === 'bus-2')!.firstDay, '2027-03-10');
});

test('building the demo never reads the machine clock', () => {
  // A Date that throws on the two ways to read the clock: `new Date()` with nothing, and `Date.now()`.
  // Built for every instant, since a clock read can hide on an arm that only runs on some days.
  const RealDate = Date;
  class NoClock extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error('read the machine clock: new Date()');
      super(...(args as [number]));
    }
    static now(): number { throw new Error('read the machine clock: Date.now()'); }
  }
  // The Dates are made before the clock is taken away.
  const nows = INSTANTS.map((instant) => ({ instant, now: new RealDate(instant) }));
  globalThis.Date = NoClock as DateConstructor;
  try {
    for (const { instant, now } of nows) {
      assert.doesNotThrow(() => buildDemoData(now), `buildDemoData for ${instant}`);
      assert.doesNotThrow(() => demoTodayRide(now), `demoTodayRide for ${instant}`);
    }
  } finally {
    globalThis.Date = RealDate;
  }
});

test('same ids, same order, same keys, whatever the instant', () => {
  const shape = (data: ClubData) => Object.fromEntries(Object.entries(data).map(([key, rows]) =>
    [key, Array.isArray(rows) ? rows.map((row, i) => (row as { id?: string }).id ?? i) : typeof rows]));
  for (const instant of INSTANTS) assert.deepEqual(shape(builtFor(instant)), shape(DEMO_DATA), instant);
  assert.equal(DEMO_DATA.rides.some((r) => r.id === 'r-today'), false);
});

// ---------------------------------------------------------------------------
// The story half: moved a week at a time, so every designed state holds on every weekday (spec
// section 5), and its words follow its dates (spec section 6).
// ---------------------------------------------------------------------------

/** Each instant with its Melbourne date and the demo built for it. */
const eachInstant = () => INSTANTS.map((now) => ({ now, today: melbourneDate(now), data: builtFor(now) }));
const rideOf = (data: ClubData, id: string) => data.rides.find((r) => r.id === id)!;
const voteOf = (data: ClubData, id: string) => data.votes!.find((v) => v.id === id)!;
const meetingOf = (data: ClubData, id: string) => data.meetings!.find((m) => m.id === id)!;
const itemOf = (data: ClubData, id: string) => data.actionItems!.find((a) => a.id === id)!;
const memberOf = (data: ClubData, id: string) => data.members.find((m) => m.id === id)!;
const DAY_MS = 86_400_000;
/** Whole Melbourne days from today to an instant's (or a date's) Melbourne date. */
const daysTo = (today: string, iso: string) => daysBetween(today, iso.length > 10 ? melbourneDate(iso) : iso);
const between = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

test('the business story', () => {
  for (const { now, today, data } of eachInstant()) {
    const spanner = businessFor(memberOf(data, 'm-spanner'), data, now);
    assert.deepEqual(spanner.needsMe.map((v) => v.id), ['v-1'], now);
    assert.ok(spanner.closedVotes.some((v) => v.id === 'v-3'), now);
    assert.deepEqual(spanner.myActions.map((a) => a.id), ['ai-1'], now);
    const torque = businessFor(memberOf(data, 'm-torque'), data, now);
    assert.deepEqual(torque.needsMe.map((v) => v.id), ['v-2'], now);
    assert.deepEqual(torque.upcoming.map((m) => m.id), ['mt-1'], now);
    const rusty = businessFor(memberOf(data, 'm-rusty'), data, now);
    assert.deepEqual(rusty.upcoming.map((m) => m.id), ['mt-1', 'mt-4'], now);
    const pastState = (id: string) => rusty.past.find((p) => p.meeting.id === id)?.state;
    assert.equal(pastState('mt-2'), 'overdue', now);
    assert.equal(pastState('mt-3'), 'approved', now);

    for (const v of data.votes!.filter((x) => x.closedAt === null)) {
      assert.ok(v.openedAt <= now && now < v.closesAt, `${v.id} open at ${now}`);
      assert.ok(Date.parse(v.closesAt) - Date.parse(v.openedAt) <= 60 * DAY_MS, `${v.id} within 60 days at ${now}`);
    }
    assert.ok(voteOf(data, 'v-3').closedAt! <= now, now);
    for (const id of ['ai-1', 'ai-4']) assert.ok(itemOf(data, id).dueOn! >= today, `${id} at ${now}`);
    assert.ok(between(daysBetween(itemOf(data, 'ai-2').dueOn!, today), 5, 11), `ai-2 at ${now}`);
    const ai3 = itemOf(data, 'ai-3');
    assert.ok(ai3.doneOn! < ai3.dueOn!, `ai-3 at ${now}`);
    const mt1 = meetingOf(data, 'mt-1').startsAt;
    assert.ok(between(daysTo(today, mt1), 4, 10), `mt-1 at ${now}`);
    assert.equal(weekdayName(melbourneDate(mt1)), 'Wednesday', now);
    assert.equal(melbourneHhmm(mt1), '19:30', now);
    assert.ok(between(-daysTo(today, meetingOf(data, 'mt-2').startsAt), 11, 17), `mt-2 at ${now}`);
  }
});

test('days to each vote’s close', () => {
  for (const { now, today, data } of eachInstant()) {
    const close = (id: string) => voteOf(data, id).closesAt;
    assert.ok(between(daysTo(today, close('v-1')), 4, 10), `v-1 at ${now}`);
    assert.equal(weekdayName(melbourneDate(close('v-1'))), 'Wednesday', now);
    assert.equal(melbourneHhmm(close('v-1')), '19:00', now);
    assert.ok(between(daysTo(today, close('v-2')), 2, 8), `v-2 at ${now}`);
    assert.equal(weekdayName(melbourneDate(close('v-2'))), 'Monday', now);
    assert.equal(melbourneHhmm(close('v-2')), '19:00', now);
    assert.ok(between(daysTo(today, close('v-4')), 3, 9), `v-4 at ${now}`);
    assert.equal(weekdayName(melbourneDate(close('v-4'))), 'Tuesday', now);
  }
});

test('rides', () => {
  for (const { now, today, data } of eachInstant()) {
    const r1 = rideOf(data, 'r-1');
    assert.ok(between(daysTo(today, r1.startsAt), 8, 14), `r-1 at ${now}`);
    assert.equal(weekdayName(melbourneDate(r1.startsAt)), 'Sunday', now);
    assert.equal(melbourneHhmm(r1.startsAt), '08:30', now);
    assert.equal(melbourneHhmm(r1.endsAt!), '12:00', now);
    assert.equal(melbourneDate(r1.endsAt!), melbourneDate(r1.startsAt), now);
    for (const id of ['r-3', 'r-4', 'r-6', 'r-7', 'r-8']) assert.ok(rideOf(data, id).startsAt > now, `${id} ahead at ${now}`);
    for (const id of ['r-3', 'r-4', 'r-5', 'r-6']) assert.equal(weekdayName(melbourneDate(rideOf(data, id).startsAt)), 'Sunday', `${id} at ${now}`);
    for (const id of ['r-7', 'r-8']) assert.equal(weekdayName(melbourneDate(rideOf(data, id).startsAt)), 'Saturday', `${id} at ${now}`);
    const r7 = rideOf(data, 'r-7');
    assert.equal(r7.allDay, true, now);
    assert.equal(melbourneHhmm(r7.startsAt), '00:00', now);
    assert.equal(melbourneHhmm(r7.endsAt!), '00:00', now);
    assert.ok(rideOf(data, 'r-5').cancelledAt! <= now, `r-5 cancelled at ${now}`);
  }
});

test('the breakfast run’s paperwork', () => {
  for (const { now, data } of eachInstant()) {
    const r1 = rideOf(data, 'r-1');
    const readAt = (id: string) => data.briefingReads!.find((r) => r.rideId === 'r-1' && r.memberId === id)!.readAt;
    const updated = data.briefings!.find((b) => b.rideId === 'r-1')!.updatedAt;
    assert.ok(readAt('m-diesel') < updated && updated < readAt('m-spanner') && readAt('m-spanner') < now, `briefing order at ${now}`);
    assert.ok(readAt('m-spanner') < r1.startsAt, now);
    for (const c of data.crew!.filter((x) => x.rideId === 'r-1')) {
      assert.equal(data.rsvps.find((r) => r.rideId === 'r-1' && r.memberId === c.memberId)?.answer, 'going', `${c.memberId} at ${now}`);
    }
    for (const c of data.crew!.filter((x) => x.role === 'tail_gunner' || x.role === 'assistant_tail_gunner')) {
      const aid = data.privates.find((p) => p.memberId === c.memberId)!.firstAidExpiry;
      assert.ok(aid !== null && aid >= melbourneDate(rideOf(data, c.rideId).startsAt), `${c.memberId} first aid on ${c.rideId} at ${now}`);
    }
  }
});

test('expiries', () => {
  for (const { now, today, data } of eachInstant()) {
    const alerts = expiryAlerts(data.members, data, today);
    const key = (a: { memberId: string; kind: string }) => `${a.memberId} ${a.kind}`;
    assert.deepEqual(alerts.filter((a) => a.state === 'expired').map(key), ['m-gravel rego'], now);
    assert.deepEqual(alerts.map(key).sort(),
      ['m-crank first_aid', 'm-diesel rego', 'm-gravel licence', 'm-gravel rego', 'm-spanner rego'], now);
    const days = (k: string) => daysBetween(today, alerts.find((a) => key(a) === k)!.expiry);
    assert.ok(between(-days('m-gravel rego'), 13, 19), `Gravel's rego at ${now}`);
    assert.ok(between(days('m-spanner rego'), 8, 14), `Spanner's rego at ${now}`);
    for (const k of ['m-gravel licence', 'm-diesel rego', 'm-crank first_aid']) {
      assert.equal(alerts.find((a) => key(a) === k)!.state, 'soon', `${k} at ${now}`);
      assert.ok(between(days(k), 15, 26), `${k} at ${now}`);
    }
  }
});

test('people', () => {
  const pinned = (id: string) => {
    const m = memberOf(DEMO_DATA, id);
    const due = fngDue(m, DEMO_DATA.decisions ?? [], STORY_TODAY);
    return { due: due && { atMonths: due.atMonths, overdue: due.overdue }, crew: eligibilityProblem(m, 'tail_gunner', rideOf(DEMO_DATA, 'r-1'), DEMO_DATA) };
  };
  const expected = { 'm-throttle': pinned('m-throttle'), 'm-lefty': pinned('m-lefty') };
  for (const { now, today, data } of eachInstant()) {
    const throttle = memberOf(data, 'm-throttle');
    assert.equal(patchVoteTooEarly(throttle.fngStartedOn, today), false, now);
    for (const id of ['m-throttle', 'm-lefty'] as const) {
      const m = memberOf(data, id);
      const due = fngDue(m, data.decisions ?? [], today);
      assert.deepEqual({ due: due && { atMonths: due.atMonths, overdue: due.overdue }, crew: eligibilityProblem(m, 'tail_gunner', rideOf(data, 'r-1'), data) },
        expected[id], `${id} at ${now}`);
    }
    for (const id of ['m-dylan', 'm-josh']) assert.ok(between(daysBetween(memberOf(data, id).appliedOn!, today), 2, 10), `${id} at ${now}`);
  }
});

test('the lunch ride’s sleepover', () => {
  for (const { now, today, data } of eachInstant()) {
    const hub = data.rideHubs!.find((h) => h.rideId === 'r-4')!;
    assert.ok(today <= hub.closesOn! && hub.closesOn! <= melbourneDate(rideOf(data, 'r-4').startsAt), `hub at ${now}`);
  }
});

test('words agree with dates', () => {
  for (const { now, data } of eachInstant()) {
    const day = (id: string) => melbourneDate(meetingOf(data, id).startsAt);
    const mt1 = meetingOf(data, 'mt-1');
    assert.equal(mt1.title, `${monthName(day('mt-1'))} board meeting`, now);
    assert.equal(meetingOf(data, 'mt-2').title, `${monthName(day('mt-2'))} general meeting`, now);
    assert.equal(meetingOf(data, 'mt-3').title, `${monthName(day('mt-3'))} general meeting`, now);
    const monthBefore = addDays(`${day('mt-1').slice(0, 7)}-01`, -1);
    assert.equal(mt1.agenda[0].notes, `Sparks to table the ${monthName(monthBefore)} figures.`, now);
    assert.equal(mt1.agenda[2].notes, `Result due by the ${dayOrdinal(melbourneDate(voteOf(data, 'v-1').closesAt))}.`, now);
    assert.equal(voteOf(data, 'v-1').details, `Nine months as an FNG, every ride since ${monthName(memberOf(data, 'm-throttle').fngStartedOn!)}.`, now);
    assert.equal(data.privates.find((p) => p.memberId === 'm-dylan')!.applicationNote,
      'Been riding with the West crew for a few months. Ride a 2019 Street Bob.', now);
    const words = JSON.stringify([data.rides, data.votes, data.actionItems, data.meetings, data.rideHubs, data.privates]);
    assert.doesNotMatch(words, /Christmas|Kris Kringle/, now);

    const r4 = rideOf(data, 'r-4');
    assert.equal(r4.title, 'Rustnuts club lunch ride', now);
    assert.equal(r4.notes, 'Both chapters. Lunch and the raffle after.', now);
    const mt2 = meetingOf(data, 'mt-2');
    assert.deepEqual(mt2.agenda.map((a) => a.title), ['Club lunch ride', 'Toy Run'], now);
    assert.equal(mt2.minutes,
      'Present: 14 members.\n\nClub lunch ride: lunch at the clubhouse, raffle tickets $5.\nToy Run: West rides together, KSU 9:00 from Laverton.', now);
    assert.equal(itemOf(data, 'ai-3').title, 'Book the clubhouse for the club lunch ride', now);
    assert.equal(voteOf(data, 'v-3').question, 'Move the club lunch ride a week earlier?', now);
    assert.equal(data.rideHubs!.find((h) => h.rideId === 'r-4')!.notes, 'Bring a plate for the lunch.', now);
  }
});
