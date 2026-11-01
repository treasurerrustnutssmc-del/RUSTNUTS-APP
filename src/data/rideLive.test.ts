import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveRideArgs, setRideCalledOffArgs } from './rideLive';

test('save_ride gets the cleaned form: trimmed words, empty place and notes as null, the id or null', () => {
  const args = saveRideArgs({
    title: '  Spring run ', startsAt: '2026-11-14T22:00:00.000Z', endsAt: null, allDay: false, category: 'west', location: '  ', notes: ' ', website: true,
  }, null);
  assert.deepEqual(args, {
    p_id: null, p_title: 'Spring run', p_starts_at: '2026-11-14T22:00:00.000Z', p_ends_at: null, p_all_day: false, p_category: 'west',
    p_location: null, p_notes: null, p_website: true,
  });
  const change = saveRideArgs({
    title: 'Spring run', startsAt: '2026-11-14T22:00:00.000Z', endsAt: '2026-11-15T02:00:00.000Z', allDay: false, category: 'club',
    location: 'Bacchus Marsh', notes: 'Bring cash', website: false,
  }, 'r-1');
  assert.equal(change.p_id, 'r-1');
  assert.equal(change.p_ends_at, '2026-11-15T02:00:00.000Z');
  assert.equal(change.p_notes, 'Bring cash');
  assert.equal(change.p_website, false);
});

test('set_ride_called_off gets the ride and the switch', () => {
  assert.deepEqual(setRideCalledOffArgs('r-1', true), { p_id: 'r-1', p_off: true });
});
