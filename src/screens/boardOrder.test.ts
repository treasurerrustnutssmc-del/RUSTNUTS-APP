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
