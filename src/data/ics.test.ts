import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor, parseIcs, type FeedEvent } from '../../supabase/functions/_shared/ics';

const FROM = '2026-10-24T00:00:00.000Z';
const TO = '2027-10-24T00:00:00.000Z';

/** Wraps VEVENT bodies in a calendar, with CRLF line ends like Google sends. */
const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.trim().split('\n').map((l) => l.trim()), 'END:VEVENT']),
    'END:VCALENDAR'].join('\r\n');

const starts = (events: FeedEvent[]) => events.map((e) => e.startsAt);

test('reads a timed ride in Melbourne time, with folded and escaped text', () => {
  const text = cal(`
    UID:abc@google.com
    DTSTART;TZID=Australia/Melbourne:20261108T083000
    DTEND;TZID=Australia/Melbourne:20261108T160000
    SUMMARY:West: Breakfast run to Daylesford\\, then home
    LOCATION:Caltex Laverton\\; meet out the front
    DESCRIPTION:Full tank.\\nBring a jacket \\\\ gloves.
    CATEGORIES:West
  `).replace('Daylesford', 'Dayles\r\n ford');
  const [ev] = parseIcs(text, FROM, TO);
  assert.deepEqual(ev, {
    uid: 'abc@google.com',
    startsAt: '2026-11-07T21:30:00.000Z',
    endsAt: '2026-11-08T05:00:00.000Z',
    allDay: false,
    title: 'West: Breakfast run to Daylesford, then home',
    location: 'Caltex Laverton; meet out the front',
    notes: 'Full tank.\nBring a jacket \\ gloves.',
    categoryHint: 'West',
  });
});

test('UTC times are read as given; a missing end means an hour later', () => {
  const [ev] = parseIcs(cal('UID:u1\nDTSTART:20261108T000000Z\nSUMMARY:Ride'), FROM, TO);
  assert.equal(ev.startsAt, '2026-11-08T00:00:00.000Z');
  assert.equal(ev.endsAt, '2026-11-08T01:00:00.000Z');
  assert.equal(ev.location, null);
  assert.equal(ev.notes, null);
  assert.equal(ev.categoryHint, null);
});

test('an all-day ride stays on its Melbourne date', () => {
  const [single] = parseIcs(cal('UID:a1\nDTSTART;VALUE=DATE:20261108\nSUMMARY:Toy run'), FROM, TO);
  assert.equal(single.allDay, true);
  assert.equal(single.startsAt, '2026-11-07T13:00:00.000Z', 'midnight 8 Nov in Melbourne');
  assert.equal(single.endsAt, null);
  const [weekend] = parseIcs(cal('UID:a2\nDTSTART;VALUE=DATE:20261121\nDTEND;VALUE=DATE:20261123\nSUMMARY:Big 4'), FROM, TO);
  assert.equal(weekend.endsAt, '2026-11-22T13:00:00.000Z', 'a two-day ride keeps its end');
});

test('weekly repeats keep their local time across the daylight saving change', () => {
  const events = parseIcs(cal(`
    UID:w1
    DTSTART;TZID=Australia/Melbourne:20270321T090000
    DTEND;TZID=Australia/Melbourne:20270321T120000
    RRULE:FREQ=WEEKLY;COUNT=3
    SUMMARY:Sunday ride
  `), FROM, TO);
  assert.deepEqual(starts(events), ['2027-03-20T22:00:00.000Z', '2027-03-27T22:00:00.000Z', '2027-04-03T23:00:00.000Z']);
  assert.equal(events[2].endsAt, '2027-04-04T02:00:00.000Z', 'same three hours');
  assert.ok(events.every((e) => e.uid === 'w1'));
});

test('monthly on the first Sunday, with an interval, an end date and a skipped date', () => {
  const events = parseIcs(cal(`
    UID:m1
    DTSTART;TZID=Australia/Melbourne:20261101T100000
    RRULE:FREQ=MONTHLY;BYDAY=1SU;UNTIL=20270301T000000Z
    EXDATE;TZID=Australia/Melbourne:20270103T100000
    SUMMARY:Club ride
  `), FROM, TO);
  assert.deepEqual(starts(events), ['2026-10-31T23:00:00.000Z', '2026-12-05T23:00:00.000Z', '2027-02-06T23:00:00.000Z']);
  const fortnightly = parseIcs(cal(`
    UID:f1
    DTSTART;TZID=Australia/Melbourne:20261104T190000
    RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=3
    SUMMARY:Meeting
  `), FROM, TO);
  assert.deepEqual(starts(fortnightly), ['2026-11-04T08:00:00.000Z', '2026-11-18T08:00:00.000Z', '2026-12-02T08:00:00.000Z']);
});

test('a moved occurrence replaces the original; cancelled ones are left out', () => {
  const events = parseIcs(cal(`
    UID:r1
    DTSTART;TZID=Australia/Melbourne:20261107T090000
    RRULE:FREQ=WEEKLY;COUNT=3
    SUMMARY:Saturday ride
  `, `
    UID:r1
    RECURRENCE-ID;TZID=Australia/Melbourne:20261114T090000
    DTSTART;TZID=Australia/Melbourne:20261115T090000
    SUMMARY:Saturday ride (moved to Sunday)
  `, `
    UID:gone
    DTSTART:20261201T000000Z
    STATUS:CANCELLED
    SUMMARY:Called off
  `), FROM, TO);
  assert.deepEqual(events.map((e) => [e.startsAt, e.title]), [
    ['2026-11-06T22:00:00.000Z', 'Saturday ride'],
    ['2026-11-14T22:00:00.000Z', 'Saturday ride (moved to Sunday)'],
    ['2026-11-20T22:00:00.000Z', 'Saturday ride'],
  ]);
});

test('only rides inside the window come back, and odd repeats don’t break the feed', () => {
  const events = parseIcs(cal(
    'UID:old\nDTSTART:20250101T000000Z\nSUMMARY:Old',
    'UID:far\nDTSTART:20300101T000000Z\nSUMMARY:Far',
    'UID:hourly\nDTSTART:20261110T000000Z\nRRULE:FREQ=HOURLY;COUNT=5\nSUMMARY:Odd',
    'UID:forever\nDTSTART:20261105T000000Z\nRRULE:FREQ=YEARLY\nSUMMARY:Anniversary',
  ), FROM, TO);
  assert.deepEqual(events.map((e) => [e.uid, e.startsAt]), [
    ['forever', '2026-11-05T00:00:00.000Z'],
    ['hourly', '2026-11-10T00:00:00.000Z'],
  ]);
});

test('something that isn’t a calendar is refused', () => {
  assert.throws(() => parseIcs('<!doctype html><html>Sign in</html>', FROM, TO), /Not a calendar/);
});

test('ride colour: the feed’s own colour, then a title prefix, then its category, else the whole club', () => {
  const ev = (title: string, categoryHint: string | null = null): FeedEvent => ({
    uid: 'x', startsAt: FROM, endsAt: null, allDay: false, title, location: null, notes: null, categoryHint,
  });
  assert.equal(categoryFor('north', ev('West: Coffee run')), 'north');
  assert.equal(categoryFor(null, ev('West: Coffee run')), 'west');
  assert.equal(categoryFor(null, ev('non-nuts: Toy Run')), 'non_nuts');
  assert.equal(categoryFor(null, ev('Rustnuts: Christmas ride')), 'club');
  assert.equal(categoryFor(null, ev('Charity run', 'Supported')), 'supported');
  assert.equal(categoryFor(null, ev('Charity run', 'Something else')), 'club');
  assert.equal(categoryFor(null, ev('Breakfast')), 'club');
});

// Review findings, 24 Oct 2026.

test('a date that comes out twice is only listed once, and a moved ride wins', () => {
  const moved = parseIcs(cal(`
    UID:d1
    DTSTART;TZID=Australia/Melbourne:20261101T090000
    RRULE:FREQ=WEEKLY;COUNT=3
    SUMMARY:Sunday ride
  `, `
    UID:d1
    RECURRENCE-ID;TZID=Australia/Melbourne:20261108T090000
    DTSTART;TZID=Australia/Melbourne:20261115T090000
    SUMMARY:Doubled up
  `), FROM, TO);
  assert.deepEqual(moved.map((e) => [e.startsAt, e.title]), [
    ['2026-10-31T22:00:00.000Z', 'Sunday ride'],
    ['2026-11-14T22:00:00.000Z', 'Doubled up'],
  ]);
  const fourthAndLast = parseIcs(cal(`
    UID:d2
    DTSTART;TZID=Australia/Melbourne:20261122T090000
    RRULE:FREQ=MONTHLY;BYDAY=4SU,-1SU;COUNT=4
    SUMMARY:Late-month ride
  `), FROM, TO);
  assert.equal(new Set(fourthAndLast.map((e) => e.startsAt)).size, fourthAndLast.length, 'no repeats');
  assert.ok(fourthAndLast.some((e) => e.startsAt === '2026-12-26T22:00:00.000Z'), '27 Dec is there once');
});

test('a stray quote mark in the text doesn’t lose the text', () => {
  const [ev] = parseIcs(cal(`
    UID:q1
    DTSTART:20261108T000000Z
    SUMMARY:Bring 6" spacers
    DESCRIPTION:Meet 7:30. Bring 2" spacers
    LOCATION;ALTREP="http://example.com:80/map":Caltex: out the front
  `), FROM, TO);
  assert.equal(ev.title, 'Bring 6" spacers');
  assert.equal(ev.notes, 'Meet 7:30. Bring 2" spacers');
  assert.equal(ev.location, 'Caltex: out the front');
});

test('fortnightly weeks start on the calendar’s own week start (WKST)', () => {
  const events = parseIcs(cal(`
    UID:k1
    DTSTART;TZID=Australia/Melbourne:20261107T090000
    RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SA,SU;COUNT=4
    SUMMARY:Weekend
  `), FROM, TO);
  assert.deepEqual(events.map((e) => melbDay(e.startsAt)), ['2026-11-07', '2026-11-15', '2026-11-21', '2026-11-29']);
});

test('a daily repeat that began years ago still reaches today', () => {
  const events = parseIcs(cal('UID:old-daily\nDTSTART;TZID=Australia/Melbourne:20190101T070000\nRRULE:FREQ=DAILY\nSUMMARY:Coffee'),
    FROM, '2026-10-27T00:00:00.000Z');
  assert.deepEqual(events.map((e) => melbDay(e.startsAt)), ['2026-10-25', '2026-10-26', '2026-10-27']);
  const weekly = parseIcs(cal('UID:old-weekly\nDTSTART;TZID=Australia/Melbourne:20000105T190000\nRRULE:FREQ=WEEKLY\nSUMMARY:Meeting'),
    FROM, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(weekly.map((e) => melbDay(e.startsAt)), ['2026-10-28'], 'Wednesdays, as it began');
});

test('monthly rules: every Sunday, the last Sunday (BYSETPOS) and a day of the month', () => {
  const every = parseIcs(cal('UID:e1\nDTSTART;TZID=Australia/Melbourne:20261101T090000\nRRULE:FREQ=MONTHLY;BYDAY=SU;COUNT=5\nSUMMARY:x'), FROM, TO);
  assert.deepEqual(every.map((e) => melbDay(e.startsAt)), ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
  const last = parseIcs(cal('UID:e2\nDTSTART;TZID=Australia/Melbourne:20261129T090000\nRRULE:FREQ=MONTHLY;BYDAY=SU;BYSETPOS=-1;COUNT=2\nSUMMARY:x'), FROM, TO);
  assert.deepEqual(last.map((e) => melbDay(e.startsAt)), ['2026-11-29', '2026-12-27']);
  const dated = parseIcs(cal('UID:e3\nDTSTART;TZID=Australia/Melbourne:20261115T190000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1;COUNT=3\nSUMMARY:x'), FROM, TO);
  assert.deepEqual(dated.map((e) => melbDay(e.startsAt)), ['2026-11-15', '2026-11-30', '2026-12-15']);
});

test('a feed that starts with a byte-order mark is still a calendar', () => {
  assert.equal(parseIcs('﻿' + cal('UID:b1\nDTSTART:20261108T000000Z\nSUMMARY:x'), FROM, TO).length, 1);
});

/** The Melbourne date an instant falls on. */
function melbDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date(iso));
}
