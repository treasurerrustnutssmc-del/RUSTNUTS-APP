import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCalendarToken } from './calendarLinkApi';

function stub(data: unknown, error: { message: string; code?: string } | null = null) {
  const calls: string[] = [];
  const client = { rpc: (fn: string) => (calls.push(fn), Promise.resolve({ data, error })) };
  return { client: client as never, calls };
}

test('the member’s own link token, or a fresh one that stops the old', async () => {
  const token = 'c'.repeat(64);
  const s = stub(token);
  assert.equal(await loadCalendarToken(s.client, false), token);
  assert.equal(await loadCalendarToken(s.client, true), token);
  assert.deepEqual(s.calls, ['my_calendar_link', 'new_calendar_link']);
});

test('before the SQL is live it says so in plain words', async () => {
  await assert.rejects(loadCalendarToken(stub(null, { message: 'Could not find the function', code: 'PGRST202' }).client, false), /isn’t switched on yet/);
});

test('other failures pass through; an odd answer is refused', async () => {
  await assert.rejects(loadCalendarToken(stub(null, { message: 'Only approved members can do that.', code: 'P0001' }).client, false), /approved members/);
  await assert.rejects(loadCalendarToken(stub('nope').client, false), /couldn’t make/);
});
