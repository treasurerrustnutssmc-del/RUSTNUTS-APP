// "Needs you" and the groups come first on the Board; the menu of areas is folded below them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const board = fs.readFileSync(path.resolve(import.meta.dirname, 'board.tsx'), 'utf8');
const screen = board.slice(board.indexOf('export function BoardScreen'), board.indexOf('export function ManageMemberScreen'));

test('Needs you is first, then the groups, then the folded Board tools', () => {
  const needs = screen.indexOf('<SectionTitle title="Needs you" />');
  const groups = screen.indexOf('{groups.map(');
  const tools = screen.indexOf('<Disclosure title={BOARD_TOOLS.title}');
  assert.ok(needs > 0 && needs < groups && groups < tools);
  assert.ok(screen.indexOf('title="Meetings and votes"') > tools, 'the meetings row is inside the folded tools');
});
