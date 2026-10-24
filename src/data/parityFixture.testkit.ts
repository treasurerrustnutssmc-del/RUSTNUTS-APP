// Test-only (not part of the app build). The shared who-can-do-what cases (supabase/tests/parity.json), and the demo's answer to
// each. src/data/parity.test.ts checks the demo; scripts/parity-sql.mts turns the same cases,
// with the demo's exact refusal messages, into SQL that the database must answer identically.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGpx } from '../domain/gpx';
import type { ClubData, CrewRole, Member, MemberStatus, PositionRole, RideCategory, Route, RsvpAnswer } from '../domain/types';
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
  members: {
    key: string; chapter: string; name: string; status: MemberStatus; approval: Member['approval']; sharePhone: boolean;
    /** On hiatus (crew checks). */
    onHiatus?: boolean;
    /** When present, the member gets a private record with this first aid date (null: none on file). */
    firstAidExpiry?: string | null;
  }[];
  positions: { key: string; member: string; chapter: string | null; role: PositionRole; startedOn: string; endedOn: string | null }[];
  bikes: { key: string; member: string; make: string; model: string; year: number }[];
  contacts: { key: string; member: string; name: string; relationship: string; phone: string }[];
  rides: { key: string; title: string; startsAt: string; category: RideCategory; cancelled: boolean }[];
  /** Who is already crewing which ride. */
  crew?: { ride: string; member: string; role: CrewRole }[];
  /** Answers already given. */
  rsvps?: { ride: string; member: string; answer: RsvpAnswer }[];
  /**
   * GPX files by name. A saveRoute case names one in `file` (null: no file). Use only files the
   * app's reader and Postgres judge alike: valid, or clearly malformed.
   */
  gpxFiles?: Record<string, string>;
  /** The route library. Every route's file is gpxFiles.valid. */
  routes?: { key: string; name: string; chapter: string | null; archived: boolean }[];
  /** Which route each ride uses. */
  rideRoutes?: { ride: string; route: string }[];
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
      onHiatus: m.onHiatus ?? false,
    })),
    privates: fixture.members
      .filter((m) => m.firstAidExpiry !== undefined)
      .map((m) => ({
        memberId: m.key, email: null, phone: null, licenceClass: null, licenceExpiry: null,
        firstAidExpiry: m.firstAidExpiry ?? null, introducedBy: null, applicationNote: null,
      })),
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
    rides: fixture.rides.map((r) => ({
      id: r.key, title: r.title, startsAt: r.startsAt, endsAt: null, allDay: false, location: null, notes: null,
      category: r.category, cancelledAt: r.cancelled ? '2026-01-01T00:00:00.000Z' : null,
    })),
    rsvps: (fixture.rsvps ?? []).map((r) => ({
      rideId: r.ride, memberId: r.member, answer: r.answer, updatedAt: '2026-10-01T00:00:00.000Z',
    })),
    crew: (fixture.crew ?? []).map((k) => ({
      rideId: k.ride, memberId: k.member, role: k.role, assignedBy: null, assignedAt: '2026-10-01T00:00:00.000Z',
    })),
    routes: fixtureRoutes(),
    rideRoutes: (fixture.rideRoutes ?? []).map((r) => ({ rideId: r.ride, routeId: r.route })),
  };
}

/** The fixture's valid GPX file, which every fixture route is made from. */
export function fixtureGpx(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const text = fixture.gpxFiles?.[name];
  if (text === undefined) throw new Error(`No GPX file "${name}" in parity.json`);
  return text;
}

function fixtureRoutes(): Route[] {
  const summary = readGpx(fixtureGpx('valid') ?? '');
  if (typeof summary === 'string') throw new Error(`parity.json's valid GPX file: ${summary}`);
  const { name: _fileName, ...shape } = summary; // each route keeps its own name
  return (fixture.routes ?? []).map((r) => ({
    id: r.key, name: r.name, chapterId: r.chapter, notes: '', ...shape,
    archivedAt: r.archived ? '2026-01-01T00:00:00.000Z' : null, updatedAt: '2026-01-01T00:00:00.000Z',
  }));
}

/** The case as the demo action it names: a saveRoute case's `file` becomes the file's text. */
export function caseAction(c: ParityCase): DemoAction {
  if (c.action === 'saveRoute') return { ...(c as unknown as DemoAction), gpx: fixtureGpx(c.file as string | null) } as DemoAction;
  return c as unknown as DemoAction;
}

/** What the demo says to this case: null when it allows it, otherwise its refusal message. */
export function demoAnswer(c: ParityCase): string | null {
  const data = fixtureData(c.without ?? []);
  const me = data.members.find((m) => m.id === c.as) ?? null;
  try {
    runDemoAction({ data, me, today: '2026-10-24' }, caseAction(c));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
