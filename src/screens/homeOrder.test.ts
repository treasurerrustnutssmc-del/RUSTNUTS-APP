// Home leads with what needs the person (Jeff, 21 Nov 2026: "Approvals top regos bottom"): the
// Needs you card first, then today's check-in, the next ride and the quick buttons, then club
// business, the Road Rules and the social cards, and the rego, licence and first aid reminders last.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const m = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
const home = m.slice(m.indexOf('export function HomeScreen'), m.indexOf('export function MembersScreen'));
const at = (s: string) => {
  const i = home.indexOf(s);
  assert.ok(i >= 0, `missing ${s}`);
  return i;
};

test('Needs you comes before every other card but a live ride', () => {
  const needs = at('<HomeNeedsYouCard');
  for (const s of ['<CoverPanels', '<FirstRunCard', '<HomeNextRideCard', '<HomeCheckinCard']) {
    assert.ok(needs < at(s), `Needs you before ${s}`);
  }
  assert.ok(at('</Flannel>') < needs, 'after the greeting');
});

test('check-in and the ride come before the social cards', () => {
  // On the day, I'm here and Confirm sit above the next ride (PR #192).
  const urgent = [at('<HomeCheckinCard'), at('<HomeNextRideCard')];
  assert.deepEqual([...urgent].sort((a, b) => a - b), urgent);
  const social = Math.min(at('<HomeShoutoutsCard'), at('<HomeOnThisDayCard'), at('<HomeNewsCard'));
  assert.ok(Math.max(...urgent) < social);
});

test('rego, licence and first aid reminders sit at the bottom, after everything else', () => {
  const reminders = at('<HomeReminders');
  for (const s of ['<HomeNewsCard', '<HomeNextRideCard']) {
    assert.ok(at(s) < reminders, `${s} before the reminders`);
  }
  assert.ok(!home.includes('{myAlerts.map'), 'no expiry boxes higher up');
});

test('fees and applicants are not shown twice: they live in Needs you', () => {
  assert.ok(!home.includes('<HomeFeesCard'), 'fees owing is a Needs you row');
  assert.ok(!home.includes('waiting for approval`'), 'applicants are a Needs you row');
});

test('a live ride sits straight under the greeting, above Needs you (Jeff, 21 Nov 2026)', () => {
  const live = at('<HomeLiveRideCard');
  assert.ok(at('</Flannel>') < live, 'after the greeting');
  assert.ok(live < at('<HomeNeedsYouCard'), 'before Needs you');
});

// Jeff, 21 Nov 2026: "Make the home screen clean and simple." The one-row cards (Road Rules, Club
// business, Ask the club) became quick buttons, and the club numbers moved to the Members tab.
const cards = fs.readFileSync(path.resolve(import.meta.dirname, 'homeCards.tsx'), 'utf8');

test('clean Home: no one-row cards for the Road Rules, Club business or Ask the club, and no numbers table', () => {
  for (const gone of ['<HomeRoadRulesRow', 'title="Club business"', '<AskClubHomeRow', 'CLUB_NUMBERS', '<ClubSplitTable']) {
    assert.ok(!home.includes(gone), `${gone} is off Home`);
  }
});

// Jeff, 21 Nov 2026 (photo of the quick buttons, Road Rules and Club business): "Move this to the me page".
const meSrc = fs.readFileSync(path.resolve(import.meta.dirname, 'me.tsx'), 'utf8');
const meScreen = meSrc.slice(meSrc.indexOf('export function MeScreen'));

test('the quick buttons live on Me now, not Home', () => {
  assert.ok(!home.includes('QuickButtons'), 'off Home');
  assert.ok(meScreen.includes('<QuickButtons'), 'on Me');
  assert.match(cards, /label: 'Road Rules'/);
  assert.match(cards, /label: 'Ask the club', screen: 'AskClub'/);
  for (const label of ['My fees', 'Finances', 'Rusty Bus', 'Documents', 'Tell us']) assert.ok(cards.includes(`label: '${label}'`), label);
});

test('Club business, with its summary, sits under the quick buttons on Me', () => {
  const quick = meScreen.indexOf('<QuickButtons');
  const business = meScreen.indexOf('title="Club business"');
  assert.ok(quick >= 0 && business > quick, 'under the quick buttons');
  assert.match(meScreen, /businessFor\(/);
});

test('the club in numbers lives on the Members tab now', () => {
  const members = m.slice(m.indexOf('export function MembersScreen'));
  assert.ok(members.includes('CLUB_NUMBERS.title'));
  assert.ok(members.includes('<ClubSplitTable'));
});

test('the next ride card steps aside while that ride is the live ride above it', () => {
  const rides = fs.readFileSync(path.resolve(import.meta.dirname, 'rides.tsx'), 'utf8');
  const next = rides.slice(rides.indexOf('export function HomeNextRideCard'));
  assert.match(next.slice(0, 1500), /homeLiveRide\(/);
});

// Review, 21 Nov 2026: the Documents row on Me used to say "N to sign"; with it gone, the button says it.
test('the Documents quick button says how many club documents are waiting for your signature', () => {
  assert.match(cards, /signStatus\(me, d, data, today\) === 'unsigned'/);
  assert.match(cards, /to sign`/);
});
