// Home puts what needs the member before the news: the next ride, today's check-in, anything expired
// or due, the Road Rules, fees, then club business, then the social cards (shout-outs, on this day, news).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const m = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
const home = m.slice(m.indexOf('export function HomeScreen'), m.indexOf('export function MembersScreen'));
const at = (s: string) => {
  const i = home.indexOf(s);
  assert.ok(i >= 0, `missing ${s}`);
  return i;
};

test('urgent items come before the social cards', () => {
  const urgent = [at('<HomeNextRideCard'), at('<HomeCheckinCard'), at('{myAlerts.map'), at('<HomeRoadRulesRow'), at('<HomeFeesCard')];
  assert.deepEqual([...urgent].sort((a, b) => a - b), urgent, 'next ride, check-in, alerts, Road Rules, fees in that order');
  const social = Math.min(at('<HomeShoutoutsCard'), at('<HomeOnThisDayCard'), at('<HomeNewsCard'));
  assert.ok(Math.max(...urgent) < social, 'all of them before shout-outs, on this day and news');
  assert.ok(at('{business.summary') < social, 'club business before the social cards too');
});
