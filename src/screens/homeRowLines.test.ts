// Home, small phones: at 360 wide the Board card's renewals title ("4 rego, licence or first aid
// renewals need attention") and the Club business summary ("1 vote needs you · Next meeting
// Wed 25/11 · Minutes due for 1 meeting") each need a third line, and more with a larger text
// size or a longer summary. ListRow clamps its text to two lines, so those two rows ask never to be
// cut short. Every other row keeps two.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const home = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
const ui = fs.readFileSync(path.resolve(import.meta.dirname, '../ui/primitives.tsx'), 'utf8');

/** The ListRow element whose source contains `marker`: from its `<ListRow` to the next row or card end. */
function rowWith(marker: string): string {
  const at = home.indexOf(marker);
  assert.notEqual(at, -1, `found ${marker}`);
  assert.equal(home.indexOf(marker, at + 1), -1, `${marker} appears once`);
  const start = home.lastIndexOf('<ListRow', at);
  assert.notEqual(start, -1, `found the ListRow around ${marker}`);
  const ends = [home.indexOf('<ListRow', at), home.indexOf('</Card>', at)].filter((i) => i !== -1);
  assert.ok(ends.length > 0, `found where the row around ${marker} ends`);
  return home.slice(start, Math.min(...ends));
}

test('ListRow clamps title and subtitle to its lines prop, two by default, and never with all', () => {
  const listRow = ui.slice(ui.indexOf('export function ListRow('), ui.indexOf('// Messages'));
  assert.match(listRow, /lines = 2,/, 'two lines unless a row asks for more');
  assert.match(listRow, /lines\?: number \| 'all';/);
  assert.match(listRow, /const clamp = lines === 'all' \? undefined : lines;/, 'all sets no limit');
  assert.match(listRow, /<Text numberOfLines=\{clamp\} style=\{type\.name\}>\{title\}<\/Text>/);
  assert.match(listRow, /<Small numberOfLines=\{clamp\}>\{subtitle\}<\/Small>/);
  assert.doesNotMatch(listRow, /numberOfLines=\{2\}/, 'no fixed two-line clamp left');
});

test('the Home Board renewals row shows its whole title on a small phone', () => {
  assert.match(rowWith("'rego, licence or first aid renewals need'"), /\blines="all"/);
});

test('the Home Club business row shows its whole summary on a small phone', () => {
  assert.match(rowWith('title="Club business"'), /\blines="all"/);
});

test('only those two Home rows lift the limit', () => {
  assert.equal(home.match(/\blines="all"/g)?.length, 2);
  assert.equal(home.match(/\blines=/g)?.length, 2, 'no other Home row changes its line limit');
});
