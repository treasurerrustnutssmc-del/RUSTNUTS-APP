// Test-only (not part of the app build). The shared who-can-do-what cases (supabase/tests/parity.json), and the demo's answer to
// each. src/data/parity.test.ts checks the demo; scripts/parity-sql.mts turns the same cases,
// with the demo's exact refusal messages, into SQL that the database must answer identically.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ChargeKind, CheckinKind, ClubData, CrewRole, Member, MemberStatus, PaymentState, PositionRole, RideCategory, RsvpAnswer,
} from '../domain/types';
import { runDemoAction, type DemoAction } from './demoActions';
// Stage 4
import { addDays } from '../domain/dates';
import { fyOf } from '../domain/fees';
import { addMonths } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { runStage4Action, STAGE4_ACTIONS, type Stage4Action } from './demoStage4';

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
  cases: ParityCase[];
  stage4?: Stage4Fixture;
}

/** Stage 4's part of the fixture. Dates are days (or months, for FNG starts) from today. */
export interface Stage4Fixture {
  members: { key: string; chapter: string; name: string; status: MemberStatus; approval: Member['approval']; fngStartMonths?: number }[];
  positions: { key: string; member: string; chapter: string | null; role: PositionRole }[];
  rides: { key: string; title: string; startsAt: string; category: RideCategory; cancelled: boolean }[];
  sessions: { key: string; kind: CheckinKind; chapter: string | null; ride: string | null; title: string; heldOnDays: number; code: string; closed: boolean }[];
  attendance: { session: string; member: string }[];
  rates: { chapter: string; fyOffset: number; status: MemberStatus; amountCents: number; dueOnDays: number }[];
  charges: { key: string; member: string; chapter: string; kind: ChargeKind; amountCents: number; dueOnDays: number; waived: boolean }[];
  payments: { key: string; charge: string; amountCents: number; state: PaymentState; receiptNo: string | null }[];
}

/** Today in Melbourne, which is what the database goes by. */
export const parityToday = (): string => melbourneDate(new Date().toISOString());

/** A case with its …Days fields turned into dates and fyOffset into a financial year. */
export function resolveCase(c: ParityCase, today: string): ParityCase {
  const out: Record<string, unknown> = { ...c };
  for (const [k, v] of Object.entries(c)) {
    if (k.endsWith('Days') && typeof v === 'number') out[k.slice(0, -4)] = addDays(today, v);
  }
  if (typeof c.fyOffset === 'number') out.fy = fyOf(today) + c.fyOffset;
  return out as ParityCase;
}

/** When an FNG in the Stage 4 fixture started. */
export const fngStart = (months: number | undefined, today: string): string | null =>
  months === undefined ? null : addMonths(today, months);

export const fixture: ParityFixture = JSON.parse(
  readFileSync(join(__dirname, '../../supabase/tests/parity.json'), 'utf8'),
);

export function fixtureData(without: string[] = [], today: string = parityToday()): ClubData {
  const base: ClubData = {
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
  };
  return withStage4(base, today);
}

function withStage4(data: ClubData, today: string): ClubData {
  const s4 = fixture.stage4;
  if (!s4) return data;
  const fy = fyOf(today);
  return {
    ...data,
    members: [
      ...data.members,
      ...s4.members.map((m) => ({
        id: m.key, chapterId: m.chapter, fullName: m.name, roadName: null, status: m.status, approval: m.approval,
        joinedOn: m.approval === 'approved' ? '2024-01-01' : null, patchedOn: null, fngStartedOn: fngStart(m.fngStartMonths, today),
        bio: null, sharePhone: false, appliedOn: '2024-01-01', onHiatus: false,
      })),
    ],
    positions: [
      ...data.positions,
      ...s4.positions.map((p) => ({ id: p.key, memberId: p.member, chapterId: p.chapter, role: p.role, startedOn: '2025-01-01', endedOn: null })),
    ],
    rides: [
      ...data.rides,
      ...s4.rides.map((r) => ({
        id: r.key, title: r.title, startsAt: r.startsAt, endsAt: null, allDay: false, location: null, notes: null,
        category: r.category, cancelledAt: r.cancelled ? '2026-01-01T00:00:00.000Z' : null,
      })),
    ],
    checkinSessions: s4.sessions.map((x) => ({
      id: x.key, kind: x.kind, chapterId: x.chapter, rideId: x.ride, title: x.title, heldOn: addDays(today, x.heldOnDays),
      openedBy: null, closedAt: x.closed ? '2026-01-01T00:00:00.000Z' : null, code: x.code,
    })),
    attendance: s4.attendance.map((a) => ({ sessionId: a.session, memberId: a.member, checkedInAt: '2026-01-01T00:00:00.000Z', markedBy: null })),
    decisions: [],
    feeRates: s4.rates.map((r) => ({ chapterId: r.chapter, fy: fy + r.fyOffset, status: r.status, amountCents: r.amountCents, dueOn: addDays(today, r.dueOnDays) })),
    continuationFees: [],
    charges: s4.charges.map((c) => ({
      id: c.key, memberId: c.member, chapterId: c.chapter, fy, kind: c.kind, description: c.kind === 'other' ? 'Fixture' : null,
      amountCents: c.amountCents, dueOn: addDays(today, c.dueOnDays), createdAt: '2026-01-01T00:00:00.000Z',
      waivedAt: c.waived ? '2026-01-01T00:00:00.000Z' : null,
    })),
    payments: s4.payments.map((p) => ({
      id: p.key, chargeId: p.charge, amountCents: p.amountCents, paidOn: today, method: 'payid' as const, reference: null,
      state: p.state, claimedBy: null, receiptNo: p.receiptNo, decidedAt: p.state === 'claimed' ? null : '2026-01-01T00:00:00.000Z',
    })),
    paymentDetails: [],
  };
}

/** What the demo says to this case: null when it allows it, otherwise its refusal message. */
export function demoAnswer(c: ParityCase): string | null {
  const today = parityToday();
  const data = fixtureData(c.without ?? [], today);
  const me = data.members.find((m) => m.id === c.as) ?? null;
  try {
    if (STAGE4_ACTIONS.has(String(c.action))) {
      runStage4Action({ data, me, today }, resolveCase(c, today) as unknown as Stage4Action);
      return null;
    }
    runDemoAction({ data, me, today }, c as unknown as DemoAction);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
