import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncAllFeeds, syncWindow } from '../../supabase/functions/_shared/syncRides';

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:a@x', 'DTSTART;TZID=Australia/Melbourne:20261108T083000', 'SUMMARY:North: Coffee', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@x', 'DTSTART;TZID=Australia/Melbourne:20261115T083000', 'SUMMARY:Day ride', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const NOW = new Date('2026-10-24T11:00:00.000Z'); // 10 pm, 24 Oct in Melbourne

test('the window runs from the start of today in Melbourne to a year ahead', () => {
  assert.deepEqual(syncWindow(NOW), { from: '2026-10-23T13:00:00.000Z', to: '2027-10-23T13:00:00.000Z' });
});

test('each good feed is applied with coloured rides; a failing one is recorded and cancels nothing', async () => {
  const applied: { feedId: string; events: { uid: string; category: string }[] }[] = [];
  const errors: [string, string][] = [];
  const result = await syncAllFeeds({
    feeds: [
      { id: 'f-mixed', url: 'https://example.com/mixed.ics', category: null },
      { id: 'f-down', url: 'https://example.com/down.ics', category: 'west' },
      { id: 'f-html', url: 'https://example.com/login', category: 'west' },
    ],
    fetchText: async (url) => {
      if (url.endsWith('down.ics')) throw new Error('fetch failed: 503');
      if (url.endsWith('login')) return '<!doctype html><p>Sign in</p>';
      return ICS;
    },
    apply: async (feedId, events) => {
      applied.push({ feedId, events: events as { uid: string; category: string }[] });
    },
    recordError: async (feedId, message) => {
      errors.push([feedId, message]);
    },
    now: NOW,
  });
  assert.deepEqual(result, { ok: 1, failed: 2 });
  assert.equal(applied.length, 1, 'only the good feed is applied');
  assert.equal(applied[0].feedId, 'f-mixed');
  assert.deepEqual(applied[0].events.map((e) => [e.uid, e.category]), [['a@x', 'north'], ['b@x', 'club']]);
  assert.deepEqual(errors, [['f-down', 'fetch failed: 503'], ['f-html', 'Not a calendar']]);
});

test('if recording an error fails too, the other feeds still sync', async () => {
  const applied: string[] = [];
  const result = await syncAllFeeds({
    feeds: [
      { id: 'f-down', url: 'https://example.com/down.ics', category: 'west' },
      { id: 'f-ok', url: 'https://example.com/ok.ics', category: 'north' },
    ],
    fetchText: async (url) => {
      if (url.endsWith('down.ics')) throw new Error('fetch failed: 503');
      return ICS;
    },
    apply: async (feedId) => {
      applied.push(feedId);
    },
    recordError: async () => {
      throw new Error('database unreachable');
    },
    now: NOW,
  });
  assert.deepEqual(result, { ok: 1, failed: 1 });
  assert.deepEqual(applied, ['f-ok']);
});
