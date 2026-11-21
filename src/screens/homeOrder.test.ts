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

test('Needs you is the first card under the greeting', () => {
  const needs = at('<HomeNeedsYouCard');
  for (const s of ['<CoverPanels', '<FirstRunCard', '<HomeNextRideCard', '<HomeCheckinCard', '<HomeQuickActions', '<HomeRoadRulesRow']) {
    assert.ok(needs < at(s), `Needs you before ${s}`);
  }
  assert.ok(at('</Flannel>') < needs, 'after the greeting');
});

test('check-in, the ride and quick buttons come before the social cards', () => {
  // On the day, I'm here and Confirm sit above the next ride (PR #192).
  const urgent = [at('<HomeCheckinCard'), at('<HomeNextRideCard'), at('<HomeQuickActions')];
  assert.deepEqual([...urgent].sort((a, b) => a - b), urgent);
  const social = Math.min(at('<HomeShoutoutsCard'), at('<HomeOnThisDayCard'), at('<HomeNewsCard'));
  assert.ok(Math.max(...urgent) < social);
  assert.ok(at('{business.summary') < social, 'club business before the social cards too');
});

test('rego, licence and first aid reminders sit at the bottom, after everything else', () => {
  const reminders = at('<HomeReminders');
  for (const s of ['<HomeNewsCard', '<AskClubHomeRow', '<Disclosure title={CLUB_NUMBERS.title}']) {
    assert.ok(at(s) < reminders, `${s} before the reminders`);
  }
  assert.ok(!home.includes('{myAlerts.map'), 'no expiry boxes higher up');
});

test('fees and applicants are not shown twice: they live in Needs you', () => {
  assert.ok(!home.includes('<HomeFeesCard'), 'fees owing is a Needs you row');
  assert.ok(!home.includes('waiting for approval`'), 'applicants are a Needs you row');
});
