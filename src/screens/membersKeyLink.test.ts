// The short role names on member chips (SAA, RC, TG...) are deliberate and stay. Members opens with a link to the key, so
// a newcomer is never left guessing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const m = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
const screen = m.slice(m.indexOf('export function MembersScreen'), m.indexOf('// One member'));

test('the Members list links to the Club words key, above the list', () => {
  const link = screen.indexOf("navigation.navigate('ClubWords')");
  assert.ok(link > 0, 'link present');
  assert.ok(link < screen.indexOf('{groups.map('), 'above the member list');
});
