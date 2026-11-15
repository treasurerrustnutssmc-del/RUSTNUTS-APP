// Board tab, Needs attention: the expiry ("Expires in 19 days") sits on its own line under the
// label, so beside the Due soon or Expired chip on a phone it is never cut short. It is a count or
// a date, so it is set in the stencil (the row meta style, as on the Road Rules sign-off row).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const board = fs.readFileSync(path.resolve(import.meta.dirname, 'board.tsx'), 'utf8');
const row = board.slice(board.indexOf('{alerts.map((a, i) => ('), board.indexOf('{noContact.length > 0 ? ('));

test('each Needs attention row puts the expiry on its own line, never clamped', () => {
  assert.ok(row.length > 0, 'found the Needs attention rows');
  assert.ok(!row.includes('${a.label} · ${a.description}'), 'label and expiry are no longer one clamped string');
  assert.match(row, /<Small numberOfLines=\{2\}>\{a\.label\}<\/Small>/);
  assert.match(row, /<Text style=\{styles\.rowMeta\}>\{a\.description\}<\/Text>/, 'the expiry is in the stencil, never clamped');
  assert.match(board, /rowMeta: \{ fontFamily: fonts\.stencil,/, 'row meta is the stencil');
  assert.match(row, /right=\{<Chip label=\{a\.state === 'expired' \? 'Expired' : 'Due soon'\}/, 'the chip stays');
  assert.match(row, /onPress=\{\(\) => navigation\.navigate\('MemberDetail', \{ memberId: a\.memberId \}\)\}/, 'the press target stays');
});
