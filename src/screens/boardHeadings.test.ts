// Jeff, 21 Nov 2026: "too many things hidden behind heading that dont relate to what the heading states".
// On the Board, each row lives under the heading it belongs to.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const board = fs.readFileSync(path.resolve(import.meta.dirname, 'board.tsx'), 'utf8');
const group = (id: string) => {
  const at = board.indexOf(`{g.id === '${id}' ?`);
  assert.ok(at >= 0, `group ${id}`);
  const next = board.indexOf('{g.id === ', at + 10);
  return board.slice(at, next === -1 ? board.indexOf('</Disclosure>', at) : next);
};

test('Meetings and votes is in the Meetings group', () => assert.ok(group('meetings').includes("navigate('Business')")));
test('the books are in the Money group', () => assert.ok(group('money').includes('<TreasuryRow')));
test('Road Rules sign-off is in the People group', () => assert.ok(group('people').includes("navigate('RoadRulesSignoffs')")));
