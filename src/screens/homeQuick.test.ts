// Jeff, 21 Nov 2026: "im still not seeing where a none board member would see the finances". Club
// finances (Treasurer's Reports and Club spending) is a quick button on Home for every member who can read them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const cards = fs.readFileSync(path.resolve(import.meta.dirname, 'homeCards.tsx'), 'utf8');

test('Home has a Finances quick button that opens Club finances, for members who can read the reports', () => {
  assert.match(cards, /label: 'Finances', screen: 'ClubFinances'/);
  assert.match(cards, /seesReports\(me\)/, 'only members who can read the reports (not Family or Legacy)');
});
