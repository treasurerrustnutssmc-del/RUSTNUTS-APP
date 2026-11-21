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

// Then (same evening): "Swap the ride tools and the calendar tags around": the colour tags sit straight under the calendar.
test('Rides: the calendar first, then the colour filters and legend, then the ride tools', () => {
  const calendar = at('{months.map((g)');
  const tools = at('<Disclosure title={RIDE_TOOLS.title}');
  const newRide = at('title="New ride"');
  const filters = at('accessibilityLabel="Colour buttons"');
  const legend = at('{rideColourLegend()}');
  assert.ok(calendar < filters && filters < legend, 'calendar, then the filters and their legend');
  assert.ok(legend < newRide && legend < tools, 'the ride tools last');
  assert.ok(at('No rides coming up.') < filters, 'the empty calendar note sits where the calendar is');
  assert.match(screen, /Turn on more colours just below/);
});

// Superpowers audit, 21 Nov 2026: under a long calendar the colour buttons need a heading to say what they do.
test('Rides: the colour buttons sit under a "Show rides by colour" heading', () => {
  const heading = at('<SectionTitle title="Show rides by colour"');
  assert.ok(at('{months.map((g)') < heading && heading < at('accessibilityLabel="Colour buttons"'));
});

// Review, 21 Nov 2026: the Next ride card works out the live ride from the same input as the Live ride
// card (the share saved on this phone included), so the two never show the same ride.
test('Home: Next ride and Live ride share one look at the live ride', () => {
  const next = src.slice(src.indexOf('export function HomeNextRideCard'));
  assert.ok(next.includes('useHomeLiveRide()'), 'same hook as the Live ride card');
  assert.ok(!next.slice(0, next.indexOf('return (')).includes('homeLiveRide({'), 'no second, different look');
});

test('a ride that is off or postponed offers no Open live ride on its own screen', () => {
  assert.match(src, /\{!call \? <LiveRideCard ride=\{ride\}/);
});
