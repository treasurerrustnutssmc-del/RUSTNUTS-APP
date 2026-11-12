import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

test('the three expiry fields on Me read their date back with its weekday', () => {
  const me = read('src/screens/me.tsx');
  for (const f of ['licence', 'firstAid', 'expiry']) assert.match(me, new RegExp(String.raw`hint=\{dateHintWith\(${f}\.iso`), `${f} field`);
});

test('Home fees uses the compact row rule and keeps the claimed-payment note in it', () => {
  const fees = read('src/screens/fees.tsx');
  assert.match(fees, /feesCardMode\(firstDue, today\) === 'compact'/);
  assert.match(fees, /subtitle=\{compactFeesSubtitle\(firstDue, /);
});

test('the first-run guide asks for the Board line only for board and national levels', () => {
  const card = read('src/ui/FirstRunCard.tsx');
  assert.match(card, /firstRunSteps\(level === 'board' \|\| level === 'national'\)/);
});

test('hints under a field are announced politely as they change', () => {
  assert.match(read('src/ui/primitives.tsx'), /<Small aria-live="polite">\{hint\}<\/Small>/);
});
