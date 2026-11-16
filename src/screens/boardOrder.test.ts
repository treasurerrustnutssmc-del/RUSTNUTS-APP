// "Needs you" is the first thing a board member sees. The menu of areas stays visible right under it, because its
// rows carry live counts the board relies on (treasury approvals, auditor requests, conduct, merch orders).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const board = fs.readFileSync(path.resolve(import.meta.dirname, 'board.tsx'), 'utf8');
const screen = board.slice(board.indexOf('export function BoardScreen'), board.indexOf('export function ManageMemberScreen'));

test('Needs you first, then the menu of areas, then the groups', () => {
  const needs = screen.indexOf('<SectionTitle title="Needs you" />');
  const menu = screen.indexOf('title="Meetings and votes"');
  const groups = screen.indexOf('{groups.map(');
  assert.ok(needs > 0 && needs < menu && menu < groups);
});

test('the menu of areas is never folded away (its counts must stay visible)', () => {
  assert.ok(!screen.includes('BOARD_TOOLS'));
  assert.ok(!/<Disclosure[^>]*Board tools/.test(screen));
});

// Jeff, 15 Nov: the red Needs-you rows must always be tappable and lead to where each gets dealt with.
test('every Needs-you row can be tapped', () => {
  const start = screen.indexOf('attention.map(');
  const row = screen.slice(start, screen.indexOf('</Card>', start));
  assert.match(row, /onPress=\{\(\) => openNeed\(n\)\}/);
  assert.ok(!row.includes('? undefined'), 'no row loses its tap');
});

test('each list a Needs-you row points at is marked so the Board can scroll to it', () => {
  for (const kind of ['alerts', 'noContact', 'fngs']) {
    assert.ok(screen.includes(`mark('${kind}')`), `${kind} list is marked`);
  }
  // Every group is marked too: approvals are decided right inside theirs, and it's the fallback for the rest.
  assert.ok(screen.includes('ref={mark(g.id)}'));
});

test('the Board opens at a Needs-you list when another screen asks for one', () => {
  assert.ok(screen.includes('route.params?.focus'));
});

const home = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
test('the Home board rows open the Board at the matching list, not at its top', () => {
  assert.ok(home.includes("navigation.navigate('Board', { focus: 'pending' })"));
  assert.ok(home.includes("navigation.navigate('Board', { focus: 'alerts' })"));
  assert.ok(!home.includes("navigation.navigate('Board')}"));
});

test('a member page can open at Ride-ready or Emergency contacts', () => {
  assert.ok(home.includes('route.params.focus'));
  assert.ok(home.includes("focusRef('ride-ready')") && home.includes("focusRef('contacts')"));
});
