// The demo club on every instant: built for the day it is opened, never for the machine clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { busOverRide, busToday, canBookBus, clashesWith, managesBus, myRecentOff, notAnswered, rideCalledOff, waitingForYes } from '../domain/bus';
import { businessFor, melbourneHhmm, melbourneInstant } from '../domain/business';
import { clubYearOf } from '../domain/clubYear';
import { crewNeeded, eligibilityProblem, managesRide, showsCrewNeeded } from '../domain/crew';
import { addDays, daysBetween } from '../domain/dates';
import { chargeBalance, dueState, fyOf } from '../domain/fees';
import { fngDue } from '../domain/joining';
import { bankedLate, monthEnd, monthOf, reportFor } from '../domain/ledger';
import { noticeRecordFrom } from '../domain/notices';
import { addMonths, expiryAlerts } from '../domain/profile';
import { currentRoadRules, roadRulesStatus, signoffBase } from '../domain/roadRules';
import { lastDay, melbourneDate } from '../domain/rides';
import { standingOf } from '../domain/standing';
import type { ClubData } from '../domain/types';
import { patchVoteTooEarly } from '../domain/votes';
import type { DemoCtx } from './demoActions';
import { buildDemoData, demoTodayRide } from './demoData';
import { checkIn } from './demoStage4';
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
    // Spec section 5: Spanner's first aid kit is due in 7 days on a Sunday, tomorrow on a Saturday.
    assert.ok(between(daysTo(today, itemOf(data, 'ai-1').dueOn!), 1, 7), `ai-1 distance at ${now}`);
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
    // Spec section 5: each far ride, the cancelled one too, is its designed distance ahead (5 to 16
    // weeks on a Sunday, less 6 days by Saturday).
    for (const [id, least] of [['r-3', 29], ['r-4', 36], ['r-5', 43], ['r-6', 78], ['r-7', 91], ['r-8', 105]] as const) {
      const days = daysTo(today, rideOf(data, id).startsAt);
      assert.ok(between(days, least, least + 6) && between(days, 35 - 6, 112), `${id} distance at ${now}`);
    }
    const r4 = rideOf(data, 'r-4');
    assert.equal(melbourneDate(r4.endsAt!), melbourneDate(r4.startsAt), now);
    assert.equal(melbourneHhmm(r4.endsAt!), '17:00', now);
    assert.equal(daysBetween(melbourneDate(r7.startsAt), melbourneDate(r7.endsAt!)), 2, now);
    for (const r of data.rides.filter((x) => x.endsAt)) assert.ok(r.endsAt! > r.startsAt, `${r.id} ends after it starts at ${now}`);
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
    // The app's own crew rule, where it reads the first aid date against the ride day.
    for (const c of data.crew!) {
      assert.equal(eligibilityProblem(memberOf(data, c.memberId), c.role, rideOf(data, c.rideId), data), null, `${c.memberId} on ${c.rideId} at ${now}`);
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

// ---------------------------------------------------------------------------
// The half that already counted from today: fees, books, the auditor, Big 4, Gravel's notice and
// the four files that used to check it against the machine's day (spec sections 3 and 4).
// ---------------------------------------------------------------------------

/** Date paths in the data (array indexes dropped) that may be ahead of now: things still to come. */
const PLANNED = [
  'actionItems.dueOn', 'auditRequests.dueOn', 'busBookings.firstDay', 'busBookings.lastDay', 'charges.dueOn', 'feeRates.dueOn',
  'meetings.startsAt', 'privates.licenceExpiry', 'privates.firstAidExpiry', 'registrations.regoExpiry', 'rideHubs.closesOn',
  'rides.startsAt', 'rides.endsAt', 'statusNotices.respondBy', 'votes.closesAt',
];
/** Every other date path in the data: things that have happened, never after now. Listed by hand. */
const HAPPENED = [
  'actionItems.doneOn', 'attendance.checkedInAt', 'auditReports.fromOn', 'auditReports.issuedAt', 'auditReports.savedAt',
  'auditReports.toOn', 'auditRequests.answeredAt', 'auditRequests.raisedAt', 'big4Rides.designatedAt', 'briefingReads.readAt',
  'briefings.updatedAt', 'budgets.updatedAt', 'busBookings.bookedAt', 'busBookings.decidedAt', 'busCosts.loggedAt',
  'busCosts.spentOn', 'busCosts.struckAt', 'busKeys.loggedAt', 'busKm.loggedAt', 'busKm.readOn', 'busKm.struckAt',
  'chapterProposals.proposedAt', 'charges.createdAt', 'charges.waivedAt', 'charityRides.updatedAt', 'charitySignups.signedAt',
  'checkinSessions.closedAt', 'checkinSessions.heldOn', 'conduct.appeal.lodgedOn', 'conduct.decidedOn', 'conduct.noticeOn',
  'conduct.recordedAt', 'contributions.proposedAt', 'crew.assignedAt', 'documentSignoffs.signedAt', 'documentVersions.approvedOn',
  'documentVersions.commencesOn', 'documentVersions.publishedAt', 'documents.createdAt', 'exemptions.grantedAt',
  'hubRegistrations.registeredAt', 'ledger.approvals.approvedAt', 'ledger.entryOn', 'ledger.receivedOn', 'ledger.recordedAt',
  'ledger.updatedAt', 'meetingReports.fromOn', 'meetingReports.presentedAt', 'meetingReports.savedAt', 'meetingReports.toOn',
  'meetings.minutesApprovedAt', 'members.appliedOn', 'members.fngStartedOn', 'members.joinedOn', 'members.patchedOn',
  'members.postingRulesAcceptedOn', 'merchItems.decidedAt', 'merchItems.proposedAt', 'merchOrders.decidedAt',
  'merchOrders.orderedAt', 'payments.decidedAt', 'payments.paidOn', 'positions.endedOn', 'positions.startedOn',
  'rideHubs.updatedAt', 'ridePlans.updatedAt', 'rides.cancelledAt', 'roadRules.publishedAt', 'roadRulesSignoffs.signedAt',
  'routeRatings.ratedAt', 'routes.updatedAt', 'rsvps.updatedAt', 'shopDesigns.updatedAt', 'shopOrders.handedOverOn',
  'shopOrders.makeSentAt', 'shopOrders.orderedAt', 'shopOrders.paidOn', 'statusNotices.givenOn', 'treasurerReports.month',
  'treasurerReports.presentedAt', 'votes.closedAt', 'votes.openedAt', 'websiteSignups.createdAt', 'websiteSignups.updatedAt',
];
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;

/**
 * The constitution's published stamps: fixed (the real document's date, spec sections 3 and 9), so
 * before 25/10/2026 they are ahead of now. Keyed by path and value: the same paths carry
 * today-counted stamps for the other documents, which stay happened.
 */
const FIXED: Record<string, string> = {
  'documents.createdAt': '2026-10-25T03:00:00.000Z',
  'documentVersions.publishedAt': '2026-10-25T03:00:00.000Z',
};

/** Calls `visit` with each date value in the data and its path (array indexes dropped). */
const eachDate = (data: ClubData, visit: (key: string, value: string) => void) => {
  const walk = (value: unknown, path: string[]) => {
    if (typeof value === 'string') {
      if (DATE_VALUE.test(value)) visit(path.join('.'), value);
      return;
    }
    if (Array.isArray(value)) value.forEach((v) => walk(v, path));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
  };
  walk(data, []);
};

test('the two lists of date paths are the 99 in the data, each once', () => {
  assert.equal(PLANNED.length, 15);
  assert.equal(new Set([...PLANNED, ...HAPPENED]).size, PLANNED.length + HAPPENED.length);
  assert.equal(PLANNED.length + HAPPENED.length, 99);
  // The lists are the date paths the data really has: none missing, none left over.
  const found = new Set<string>();
  for (const instant of INSTANTS) eachDate(builtFor(instant), (key) => found.add(key));
  assert.deepEqual([...found].sort(), [...PLANNED, ...HAPPENED].sort());
});

test('every date in the demo is on the right side of now', () => {
  // Collected over every instant and asserted once, so one instant never hides the rest.
  const wrong: string[] = [];
  const fixedSeen = new Set<string>();
  for (const { now, today, data } of eachInstant()) {
    eachDate(data, (key, value) => {
      if (PLANNED.includes(key)) return;
      if (FIXED[key] === value) { fixedSeen.add(key); return; }
      if (!HAPPENED.includes(key)) wrong.push(`${now} ${key}: a date path neither list knows (${value})`);
      else if (value > (value.length > 10 ? now : today)) wrong.push(`${now} ${key}: ${value} is ahead of now`);
    });
  }
  assert.deepEqual([...new Set(wrong)], []);
  // A fixed value the data no longer carries is a stale exemption.
  assert.deepEqual([...fixedSeen].sort(), Object.keys(FIXED).sort());
});

const julyBefore = (date: string) => `${date.slice(5) >= '08-01' ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1}-07-31`;
/** The last day of the month after `date`'s. */
const endOfNextMonth = (date: string) => monthEnd(monthOf(addDays(`${date.slice(0, 7)}-28`, 7)));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

test('nothing open is behind now', () => {
  for (const { now, today, data } of eachInstant()) {
    assert.ok(data.statusNotices![0].respondBy >= today, `notice reply-by at ${now}`);
    const request = (id: string) => data.auditRequests!.find((r) => r.id === id)!;
    assert.ok(request('ar-1').dueOn >= today, `ar-1 at ${now}`);
    assert.ok(request('ar-2').dueOn < today, `ar-2 at ${now}`);
    const r2 = rideOf(data, 'r-2');
    assert.equal(melbourneDate(r2.startsAt), addDays(today, 6), `r-2 day at ${now}`);
    assert.equal(melbourneHhmm(r2.startsAt), '09:00', `r-2 start at ${now}`);
    assert.equal(melbourneDate(r2.endsAt!), melbourneDate(r2.startsAt), `r-2 end day at ${now}`);
    assert.equal(melbourneHhmm(r2.endsAt!), '14:00', `r-2 end at ${now}`);
  }
});

test('fees never open on a red Overdue', () => {
  for (const { now, today, data } of eachInstant()) {
    for (const charge of data.charges!) {
      assert.notEqual(dueState(charge, chargeBalance(charge, data.payments!), today), 'overdue', `${charge.id} at ${now}`);
    }
    const dueOn = data.charges![0].dueOn;
    for (const c of data.charges!) assert.equal(c.dueOn, dueOn, `${c.id} at ${now}`);
    for (const r of data.feeRates!) assert.equal(r.dueOn, dueOn, `fee rate ${r.chapterId} ${r.status} at ${now}`);
    const cy = clubYearOf(today, data.agms);
    const december = `${cy}-12-31`;
    const cap = `${cy + 1}-07-31`;
    const expected = today <= december ? december : [endOfNextMonth(today), cap].sort()[0];
    assert.equal(dueOn, expected, `due day at ${now}`);
  }
});

test('the books balance all year', () => {
  for (const { now, today, data } of eachInstant()) {
    for (const month of [data.treasurerReports![0].month, monthOf(today)]) {
      const report = reportFor(month, data);
      for (const [fund, cents] of Object.entries(report.funds)) assert.ok(cents >= 0, `${fund} closes ${month} at ${cents} at ${now}`);
      assert.equal(report.floatCents, 40000, `float for ${month} at ${now}`);
    }
    // Openings and the float are keyed to the financial year of the oldest entry (70 days ago).
    const booksFy = fyOf(addDays(today, -70));
    for (const o of data.fundOpenings!) assert.equal(o.fy, booksFy, `${o.chapterId ?? 'club'} opening at ${now}`);
    for (const f of data.cashFloats!) assert.equal(f.fy, booksFy, `float at ${now}`);
  }
});

test('the sausage sizzle is banked late on every weekday', () => {
  for (const { now, data } of eachInstant()) {
    assert.equal(bankedLate(data.ledger!.find((e) => e.id === 'le-6')!), true, now);
    const ar1 = data.auditRequests!.find((r) => r.id === 'ar-1')!;
    assert.match(ar1.details, /ten days/, now);
    assert.doesNotMatch(ar1.answer!, /weekend/, now);
  }
});

test('Gravel’s notice quotes a record that is behind', () => {
  for (const { now, today, data } of eachInstant()) {
    const gravel = memberOf(data, 'm-gravel');
    const notice = data.statusNotices![0];
    assert.equal(notice.givenOn, addDays(today, -3), now);
    const asAt = (day: string) => standingOf(gravel, data, day)!;
    const behind = (day: string) => asAt(day).lines.find((l) => l.key === 'meetings')!.state === 'behind';
    // As at the notice day when that reads behind; else as at the 31 July before it (a new club year).
    const day = behind(notice.givenOn) ? notice.givenOn : julyBefore(notice.givenOn);
    assert.equal(notice.record, noticeRecordFrom(asAt(day)), `record as at ${day}, at ${now}`);
    assert.ok(behind(day), `behind as at ${day}, at ${now}`);
    assert.equal(notice.proposal, 'Move to Supporter status from the next meeting after the reply date, unless the board grants relief (4.12).', now);
  }
});

test('the check-in code is the one the screen shows', () => {
  const screen = readFileSync(join(__dirname, '../screens/checkin.tsx'), 'utf8');
  const hint = screen.match(/label="Or type the code"[\s\S]*?placeholder="([^"]+)"/)![1];
  for (const { now, today, data } of eachInstant()) {
    const open = data.checkinSessions!.filter((s) => s.closedAt === null);
    assert.deepEqual(open.map((s) => s.code), ['RN2026'], now);
    assert.equal(open[0].code, hint, now);
    const ctx: DemoCtx = { data, me: memberOf(data, 'm-spanner'), today, now };
    const { data: after, id } = checkIn(ctx, hint);
    assert.equal(id, open[0].id, now);
    assert.ok(after.attendance!.some((a) => a.sessionId === id && a.memberId === 'm-spanner'), now);
  }
});

test('Big 4 designations come before their rides', () => {
  for (const { now, data } of eachInstant()) {
    for (const b of data.big4Rides!) {
      assert.ok(b.designatedAt < rideOf(data, b.rideId).startsAt, `${b.rideId} designated before it at ${now}`);
      assert.ok(b.designatedAt <= now, `${b.rideId} designated by now at ${now}`);
    }
  }
});

test('words in this half', () => {
  for (const { now, today, data } of eachInstant()) {
    assert.equal(data.contributions!.find((c) => c.id === 'nc-1')!.title, `National run ${Number(today.slice(0, 4)) + 1}`, now);
    const ar2 = data.auditRequests!.find((r) => r.id === 'ar-2')!;
    const statementMonth = monthName(addDays(monthOf(addDays(today, -17)), -1));
    assert.equal(ar2.title, `${statementMonth} bank statement`, now);
    assert.match(ar2.details, new RegExp(`\\b${statementMonth}\\b`), now);
    for (const other of MONTHS.filter((m) => m !== statementMonth)) assert.doesNotMatch(ar2.details, new RegExp(`\\b${other}\\b`), now);
    const fees = data.documentVersions!.find((v) => v.id === 'dv-fees-1')!;
    const cy = clubYearOf(fees.approvedOn!, data.agms);
    assert.equal(fees.label, `${cy}–${String(cy + 1).slice(2)}`, now);
    assert.equal(rideOf(data, 'r-brag-3').title, 'High Country run', now);
    assert.ok(data.meetingReports![0].notes.endsWith('\n\nGravel paid twice by mistake. His refund is on the way.'), now);
    const sundayRuns = data.rides.filter((r) => r.id.startsWith('r-season-') && r.title === 'Sunday run');
    assert.ok(sundayRuns.length > 0, now);
    for (const r of sundayRuns) assert.equal(weekdayName(melbourneDate(r.startsAt)), 'Sunday', `${r.id} at ${now}`);
  }
});

// ---------------------------------------------------------------------------
// The demo's states that demoBus, demoRoadRules, demoGoingGate and demoCrew used to check against
// the machine's day, now checked on every instant. Their action tests stay in their files.
// ---------------------------------------------------------------------------

test('the demo: a Booked charity ride on Ride for Kids on its own date', () => {
  for (const { now, today, data } of eachInstant()) {
    const ride = rideOf(data, 'r-6');
    assert.equal(ride.title, 'Ride for Kids (supported)', now);
    const b = data.busBookings!.find((x) => x.id === 'bus-1')!;
    assert.equal(b.purpose, 'charity_ride', now);
    assert.equal(b.status, 'approved', now);
    assert.equal(b.rideId, 'r-6', now);
    assert.equal(b.firstDay, melbourneDate(ride.startsAt), `the ride’s Melbourne date at ${now}`);
    assert.match(b.notes, /Ride for Kids/, now);
    assert.ok(b.firstDay > addDays(today, 1), `still to come, clear of today’s recovery, at ${now}`);
    assert.equal(b.lastDay, b.firstDay, `one day at ${now}`);
    assert.ok(managesBus(memberOf(data, b.decidedBy!), data), `said yes to by the board at ${now}`);
  }
});

test('the demo: a Booked recovery today, driven by Diesel, so the bus is out today', () => {
  for (const { now, today, data } of eachInstant()) {
    const recovery = data.busBookings!.filter((b) => b.purpose === 'recovery');
    assert.equal(recovery.length, 1, now);
    const [b] = recovery;
    assert.equal(b.status, 'approved', now);
    assert.equal(b.firstDay, today, now);
    assert.equal(b.lastDay, today, now);
    assert.equal(b.driverId, 'm-diesel', now);
    assert.equal(melbourneDate(b.bookedAt), today, `booked earlier today, straight away, at ${now}`);
    assert.ok(b.bookedAt <= now, `never booked in the future at ${now}`);
    assert.equal(b.decidedAt, b.bookedAt, `decided when it was booked at ${now}`);
    assert.equal(b.decidedBy, b.bookedBy, now);
    assert.equal(busToday(data, today)?.id, b.id, now);
    assert.ok(b.notes.length > 0 && b.notes.length <= 500, now);
  }
});

test('the demo: Spanner’s Waiting club-event request overlaps the charity booking', () => {
  for (const { now, today, data } of eachInstant()) {
    const waiting = waitingForYes(data, today);
    assert.equal(waiting.length, 1, now);
    const [b] = waiting;
    assert.equal(b.purpose, 'club_event', now);
    assert.equal(b.bookedBy, 'm-spanner', now);
    assert.equal(b.decidedBy, null, now);
    assert.equal(b.decidedAt, null, now);
    assert.deepEqual(clashesWith({ first: b.firstDay, last: b.lastDay }, data, b.id).map((c) => c.purpose), ['charity_ride'], now);
  }
});

test('the demo: a Declined request of Spanner’s from last week, with a reason, under his Yours', () => {
  for (const { now, today, data } of eachInstant()) {
    const declined = data.busBookings!.filter((b) => b.status === 'declined');
    assert.equal(declined.length, 1, now);
    const [b] = declined;
    assert.equal(b.bookedBy, 'm-spanner', now);
    assert.ok(b.declineReason.length > 0 && b.declineReason.length <= 300, `with a reason at ${now}`);
    assert.ok(b.firstDay >= addDays(today, -7) && b.lastDay < today, `its days were last week at ${now}`);
    assert.ok(managesBus(memberOf(data, b.decidedBy!), data), `said no to by the board at ${now}`);
    assert.ok(melbourneDate(b.decidedAt!) <= b.firstDay, `decided before its days at ${now}`);
    assert.ok(b.bookedAt < b.decidedAt!, now);
    assert.equal(myRecentOff(memberOf(data, 'm-spanner'), data, today)[0].id, b.id, now);
  }
});

test('the demo: a Waiting request of Spanner’s whose days passed without an answer, under his Yours', () => {
  for (const { now, today, data } of eachInstant()) {
    const unanswered = data.busBookings!.filter((b) => notAnswered(b, today));
    assert.equal(unanswered.length, 1, now);
    const [b] = unanswered;
    assert.equal(b.status, 'requested', `still stored as Waiting at ${now}`);
    assert.equal(b.bookedBy, 'm-spanner', now);
    assert.ok(b.lastDay < today && b.lastDay >= addDays(today, -30), `its days were in the last month at ${now}`);
    assert.ok(melbourneDate(b.bookedAt) < b.firstDay, `asked for before its days at ${now}`);
    assert.deepEqual(myRecentOff(memberOf(data, 'm-spanner'), data, today).map((x) => x.id), ['bus-4', b.id], now);
    assert.ok(!waitingForYes(data, today).some((x) => x.id === b.id), `not on the board’s list at ${now}`);
  }
});

test('the demo: a Booked charity ride whose ride moved, holding the bus on the new ride’s day', () => {
  for (const { now, today, data } of eachInstant()) {
    const held = data.busBookings!.filter((b) => rideCalledOff(b, data, today));
    assert.equal(held.length, 1, now);
    const [b] = held;
    assert.equal(b.status, 'approved', now);
    assert.equal(b.purpose, 'charity_ride', now);
    assert.ok(b.firstDay > addDays(today, 14), `past the fortnight, so its rides never show Crew needed, at ${now}`);
    const old = rideOf(data, b.rideId!);
    assert.ok(old.cancelledAt && melbourneDate(old.cancelledAt) < today, `cancelled when the website moved it at ${now}`);
    assert.equal(melbourneDate(old.startsAt), b.firstDay, now);
    assert.equal(b.lastDay, b.firstDay, now);
    // The calendar sync's new ride: same title, same day, a later time, not cancelled.
    const moved = data.rides.filter((r) => r.title === old.title && r.id !== old.id);
    assert.equal(moved.length, 1, now);
    const [ride] = moved;
    assert.equal(ride.cancelledAt, null, now);
    assert.equal(melbourneDate(ride.startsAt), b.firstDay, now);
    assert.equal(lastDay(ride), b.firstDay, now);
    assert.ok(ride.startsAt > old.startsAt, now);
    // Its crew managers see "Rusty Bus booked those days" in place of the Book link.
    assert.equal(busOverRide(ride, data)?.id, b.id, now);
    const torque = memberOf(data, 'm-torque');
    assert.ok(managesRide(torque, ride, data) && canBookBus(torque, data), now);
    // Torque booked it (so can cancel it); it never touches another booking.
    assert.equal(b.bookedBy, 'm-torque', now);
    assert.ok(!data.busBookings!.some((x) => x.id !== b.id && x.firstDay <= b.lastDay && b.firstDay <= x.lastDay), `no other booking those days at ${now}`);
  }
});

test('the demo: every booking is valid as the database would store it', () => {
  for (const { now, data } of eachInstant()) {
    const ids = new Set<string>();
    for (const b of data.busBookings!) {
      assert.ok(!ids.has(b.id), `${b.id} is unique at ${now}`);
      ids.add(b.id);
      assert.ok(b.lastDay >= b.firstDay, `${b.id} at ${now}`);
      for (const id of [b.driverId, b.bookedBy, b.decidedBy]) {
        if (id !== null) assert.equal(memberOf(data, id).approval, 'approved', `${b.id}: ${id} at ${now}`);
      }
      assert.equal(b.notes, b.notes.trim(), now);
      assert.equal(b.declineReason === '', b.status !== 'declined', `${b.id}: a reason only on a no, at ${now}`);
      assert.equal(b.cancelledAt, null, now);
    }
    for (const b of data.busBookings!.filter((x) => x.status === 'approved')) {
      assert.deepEqual(clashesWith({ first: b.firstDay, last: b.lastDay }, data, b.id), [], `${b.id} is never double-booked at ${now}`);
    }
  }
});

test('the demo: version 1 is a fresh, clearly labelled sample; version 2 is a small fix', () => {
  for (const { now, today, data } of eachInstant()) {
    const versions = [...(data.roadRules ?? [])].sort((a, b) => a.number - b.number);
    assert.deepEqual(versions.map((v) => v.number), [1, 2], now);
    const [v1, v2] = versions;
    assert.ok(v1.body.startsWith('# Sample Road Rules (demo only)\n'), `labelled as a sample on its first line at ${now}`);
    assert.ok(v1.body.length < 2000 && v2.body.length < 2000, `short at ${now}`);
    for (const v of versions) assert.equal(v.body, v.body.trim(), `stored trimmed, as a publish would, at ${now}`);
    assert.equal(v1.fresh, true, now);
    assert.equal(v1.changes, '', now);
    assert.equal(v2.fresh, false, `a small fix: sign-offs carry over, at ${now}`);
    assert.ok(v2.changes.length > 0 && v2.changes.length <= 500, `says what changed at ${now}`);
    assert.notEqual(v2.body, v1.body, now);
    assert.ok(Math.abs(v2.body.length - v1.body.length) < 40, `one small wording fix at ${now}`);
    for (const v of versions) assert.equal(v.publishedBy, 'm-rusty', `published by the NEC Chair at ${now}`);
    assert.equal(melbourneDate(v1.publishedAt), addMonths(today, -16), `version 1: 16 months ago, at ${now}`);
    assert.equal(melbourneDate(v2.publishedAt), addDays(today, -24), `version 2: 24 days ago, at ${now}`);
    assert.equal(currentRoadRules(data)?.number, 2, now);
    assert.equal(signoffBase(data)?.number, 1, now);
  }
});

test('the demo: Torque is signed, Spanner is due soon, Rusty has run out, Diesel never signed', () => {
  for (const { now, today, data } of eachInstant()) {
    const statusOf = (id: string) => roadRulesStatus(memberOf(data, id), data, today);
    const signedAt = (id: string) => (data.roadRulesSignoffs ?? []).find((s) => s.memberId === id)!.signedAt;
    assert.deepEqual(statusOf('m-torque'), { state: 'current', goodUntil: addMonths(addDays(today, -5), 12), signedVersion: 2 }, now);
    const spanner = statusOf('m-spanner');
    assert.equal(spanner.state, 'due_soon', now);
    assert.equal(spanner.signedVersion, 1, now);
    assert.equal(melbourneDate(signedAt('m-spanner')), addDays(addMonths(today, -11), -20), `11 months and 20 days ago, at ${now}`);
    assert.equal(statusOf('m-rusty').state, 'expired', now);
    assert.equal(melbourneDate(signedAt('m-rusty')), addMonths(today, -13), `13 months ago, at ${now}`);
    assert.equal(statusOf('m-diesel').state, 'unsigned', now);
    assert.equal((data.roadRulesSignoffs ?? []).some((s) => s.memberId === 'm-diesel'), false, now);
    // Every sign-off is after the version it signed was published, and on a real member.
    for (const s of data.roadRulesSignoffs ?? []) {
      const v = (data.roadRules ?? []).find((x) => x.number === s.version);
      assert.ok(v, `${s.memberId} signed a version that exists, at ${now}`);
      assert.ok(Date.parse(s.signedAt) > Date.parse(v.publishedAt), `${s.memberId} signed after it was published, at ${now}`);
      assert.ok(data.members.some((m) => m.id === s.memberId), now);
    }
  }
});

test('the demo keeps unsigned members to show the prompt: Rusty (the National persona) ran out, Diesel never signed', () => {
  for (const { now, today, data } of eachInstant()) {
    const stateOf = (id: string) => roadRulesStatus(memberOf(data, id), data, today).state;
    assert.equal(stateOf('m-rusty'), 'expired', now);
    assert.equal(stateOf('m-diesel'), 'unsigned', now);
    assert.equal(stateOf('m-torque'), 'current', now);
    assert.equal(stateOf('m-spanner'), 'due_soon', now);
  }
});

test('most demo members have signed, so the crew picker and the Member persona still work', () => {
  for (const { now, today, data } of eachInstant()) {
    const asked = data.members.filter((m) => m.approval === 'approved' && m.status !== 'legacy');
    const notSigned = asked.filter((m) => ['unsigned', 'expired'].includes(roadRulesStatus(m, data, today).state)).map((m) => m.id).sort();
    assert.deepEqual(notSigned, ['m-diesel', 'm-rusty'], now);
  }
});

test('the demo club has crew: an RC and TG on one ride, only an RC on another, and an Officer', () => {
  for (const { now, data } of eachInstant()) {
    const crew = data.crew ?? [];
    const roles = (id: string) => crew.filter((s) => s.rideId === id).map((s) => s.role).sort();
    assert.ok(crew.some((s) => s.role === 'officer'), now);
    const complete = data.rides.filter((r) => roles(r.id).includes('road_captain') && roles(r.id).includes('tail_gunner'));
    const partial = data.rides.filter((r) => roles(r.id).includes('road_captain') && !roles(r.id).includes('tail_gunner'));
    assert.ok(complete.length >= 1 && partial.length >= 1, now);
    assert.equal(crewNeeded(complete[0], crew), false, now);
    assert.equal(crewNeeded(partial[0], crew), true, now);
    assert.deepEqual(roles('r-2'), ['road_captain'], `North coffee and curves has an RC and no TG, at ${now}`);
    assert.equal(crewNeeded(rideOf(data, 'r-2'), crew), true, `so it needs crew, at ${now}`);
    // Everyone crewing is a Full or Nomad member, going, with first aid for the Tail Gunner spots.
    for (const s of crew) {
      const m = memberOf(data, s.memberId);
      assert.ok(m.status === 'full' || m.status === 'nomad', `${m.fullName} is ${m.status} at ${now}`);
      assert.equal(data.rsvps.find((r) => r.rideId === s.rideId && r.memberId === s.memberId)?.answer, 'going', now);
      if (s.role === 'tail_gunner' || s.role === 'assistant_tail_gunner') {
        const aid = data.privates.find((p) => p.memberId === s.memberId)?.firstAidExpiry;
        assert.ok(aid && aid >= rideOf(data, s.rideId).startsAt.slice(0, 10), `${m.fullName} first aid at ${now}`);
      }
    }
  }
});

test('a demo ride shows Crew needed for a manager on the demo’s today', () => {
  for (const { now, today, data } of eachInstant()) {
    const smokey = memberOf(data, 'm-smokey'); // North president
    const gravel = memberOf(data, 'm-gravel'); // West board: not North's crew, but a manager of club-wide rides
    // Smokey sits on the NEC, so he sees every ride that needs crew in its fortnight: the North one always.
    const north = data.rides.filter((r) => r.category === 'north' && showsCrewNeeded(smokey, r, data, today));
    assert.ok(north.length >= 1, `a North ride with no TG starts in the next 14 days, at ${now}`);
    assert.equal(north.some((r) => showsCrewNeeded(gravel, r, data, today)), false, `not for a West board member, at ${now}`);
    // The club lunch ride brought inside the fortnight, so a ride Gravel does manage is in the list too.
    const near = melbourneInstant(addDays(today, 5), '09:00')!;
    const club: ClubData = { ...data, rides: data.rides.map((r) => (r.id === 'r-4' ? { ...r, startsAt: near, endsAt: null } : r)) };
    const needy = club.rides.filter((r) => showsCrewNeeded(smokey, r, club, today));
    const outcomes = new Set<boolean>();
    for (const r of needy) {
      const shown = showsCrewNeeded(gravel, r, club, today);
      outcomes.add(shown);
      assert.equal(shown, managesRide(gravel, r, club), `only for a manager of ${r.title}, at ${now}`);
    }
    assert.deepEqual([...outcomes].sort(), [false, true], `both outcomes exercised, at ${now}`);
  }
});
