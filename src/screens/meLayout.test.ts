// Sign out and Delete my account sat on top of each other at the foot of Me, which invites a mis-tap.
// Delete now lives in the Notifications and privacy group, away from Sign out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const me = fs.readFileSync(path.resolve(import.meta.dirname, 'me.tsx'), 'utf8');
const screen = me.slice(me.indexOf('export function MeScreen'), me.indexOf('function RoadRulesRow'));

test('Delete my account is inside the settings group, not beside Sign out', () => {
  const settings = screen.indexOf("g.id === 'settings'");
  const help = screen.indexOf("g.id === 'help'");
  const del = screen.indexOf('Delete my account');
  assert.ok(del > settings && del < help, 'Delete my account sits in the settings group');
  const signOut = screen.indexOf('label="Sign out"');
  assert.ok(signOut > help, 'Sign out stays at the foot');
  assert.ok(signOut - del > 400, 'the two are not neighbours');
});
