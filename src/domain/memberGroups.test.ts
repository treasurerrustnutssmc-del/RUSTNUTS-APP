import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberGroups } from './memberGroups';
import type { Member, MemberStatus } from './types';

const m = (id: string, status: MemberStatus, roadName: string | null = null) =>
  ({ id, status, fullName: id, roadName }) as unknown as Member;

test('members split into Patched, Nomads, FNGs and the rest, Legacy last, names in order', () => {
  const groups = memberGroups([
    m('zed', 'full', 'Zed'), m('kilroy', 'nomad', 'Kilroy'), m('tank', 'legacy', 'Tank'),
    m('amy', 'full', 'Amy'), m('saint', 'fng', 'Saint'), m('foggy', 'supporter', 'Foggy'),
    m('newbie', 'introduced', 'Newbie'), m('kid', 'family', 'Kid'), m('cowboy', 'legacy', 'Cowboy'),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ['Patched', 'Nomads', 'FNGs', 'Hang Arounds', 'Supporters', 'Family', 'Legacy']);
  assert.deepEqual(groups[0].members.map((x) => x.id), ['amy', 'zed']);
  assert.deepEqual(groups[6].members.map((x) => x.id), ['cowboy', 'tank']);
});

test('empty groups are left out', () => {
  const groups = memberGroups([m('a', 'full'), m('b', 'legacy')]);
  assert.deepEqual(groups.map((g) => [g.status, g.members.length]), [['full', 1], ['legacy', 1]]);
});

test('every status has a group, so no member drops out of the list', () => {
  const all: MemberStatus[] = ['introduced', 'fng', 'full', 'nomad', 'supporter', 'family', 'legacy'];
  assert.equal(memberGroups(all.map((s) => m(s, s))).length, all.length);
});
