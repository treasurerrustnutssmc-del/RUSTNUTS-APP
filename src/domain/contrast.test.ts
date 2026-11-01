import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { contrastRatio, pickReadable } from './contrast';

// src/theme.ts imports react-native, which plain Node can't load, so the palette is read from its text.
const themeSource = readFileSync(join(__dirname, '../theme.ts'), 'utf8');
const colorsBlock = themeSource.split('export const colors')[1].split('} as const')[0];
const palette: Record<string, string> = {};
for (const [, name, hex] of colorsBlock.matchAll(/^\s*(\w+):\s*'(#[0-9a-fA-F]{6})'/gm)) palette[name] = hex;

test('contrast ratio: black on white is 21, the same colour is 1, and order does not matter', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(contrastRatio('#8C1C24', '#8C1C24'), 1);
  assert.equal(contrastRatio('#111010', '#F4F1EA'), contrastRatio('#F4F1EA', '#111010'));
});

test('the palette is read from theme.ts', () => {
  for (const name of ['ink', 'ink2', 'steel', 'steelHi', 'bone', 'boneDim', 'boneMute', 'redText']) {
    assert.ok(palette[name], `${name} should be in theme.ts`);
  }
});

test('every text colour passes 4.5:1 on the surfaces it is used on', () => {
  const pairs: Array<[text: string, surface: string]> = [
    ['bone', 'ink'], ['bone', 'ink2'], ['bone', 'steel'], ['bone', 'steelHi'],
    ['boneDim', 'ink'], ['boneDim', 'ink2'], ['boneDim', 'steel'], ['boneDim', 'steelHi'],
    ['boneMute', 'ink'], ['boneMute', 'ink2'], ['boneMute', 'steel'],
    ['redText', 'ink'], ['redText', 'ink2'], ['redText', 'steel'],
  ];
  for (const [text, surface] of pairs) {
    const ratio = contrastRatio(palette[text], palette[surface]);
    assert.ok(ratio >= 4.5, `${text} on ${surface} is ${ratio.toFixed(2)}:1`);
  }
});

test('muted bone text is too faint on steelHi, the colour of your own chat bubble', () => {
  assert.ok(contrastRatio(palette.boneMute, palette.steelHi) < 4.5);
});

test('pickReadable keeps the muted colour where it passes and steps up where it does not', () => {
  const candidates = [palette.boneMute, palette.boneDim];
  assert.equal(pickReadable(candidates, palette.ink2), palette.boneMute);
  assert.equal(pickReadable(candidates, palette.steel), palette.boneMute);
  assert.equal(pickReadable(candidates, palette.steelHi), palette.boneDim, 'your chat bubble is steelHi');
});

test('pickReadable falls back to the best of a bad lot, and refuses an empty list', () => {
  const faint = ['#2a2a2c', '#353437'];
  assert.equal(pickReadable(faint, '#2a2a2c'), '#353437');
  assert.throws(() => pickReadable([], '#111010'));
});
