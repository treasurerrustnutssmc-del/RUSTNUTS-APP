// Test-only (not part of the app build). The shared who-can-do-what cases (supabase/tests/parity.json), and the demo's answer to
// each. src/data/parity.test.ts checks the demo; scripts/parity-sql.mts turns the same cases,
// with the demo's exact refusal messages, into SQL that the database must answer identically.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BallotChoice, BusPurpose, BusStatus, ChargeKind, CheckinKind, ClubData, CrewRole, Electorate, MeetingKind, Member, MemberStatus, PaymentState, PositionRole,
  RideCategory, Route, RsvpAnswer, Threshold,
  EntryState, LedgerCode, VoteResult, // Stage 5B
} from '../domain/types';
import { runDemoAction, type DemoAction } from './demoActions';
// Stage 4
import { addDays } from '../domain/dates';
import { clubYearOf } from '../domain/clubYear';
import { fyOf } from '../domain/fees';
import { addMonths } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { runStage4Action, STAGE4_ACTIONS, type Stage4Action } from './demoStage4';
import { readGpx } from '../domain/gpx';
import type { Conversation } from '../domain/chat';
import { directId, runChatAction, type ChatAction, type ChatData } from './chat/demoChatActions';
import { LEDGER_ACTIONS, runLedgerAction, type LedgerAction } from './ledgerActions'; // Stage 5B
import { ADMIN_ACTIONS, runAdminAction, type AdminAction } from './adminActions'; // Stage 5D
import { sharesFor } from '../domain/national'; // Stage 5D
import type { ConductKind, MerchStatus, OrderStatus } from '../domain/types'; // Stage 5D

export interface ParityCase extends Record<string, unknown> {
  name: string;
  /** The member acting, or null for someone not signed in. */
  as: string | null;
  allowed: boolean;
  /** Fixture positions taken away for this case only (to free a seat). */
  without?: string[];
  /** The case starts with no Road Rules published (and so no sign-offs). */
  noRoadRules?: boolean;
}

export interface ParityFixture {
  chapters: { slug: string; name: string; area: string }[];
  signups?: { key: string }[];
  members: {
    key: string; chapter: string; name: string; status: MemberStatus; approval: Member['approval']; sharePhone: boolean;
    fngStartedOn?: string;
    /** On hiatus (crew checks). */
    onHiatus?: boolean;
    /** When present, the member gets a private record with this first aid date (null: none on file). */
    firstAidExpiry?: string | null;
  }[];
  positions: { key: string; member: string; chapter: string | null; role: PositionRole; startedOn: string; endedOn: string | null }[];
  bikes: { key: string; member: string; make: string; model: string; year: number }[];
  contacts: { key: string; member: string; name: string; relationship: string; phone: string }[];
  rides: { key: string; title: string; startsAt: string; category: RideCategory; cancelled: boolean }[];
  // Stage 5: meetings and votes
  meetings: { key: string; chapter: string | null; kind: MeetingKind; title: string; startsAt: string; minutes: string | null; approved: boolean }[];
  votes: {
    key: string; chapter: string | null; electorate: Electorate; threshold: Threshold; quorum: number; closesAt: string;
    electors: string[]; ballots: { member: string; choice: BallotChoice }[];
    /** Stage 5B: a vote that has closed with this result. */
    result?: VoteResult;
  }[];
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
  /** Briefings already written, all at BRIEFED_AT. Empty texts are stored as null in the database. */
  briefings?: { ride: string; hazards: string[]; changes: string; notes: string }[];
  /** Got it taps already made, all at BRIEFED_AT. */
  briefingReads?: { ride: string; member: string }[];
  /** Road Rules versions already published, all at RULES_AT by no one. Empty What changed is stored as null. */
  roadRules?: { number: number; body: string; changes: string; fresh: boolean }[];
  /**
   * Road Rules sign-offs already made: at RULES_AT, or `signedDays` from today (negative: days ago),
   * so a sign-off stays current, due soon or run out whenever the cases are run.
   */
  roadRulesSignoffs?: { member: string; version: number; signedDays?: number }[];
  /**
   * Rusty Bus bookings already made, with their days counted from today, all booked (and decided
   * or cancelled, by no one) at BUS_AT. A declined one has the reason "Not this time."
   */
  busBookings?: {
    key: string; firstDays: number; lastDays: number; purpose: BusPurpose; ride: string | null; driver: string | null;
    bookedBy: string | null; status: BusStatus;
  }[];
  cases: ParityCase[];
  stage4?: Stage4Fixture;
  // Stage 3 (lane B): chats. A chat is named `club`, `nec`, `committee:ride`, `committee:charity`,
  // `chapter:<slug>`, `board:<slug>`, `ride:<ride key>` or `direct:<key>:<key>` (keys in order).
  directs?: [string, string][];
  blocks?: { blocker: string; blocked: string }[];
  messages?: { key: string; chat: string; author: string; body: string; removed?: boolean }[];
  // Stage 5B: the treasurer's books. Entries are dated as given; all recorded at LEDGER_AT.
  ledger?: {
    key: string; chapter: string | null; code: LedgerCode; amountCents: number; state: EntryState; entryOn: string | null;
    payee?: string; approvals?: string[]; payment?: string;
  }[];
  fundOpenings?: { chapter: string | null; fy: number; amountCents: number }[];
  cashFloats?: { fy: number; amountCents: number }[];
  /** Budgets for a year counted from today's; approved ones were approved at LEDGER_AT. */
  budgets?: { chapter: string | null; fyOffset: number; lines: Partial<Record<LedgerCode, number>>; approved: boolean; changedAt?: string }[];
  /** Months presented, counted from this month (-1: last month). */
  treasurerReports?: { monthOffset: number }[];
  /** A month whose report the demo and the database must work out the same. */
  reportMonth?: string;
  /** Stage 5D: dates are days from today; everything else was made at ADMIN_AT. */
  admin?: AdminFixture;
}

export interface AdminFixture {
  conduct: {
    key: string; member: string; kind: ConductKind; decidedDays: number; noticeDays: number; recordedBy: string;
    appeal?: { lodgedDays: number; lodgedBy: string; panel: string[]; hearingDays: number | null };
  }[];
  merchItems: { key: string; chapter: string | null; name: string; sizes: string[]; priceCents: number; patchedOnly: boolean; status: MerchStatus; proposedBy: string }[];
  merchOrders: { key: string; item: string; member: string; size: string | null; qty: number; status: OrderStatus }[];
  /** Shares are worked out from the fixture's members, as when proposed. */
  contributions: { key: string; totalCents: number; decided: { chapter: string; yes: boolean; vote: string }[] }[];
  chapterProposals: { key: string; name: string; founders: string[]; president: string; saa: string; proposedBy: string }[];
}

/** When the fixture's Stage 5D items, orders, contributions and proposals were made: before its votes closed. */
export const ADMIN_AT = '2025-12-15T00:00:00.000Z';

/** The plan on every fixture chapter proposal. */
export const ADMIN_PLAN = { location: 'Geelong.', membership: 'Five.', leadership: 'Named.', budget: '$500.', operations: 'Monthly.' };

/** When the fixture's ledger entries were recorded and its budgets approved. */
export const LEDGER_AT = '2026-10-01T00:00:00.000Z';

/** When the fixture's budgets were last saved, unless they say otherwise: before its votes closed. */
export const BUDGET_AT = '2025-12-01T00:00:00.000Z';

/** The first day of the month `offset` months from today's. */
export function monthFrom(today: string, offset: number): string {
  const [y, m] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** When the fixture's briefings were written and read. */
export const BRIEFED_AT = '2026-10-01T00:00:00.000Z';

/** When the fixture's Road Rules were published and signed. */
export const RULES_AT = '2026-10-01T00:00:00.000Z';

/** When a fixture sign-off was made: RULES_AT, or its signedDays from today, at midday in Melbourne. */
export const fixtureSignedAt = (s: { signedDays?: number }, today: string): string =>
  s.signedDays === undefined ? RULES_AT : `${addDays(today, s.signedDays)}T02:00:00.000Z`;

/** When the fixture's Rusty Bus bookings were made, decided and cancelled. */
export const BUS_AT = '2026-10-01T00:00:00.000Z';

/** The reason on the fixture's declined bookings. */
export const BUS_DECLINE_REASON = 'Not this time.';

/** The Rusty Bus actions, whose cases count their days from today (firstDays, lastDays). */
export const BUS_ACTIONS = new Set(['bookBus', 'decideBus', 'cancelBus']);

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

/** Fee actions count years AGM to AGM; the treasurer's books by financial year. */
const CLUB_YEAR_ACTIONS = new Set(['setFeeRate', 'setContinuationFee', 'raiseFees']);

/** A case with its …Days fields turned into dates and fyOffset into a year (club or financial). */
export function resolveCase(c: ParityCase, today: string): ParityCase {
  const out: Record<string, unknown> = { ...c };
  for (const [k, v] of Object.entries(c)) {
    if (k.endsWith('Days') && typeof v === 'number') out[k.slice(0, -4)] = addDays(today, v);
  }
  if (typeof c.fyOffset === 'number') {
    out.fy = (CLUB_YEAR_ACTIONS.has(String(c.action)) ? clubYearOf(today) : fyOf(today)) + c.fyOffset;
  }
  if (typeof c.monthOffset === 'number') out.month = monthFrom(today, c.monthOffset);
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
      fngStartedOn: m.fngStartedOn ?? null,
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
    // Stage 5: meetings and votes
    meetings: fixture.meetings.map((x) => ({
      id: x.key, chapterId: x.chapter, kind: x.kind, title: x.title, startsAt: new Date(x.startsAt).toISOString(),
      location: null, agenda: [], minutes: x.minutes, minutesApprovedAt: x.approved ? '2026-03-01T00:00:00.000Z' : null,
      minutesApprovedBy: null, cancelledAt: null, createdBy: null,
    })),
    actionItems: [],
    votes: fixture.votes.map((v) => ({
      id: v.key, chapterId: v.chapter, meetingId: null, subjectMemberId: null, question: v.key, details: null,
      electorate: v.electorate, threshold: v.threshold, secret: false, quorum: v.quorum, openedAt: '2025-12-01T00:00:00.000Z',
      closesAt: new Date(v.closesAt).toISOString(), closedAt: v.result ? '2026-01-01T00:00:00.000Z' : null, result: v.result ?? null,
      castingVote: null, tally: null,
      electorIds: [...v.electors].sort(), votedIds: v.ballots.map((b) => b.member).sort(),
      ballots: v.ballots.map((b) => ({ memberId: b.member, choice: b.choice })), createdBy: null,
    })),
    rsvps: (fixture.rsvps ?? []).map((r) => ({
      rideId: r.ride, memberId: r.member, answer: r.answer, updatedAt: '2026-10-01T00:00:00.000Z',
    })),
    crew: (fixture.crew ?? []).map((k) => ({
      rideId: k.ride, memberId: k.member, role: k.role, assignedBy: null, assignedAt: '2026-10-01T00:00:00.000Z',
    })),
    routes: fixtureRoutes(),
    rideRoutes: (fixture.rideRoutes ?? []).map((r) => ({ rideId: r.ride, routeId: r.route })),
    briefings: (fixture.briefings ?? []).map((b) => ({
      rideId: b.ride, hazards: b.hazards, changes: b.changes, notes: b.notes, updatedAt: BRIEFED_AT, updatedBy: null,
    })),
    briefingReads: (fixture.briefingReads ?? []).map((r) => ({ rideId: r.ride, memberId: r.member, readAt: BRIEFED_AT })),
    roadRules: (fixture.roadRules ?? []).map((v) => ({ ...v, publishedAt: RULES_AT, publishedBy: null })),
    roadRulesSignoffs: (fixture.roadRulesSignoffs ?? []).map((s) => ({
      memberId: s.member, version: s.version, signedAt: fixtureSignedAt(s, today),
    })),
    busBookings: (fixture.busBookings ?? []).map((b) => ({
      id: b.key, firstDay: addDays(today, b.firstDays), lastDay: addDays(today, b.lastDays), purpose: b.purpose, rideId: b.ride,
      driverId: b.driver, notes: '', status: b.status, bookedBy: b.bookedBy, bookedAt: BUS_AT,
      decidedBy: null, decidedAt: b.status === 'approved' || b.status === 'declined' ? BUS_AT : null,
      declineReason: b.status === 'declined' ? BUS_DECLINE_REASON : '',
      cancelledBy: null, cancelledAt: b.status === 'cancelled' ? BUS_AT : null,
    })),
  };
  return withAdmin(withLedger(withStage4(base, today), today), today);
}

// Stage 5D: conduct records, merch, contributions and chapter proposals.
function withAdmin(data: ClubData, today: string): ClubData {
  const a = fixture.admin;
  if (!a) return data;
  return {
    ...data,
    conduct: a.conduct.map((r) => ({
      id: r.key, memberId: r.member, chapterId: data.members.find((m) => m.id === r.member)!.chapterId, kind: r.kind, summary: r.key,
      rule: '', decidedOn: addDays(today, r.decidedDays), noticeOn: addDays(today, r.noticeDays), suspendedUntil: null,
      recordedBy: r.recordedBy, recordedAt: ADMIN_AT, holdUntil: null, holdReason: '',
      appeal: r.appeal
        ? {
            lodgedOn: addDays(today, r.appeal.lodgedDays), lodgedBy: r.appeal.lodgedBy, grounds: 'Fixture', panelIds: r.appeal.panel,
            hearingOn: r.appeal.hearingDays === null ? null : addDays(today, r.appeal.hearingDays), outcome: null, outcomeNote: '',
            decidedOn: null, decidedBy: null, withdrawnOn: null,
          }
        : null,
    })),
    merchItems: a.merchItems.map((i) => ({
      id: i.key, chapterId: i.chapter, name: i.name, details: '', sizes: i.sizes, priceCents: i.priceCents, patchedOnly: i.patchedOnly,
      status: i.status, proposedBy: i.proposedBy, proposedAt: ADMIN_AT, decidedBy: null, decidedAt: i.status === 'proposed' ? null : ADMIN_AT,
      declineReason: '',
    })),
    merchOrders: a.merchOrders.map((o) => ({
      id: o.key, itemId: o.item, memberId: o.member, size: o.size, qty: o.qty,
      unitCents: a.merchItems.find((i) => i.key === o.item)!.priceCents, note: '', status: o.status, orderedAt: ADMIN_AT,
      decidedBy: null, decidedAt: o.status === 'waiting' ? null : ADMIN_AT, declineReason: '',
      paidOn: o.status === 'paid' ? melbourneDate(ADMIN_AT) : null, ledgerEntryId: null, handedOverOn: null,
    })),
    contributions: a.contributions.map((k) => ({
      id: k.key, title: k.key, purpose: 'Fixture', totalCents: k.totalCents, status: 'proposed', proposedBy: null, proposedAt: ADMIN_AT,
      settledAt: null, shares: sharesFor(k.totalCents, data),
      decisions: k.decided.map((d) => ({ chapterId: d.chapter, yes: d.yes, voteId: d.vote, recordedBy: null, recordedAt: ADMIN_AT })),
    })),
    chapterProposals: a.chapterProposals.map((p) => ({
      id: p.key, name: p.name, area: 'Fixture', state: 'VIC', plan: ADMIN_PLAN, founderIds: p.founders, presidentId: p.president,
      saaId: p.saa, status: 'proposed', proposedBy: p.proposedBy, proposedAt: ADMIN_AT, voteId: null, decidedBy: null, decidedAt: null,
      chapterId: null,
    })),
  };
}

// Stage 5B: the treasurer's books.
function withLedger(data: ClubData, today: string): ClubData {
  return {
    ...data,
    ledger: (fixture.ledger ?? []).map((e) => ({
      id: e.key, chapterId: e.chapter, code: e.code, description: e.key, amountCents: e.amountCents,
      receivedOn: e.code.startsWith('CR') ? e.entryOn : null, entryOn: e.entryOn, payeeMemberId: e.payee ?? null, payeeName: e.payee || !e.code.startsWith('DB') ? null : 'Payee',
      paymentId: e.payment ?? null, state: e.state, recordedBy: null, recordedAt: LEDGER_AT, updatedAt: LEDGER_AT,
      voidReason: e.state === 'void' ? 'Fixture' : null, voidedBy: null,
      approvals: (e.approvals ?? []).map((memberId) => ({ memberId, approvedAt: LEDGER_AT })),
    })),
    fundOpenings: (fixture.fundOpenings ?? []).map((o) => ({ chapterId: o.chapter, fy: o.fy, amountCents: o.amountCents })),
    cashFloats: fixture.cashFloats ?? [],
    budgets: (fixture.budgets ?? []).map((b) => ({
      chapterId: b.chapter, fy: fyOf(today) + b.fyOffset, lines: b.lines, approvedVoteId: null,
      approvedAt: b.approved ? LEDGER_AT : null, approvedBy: null, updatedAt: b.changedAt ?? BUDGET_AT,
    })),
    treasurerReports: (fixture.treasurerReports ?? []).map((r) => ({ month: monthFrom(today, r.monthOffset), presentedAt: LEDGER_AT, presentedBy: null })),
  };
}

function withStage4(data: ClubData, today: string): ClubData {
  const s4 = fixture.stage4;
  if (!s4) return data;
  const fy = clubYearOf(today); // fees run AGM to AGM (no AGM in the fixture: 1 August)
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
  const today = parityToday();
  const fixed = fixtureData(c.without ?? [], today);
  const data = c.noRoadRules ? { ...fixed, roadRules: [], roadRulesSignoffs: [] } : fixed;
  const me = data.members.find((m) => m.id === c.as) ?? null;
  try {
    if (STAGE4_ACTIONS.has(String(c.action))) {
      runStage4Action({ data, me, today }, resolveCase(c, today) as unknown as Stage4Action);
      return null;
    }
    if (ADMIN_ACTIONS.has(String(c.action))) {
      runAdminAction({ data, me, today }, resolveCase(c, today) as unknown as AdminAction);
      return null;
    }
    if (LEDGER_ACTIONS.has(String(c.action))) {
      runLedgerAction({ data, me, today }, resolveCase(c, today) as unknown as LedgerAction);
      return null;
    }
    if (String(c.action).startsWith('chat')) {
      runChatAction({ chat: fixtureChat(), club: data, me, now: '2026-10-24T01:00:00.000Z' }, c as unknown as ChatAction);
      return null;
    }
    runDemoAction({ data, me, today }, caseAction(BUS_ACTIONS.has(String(c.action)) ? resolveCase(c, today) : c));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// Stage 3 (lane B): the fixture's chats, each with its fixture name as its id.
export function fixtureChat(): ChatData {
  const chat = (id: string, over: Partial<Conversation> & Pick<Conversation, 'kind'>): Conversation => ({
    id, chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [], ...over,
  });
  const chapters = fixtureData().chapters;
  return {
    conversations: [
      chat('club', { kind: 'club' }),
      chat('nec', { kind: 'nec' }),
      chat('committee:ride', { kind: 'committee', committee: 'ride' }),
      chat('committee:charity', { kind: 'committee', committee: 'charity' }),
      ...chapters.flatMap((c) => [
        chat(`chapter:${c.slug}`, { kind: 'chapter', chapterId: c.id }),
        chat(`board:${c.slug}`, { kind: 'board', chapterId: c.id }),
      ]),
      ...fixture.rides.map((r) => chat(`ride:${r.key}`, { kind: 'ride', rideId: r.key })),
      ...(fixture.directs ?? []).map(([a, b]) => chat(directId(a, b), { kind: 'direct', memberIds: [a, b] })),
    ],
    messages: (fixture.messages ?? []).map((m, i) => ({
      id: m.key,
      conversationId: m.chat,
      authorId: m.author,
      body: m.removed ? null : m.body,
      createdAt: new Date(Date.UTC(2026, 9, 24, 0, i)).toISOString(),
      removedAt: m.removed ? '2026-10-24T00:30:00.000Z' : null,
      replyToId: null,
      media: [],
      reactions: [],
    })),
    reads: [],
    blocks: (fixture.blocks ?? []).map((b) => ({ blockerId: b.blocker, blockedId: b.blocked })),
    reports: [],
  };
}
