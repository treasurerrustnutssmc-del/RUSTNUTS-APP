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
