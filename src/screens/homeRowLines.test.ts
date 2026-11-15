// Home, small phones: at 360 wide the Board card's renewals title ("4 rego, licence or first aid
// renewals need attention") and the Club business summary ("1 vote needs you · Next meeting
// Wed 25/11 · Minutes due for 1 meeting") each need a third line. ListRow clamps its text to two
// lines, so those two rows ask for three and show in full. Every other row keeps two.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const home = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
const ui = fs.readFileSync(path.resolve(import.meta.dirname, '../ui/primitives.tsx'), 'utf8');

/** The ListRow element (from `<ListRow` to its closing `/>`) whose source contains `marker`. */
function rowWith(marker: string): string {
  const at = home.indexOf(marker);
  assert.ok(at > 0, `found ${marker}`);
  const start = home.lastIndexOf('<ListRow', at);
  const end = home.indexOf('/>', at);
  assert.ok(start > 0 && end > at, `found the ListRow around ${marker}`);
  return home.slice(start, end);
}

test('ListRow clamps title and subtitle to its lines prop, two by default', () => {
  const listRow = ui.slice(ui.indexOf('export function ListRow('), ui.indexOf('// Messages'));
  assert.match(listRow, /lines = 2,/, 'two lines unless a row asks for more');
  assert.match(listRow, /lines\?: number;/);
  assert.match(listRow, /<Text numberOfLines=\{lines\} style=\{type\.name\}>\{title\}<\/Text>/);
  assert.match(listRow, /<Small numberOfLines=\{lines\}>\{subtitle\}<\/Small>/);
  assert.doesNotMatch(listRow, /numberOfLines=\{2\}/, 'no fixed two-line clamp left');
});

test('the Home Board renewals row shows its whole title at 360 wide', () => {
  const row = rowWith("'rego, licence or first aid renewals need'");
  assert.match(row, /\blines=\{3\}/);
});

test('the Home Club business row shows its whole summary at 360 wide', () => {
  const row = rowWith('title="Club business"');
  assert.match(row, /\blines=\{3\}/);
});
