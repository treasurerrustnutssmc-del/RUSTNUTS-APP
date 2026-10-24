// Test-only (not part of the app build). The shared who-can-do-what cases (supabase/tests/parity.json), and the demo's answer to
// each. src/data/parity.test.ts checks the demo; scripts/parity-sql.mts turns the same cases,
// with the demo's exact refusal messages, into SQL that the database must answer identically.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClubData, Member, MemberStatus, PositionRole } from '../domain/types';
import { runDemoAction, type DemoAction } from './demoActions';

export interface ParityCase extends Record<string, unknown> {
  name: string;
  as: string;
  allowed: boolean;
  /** Fixture positions taken away for this case only (to free a seat). */
  without?: string[];
}

export interface ParityFixture {
  chapters: { slug: string; name: string; area: string }[];
  signups?: { key: string }[];
  members: { key: string; chapter: string; name: string; status: MemberStatus; approval: Member['approval']; sharePhone: boolean }[];
  positions: { key: string; member: string; chapter: string | null; role: PositionRole; startedOn: string; endedOn: string | null }[];
  bikes: { key: string; member: string; make: string; model: string; year: number }[];
  contacts: { key: string; member: string; name: string; relationship: string; phone: string }[];
  cases: ParityCase[];
}

export const fixture: ParityFixture = JSON.parse(
  readFileSync(join(__dirname, '../../supabase/tests/parity.json'), 'utf8'),
);

export function fixtureData(without: string[] = []): ClubData {
  return {
    chapters: [
      { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
      { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
      ...fixture.chapters.map((c) => ({ id: c.slug, slug: c.slug, name: c.name, area: c.area, state: 'VIC' })),
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
      onHiatus: false,
    })),
    privates: [],
    bikes: fixture.bikes.map((b) => ({
      id: b.key, memberId: b.member, make: b.make, model: b.model, year: b.year, nickname: null, isProject: false,
    })),
    registrations: [],
    emergencyContacts: fixture.contacts.map((c) => ({
      id: c.key, memberId: c.member, name: c.name, relationship: c.relationship, phone: c.phone,
    })),
    positions: fixture.positions
      .filter((p) => !without.includes(p.key))
      .map((p) => ({ id: p.key, memberId: p.member, chapterId: p.chapter, role: p.role, startedOn: p.startedOn, endedOn: p.endedOn })),
  };
}

/** What the demo says to this case: null when it allows it, otherwise its refusal message. */
export function demoAnswer(c: ParityCase): string | null {
  const data = fixtureData(c.without ?? []);
  const me = data.members.find((m) => m.id === c.as) ?? null;
  try {
    runDemoAction({ data, me, today: '2026-10-24' }, c as unknown as DemoAction);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
