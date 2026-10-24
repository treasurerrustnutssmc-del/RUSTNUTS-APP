// Runs the shared who-can-do-what cases (supabase/tests/parity.json) against the demo.
// `npm run test:db` runs the very same cases against the real database rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClubData, Member, MemberStatus, PositionRole } from '../domain/types';
import { runDemoAction, type DemoAction } from './demoActions';

interface Fixture {
  members: { key: string; chapter: string; name: string; status: MemberStatus; approval: Member['approval']; sharePhone: boolean }[];
  positions: { key: string; member: string; chapter: string | null; role: PositionRole; startedOn: string; endedOn: string | null }[];
  bikes: { key: string; member: string; make: string; model: string; year: number }[];
  contacts: { key: string; member: string; name: string; relationship: string; phone: string }[];
  cases: ({ name: string; as: string; allowed: boolean } & Record<string, unknown>)[];
}

const fixture: Fixture = JSON.parse(readFileSync(join(__dirname, '../../supabase/tests/parity.json'), 'utf8'));

function fixtureData(): ClubData {
  return {
    chapters: [
      { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
      { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
    ],
    members: fixture.members.map((m) => ({
      id: m.key,
      chapterId: m.chapter,
      fullName: m.name,
      roadName: null,
      status: m.status,
      approval: m.approval,
      joinedOn: m.approval === 'approved' ? '2024-01-01' : null,
      patchedOn: null,
      fngStartedOn: null,
      bio: null,
      sharePhone: m.sharePhone,
      appliedOn: '2024-01-01',
    })),
    privates: [],
    bikes: fixture.bikes.map((b) => ({
      id: b.key, memberId: b.member, make: b.make, model: b.model, year: b.year, nickname: null, isProject: false,
    })),
    registrations: [],
    emergencyContacts: fixture.contacts.map((c) => ({
      id: c.key, memberId: c.member, name: c.name, relationship: c.relationship, phone: c.phone,
    })),
    positions: fixture.positions.map((p) => ({
      id: p.key, memberId: p.member, chapterId: p.chapter, role: p.role, startedOn: p.startedOn, endedOn: p.endedOn,
    })),
  };
}

test('the shared case list has cases', () => {
  assert.ok(fixture.cases.length >= 30);
});

for (const c of fixture.cases) {
  test(`demo: ${c.name} → ${c.allowed ? 'allowed' : 'refused'}`, () => {
    const data = fixtureData();
    const me = data.members.find((m) => m.id === c.as) ?? null;
    let refusal: string | null = null;
    try {
      runDemoAction({ data, me, today: '2026-10-24' }, c as unknown as DemoAction);
    } catch (e) {
      refusal = (e as Error).message;
    }
    if (c.allowed) assert.equal(refusal, null, `refused: ${refusal}`);
    else assert.notEqual(refusal, null, 'was allowed');
  });
}
