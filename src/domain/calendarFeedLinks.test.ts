import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFeedLinks } from './calendarFeedLinks';

const TOKEN = 'ab'.repeat(32);

test('the calendar link, and the ways into Google, Outlook and Apple', () => {
  const l = calendarFeedLinks('https://abc.supabase.co/', TOKEN);
  assert.equal(l.https, `https://abc.supabase.co/functions/v1/calendar-feed/${TOKEN}.ics`);
  assert.equal(l.webcal, `webcal://abc.supabase.co/functions/v1/calendar-feed/${TOKEN}.ics`);
  assert.equal(l.google, `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(l.webcal)}`);
  assert.equal(
    l.outlook,
    `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(l.https)}&name=${encodeURIComponent('Rustnuts rides')}`,
  );
});

test('no link without a database address or a proper token', () => {
  assert.equal(calendarFeedLinks('', TOKEN), null);
  assert.equal(calendarFeedLinks('https://abc.supabase.co', 'nope'), null);
});
