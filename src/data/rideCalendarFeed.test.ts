import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, feedPath, handleCalendarFeed, tokenFromPath, type FeedRide } from '../../supabase/functions/_shared/rideCalendarFeed';

const NOW = '2026-11-28T01:00:00.000Z';
const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);

const ride = (over: Partial<FeedRide> = {}): FeedRide => ({
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Breakfast run',
  starts_at: '2026-12-05T21:30:00.000Z', // 8:30 am Sun 6 Dec in Melbourne
  ends_at: '2026-12-06T02:00:00.000Z',
  all_day: false,
  location: 'Maccas, Bacchus Marsh',
  notes: null,
  cancelled_at: null,
  leg_no: null,
  leg_count: null,
  ...over,
});

/** The calendar unfolded, one property per line. */
const lines = (cal: string) => cal.replace(/\r\n /g, '').split('\r\n');

test('a calendar with one timed ride, in UTC, with a stable UID', () => {
  const cal = buildCalendar([ride()], NOW);
  assert.ok(cal.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(cal.endsWith('END:VCALENDAR\r\n'));
  const l = lines(cal);
  assert.ok(l.includes('X-WR-CALNAME:Rustnuts rides'));
  assert.ok(l.includes('REFRESH-INTERVAL;VALUE=DURATION:PT1H'));
  assert.ok(l.includes('UID:11111111-2222-3333-4444-555555555555@rustnutssmc.com.au'));
  assert.ok(l.includes('DTSTART:20261205T213000Z'));
  assert.ok(l.includes('DTEND:20261206T020000Z'));
  assert.ok(l.includes('DTSTAMP:20261128T010000Z'));
  assert.ok(l.includes('SUMMARY:Breakfast run'));
  assert.ok(l.includes('LOCATION:Maccas\\, Bacchus Marsh'));
  assert.ok(l.includes('STATUS:CONFIRMED'));
});

test('a timed ride with no finish gets four hours', () => {
  const l = lines(buildCalendar([ride({ ends_at: null })], NOW));
  assert.ok(l.includes('DTEND:20261206T013000Z'));
});

test('an all-day ride uses Melbourne dates, with the day after the last as the end', () => {
  // Big 4: Melbourne midnight Sat 21 Nov to Melbourne midnight Mon 23 Nov (two days).
  const l = lines(buildCalendar([ride({ all_day: true, starts_at: '2026-11-20T13:00:00.000Z', ends_at: '2026-11-22T13:00:00.000Z' })], NOW));
  assert.ok(l.includes('DTSTART;VALUE=DATE:20261121'));
  assert.ok(l.includes('DTEND;VALUE=DATE:20261123'));
  const one = lines(buildCalendar([ride({ all_day: true, starts_at: '2026-11-20T13:00:00.000Z', ends_at: null })], NOW));
  assert.ok(one.includes('DTSTART;VALUE=DATE:20261121'));
  assert.ok(one.includes('DTEND;VALUE=DATE:20261122'));
});

test('a called-off ride stays in view, titled CALLED OFF and not keeping you busy', () => {
  const l = lines(buildCalendar([ride({ cancelled_at: '2026-12-01T00:00:00.000Z' })], NOW));
  assert.ok(l.includes('SUMMARY:CALLED OFF: Breakfast run'));
  // Google and Outlook hide STATUS:CANCELLED entries in subscribed calendars, so it isn't sent.
  assert.ok(!l.some((x) => x.startsWith('STATUS:')));
  assert.ok(l.includes('TRANSP:TRANSPARENT'));
  assert.ok(lines(buildCalendar([ride()], NOW)).includes('TRANSP:OPAQUE'));
});

test('stray carriage returns and control characters never reach the file', () => {
  const l = lines(buildCalendar([ride({ notes: 'one\rtwo\r\nthree\u0007\u0000four' })], NOW));
  assert.equal(l.find((x) => x.startsWith('DESCRIPTION:')), 'DESCRIPTION:one\\ntwo\\nthreefour\\n\\nFrom the Rustnuts app');
  assert.ok(!buildCalendar([ride({ notes: 'a\rb' })], NOW).replace(/\r\n/g, '').includes('\r'));
});

test('an all-day ride whose end is not after its start is one day', () => {
  const l = lines(buildCalendar([ride({ all_day: true, starts_at: '2026-11-20T13:00:00.000Z', ends_at: '2026-11-20T13:00:00.000Z' })], NOW));
  assert.ok(l.includes('DTSTART;VALUE=DATE:20261121'));
  assert.ok(l.includes('DTEND;VALUE=DATE:20261122'));
});

test('the path after the function name, however Supabase hands it over', () => {
  assert.equal(feedPath(`/calendar-feed/${TOKEN}.ics`), `/${TOKEN}.ics`);
  assert.equal(feedPath(`/functions/v1/calendar-feed/${TOKEN}.ics`), `/${TOKEN}.ics`);
  assert.equal(feedPath('/calendar-feed'), '/');
  assert.equal(tokenFromPath(feedPath(`/calendar-feed/${TOKEN}.ics`)), TOKEN);
});

test('notes carry the leg, the members-only notes and where it came from, escaped', () => {
  const l = lines(buildCalendar([ride({ notes: 'Fuel first; bring cash\nKSU 8:15', leg_no: 2, leg_count: 3 })], NOW));
  const d = l.find((x) => x.startsWith('DESCRIPTION:'));
  assert.equal(d, 'DESCRIPTION:Leg 2 of 3\\n\\nFuel first\\; bring cash\\nKSU 8:15\\n\\nFrom the Rustnuts app');
});

test('long lines fold at 75 octets without splitting a character', () => {
  const cal = buildCalendar([ride({ title: 'Rusty’s '.repeat(20) })], NOW);
  for (const raw of cal.split('\r\n')) assert.ok(new TextEncoder().encode(raw).length <= 75, raw);
  assert.ok(lines(cal).includes(`SUMMARY:${'Rusty’s '.repeat(20).trim()}`));
});

test('no rides is still a calendar', () => {
  const cal = buildCalendar([], NOW);
  assert.ok(cal.includes('BEGIN:VCALENDAR') && !cal.includes('BEGIN:VEVENT'));
});

test('the token comes from /<token>.ics, and nothing else passes', () => {
  assert.equal(tokenFromPath(`/${TOKEN}.ics`), TOKEN);
  assert.equal(tokenFromPath(`/${TOKEN}`), TOKEN);
  assert.equal(tokenFromPath('/short.ics'), null);
  assert.equal(tokenFromPath(`/${TOKEN.toUpperCase()}.ics`), null);
  assert.equal(tokenFromPath(`/x/${TOKEN}.ics`), null);
  assert.equal(tokenFromPath('/'), null);
});

test('the door: GET with a known token gives text/calendar, never cached by others', async () => {
  const asked: string[] = [];
  const out = await handleCalendarFeed({ method: 'GET', path: `/${TOKEN}.ics` }, { feed: async (t) => (asked.push(t), [ride()]) }, NOW);
  assert.equal(out.status, 200);
  assert.deepEqual(asked, [TOKEN]);
  assert.equal(out.headers['content-type'], 'text/calendar; charset=utf-8');
  assert.equal(out.headers['cache-control'], 'private, max-age=900');
  assert.ok(out.body.includes('SUMMARY:Breakfast run'));
});

test('the door: unknown token 404, bad path 404 without asking, other methods 405, failures 500', async () => {
  let asked = 0;
  const deps = { feed: async () => (asked++, null) };
  assert.equal((await handleCalendarFeed({ method: 'GET', path: `/${TOKEN}.ics` }, deps, NOW)).status, 404);
  assert.equal(asked, 1);
  assert.equal((await handleCalendarFeed({ method: 'GET', path: '/nope' }, deps, NOW)).status, 404);
  assert.equal(asked, 1);
  assert.equal((await handleCalendarFeed({ method: 'POST', path: `/${TOKEN}.ics` }, deps, NOW)).status, 405);
  const boom = await handleCalendarFeed({ method: 'GET', path: `/${TOKEN}.ics` }, { feed: async () => { throw new Error('db down'); } }, NOW);
  assert.equal(boom.status, 500);
  assert.ok(!boom.body.includes('db down'));
});

test('HEAD answers like GET without a body', async () => {
  const out = await handleCalendarFeed({ method: 'HEAD', path: `/${TOKEN}.ics` }, { feed: async () => [ride()] }, NOW);
  assert.equal(out.status, 200);
  assert.equal(out.body, '');
});
