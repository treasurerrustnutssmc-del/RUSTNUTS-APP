// Jeff, 21 Nov 2026: "Move the calender stuff to the top of the ride page, followed by ride tools,
// move the stuff in the image below the ride calender" (the colour filters and their legend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const src = fs.readFileSync(path.resolve(import.meta.dirname, 'rides.tsx'), 'utf8');
const screen = src.slice(src.indexOf('export function RidesScreen'), src.indexOf('export function HomeNextRideCard'));
const at = (s: string) => {
  const i = screen.indexOf(s);
  assert.ok(i >= 0, `missing ${s}`);
  return i;
};

test('Rides: the calendar first, then the ride tools, then the colour filters and legend', () => {
  const calendar = at('{months.map((g)');
  const tools = at('<Disclosure title={RIDE_TOOLS.title}');
  const newRide = at('title="New ride"');
  const filters = at('accessibilityLabel="Show rides by colour"');
  const legend = at('{rideColourLegend()}');
  assert.ok(calendar < newRide && calendar < tools, 'calendar before the tools');
  assert.ok(tools < filters && filters < legend, 'tools, then the filters and their legend');
  assert.ok(at('No rides coming up.') < tools, 'the empty calendar note sits where the calendar is');
  assert.match(screen, /Turn on more colours below/);
});
