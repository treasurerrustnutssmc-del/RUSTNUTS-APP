// Stage 4 in the demo: check-ins, the board's decisions and fees. Like demoActions, plain
// functions that take the club as it is and hand back the club as it should be, or throw with
// the same words as the database's actions (checked by src/data/parity.test.ts).

import { checkInProblem, closeProblem, canRunCheckin, markProblem, newCode, normalizeCode, openCheckinProblem, rideChapterId, type OpenCheckinInput } from '../domain/attendance';
import { agmDateProblem, clubYearOf, proRata, proRataNote, recordAgmProblem } from '../domain/clubYear';
import { addDays } from '../domain/dates';
import {
  claimProblem,
  continuationFeeFor,
  continuationFeeProblem,
  decidePaymentProblem,
  feeRateProblem,
  paymentDetailsProblem,
  raiseChargeProblem,
  nextReceiptNo,
  paysFees,
  raiseFeesProblem,
  recordPaymentProblem,
  waiveProblem,
} from '../domain/fees';
import { decideApplicationProblem, fngOutcomeStatus, fngReviewProblem, type FngOutcome } from '../domain/joining';
import { melbourneDate } from '../domain/rides';
import type { Charge, ClubData, MemberStatus, Payment, PaymentDetails, PaymentMethod, Votes } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { approve, decline, withPatchInFee, type DemoCtx } from './demoActions';

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();
const deny = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

function sessionOf(data: ClubData, id: string) {
  const s = (data.checkinSessions ?? []).find((x) => x.id === id);
  if (!s) throw new Error('No such check-in.');
  return s;
}

function chargeOf(data: ClubData, id: string): Charge {
  const c = (data.charges ?? []).find((x) => x.id === id);
  if (!c) throw new Error('No such charge.');
  return c;
}

function memberOf(data: ClubData, id: string) {
  const m = data.members.find((x) => x.id === id);
  if (!m) throw new Error('That member no longer exists.');
  return m;
}

// ---------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------

export function openCheckin(ctx: DemoCtx, input: OpenCheckinInput): { data: ClubData; id: string } {
  deny(openCheckinProblem(ctx.me, input, ctx.data, ctx.today));
  const ride = input.kind === 'ride' ? ctx.data.rides.find((r) => r.id === input.rideId)! : null;
  const id = newId('s');
  const session = {
    id,
    kind: input.kind,
    chapterId: ride ? rideChapterId(ride, ctx.data.chapters) : input.chapterId,
    rideId: ride?.id ?? null,
    title: ride ? ride.title : input.title.trim(),
    heldOn: ride ? melbourneDate(ride.startsAt) : input.heldOn,
    openedBy: ctx.me!.id,
    closedAt: null,
    code: newCode(),
  };
  return { data: { ...ctx.data, checkinSessions: [...(ctx.data.checkinSessions ?? []), session] }, id };
}

export function checkinCode(ctx: DemoCtx, sessionId: string): string {
  const s = sessionOf(ctx.data, sessionId);
  if (!canRunCheckin(ctx.me, s.chapterId, ctx.data.positions)) {
    throw new NotAllowedError('Only that chapter’s board can run this check-in.');
  }
  return s.code ?? '';
}

export function checkIn(ctx: DemoCtx, code: string): { data: ClubData; id: string } {
  const wanted = normalizeCode(code);
  const s = (ctx.data.checkinSessions ?? []).find((x) => x.code === wanted);
  deny(checkInProblem(ctx.me, s, ctx.today));
  const attendance = ctx.data.attendance ?? [];
  if (attendance.some((a) => a.sessionId === s!.id && a.memberId === ctx.me!.id)) return { data: ctx.data, id: s!.id };
  return {
    data: { ...ctx.data, attendance: [...attendance, { sessionId: s!.id, memberId: ctx.me!.id, checkedInAt: nowOf(ctx), markedBy: null }] },
    id: s!.id,
  };
}

export function markAttendance(ctx: DemoCtx, sessionId: string, memberId: string, present: boolean): ClubData {
  const s = sessionOf(ctx.data, sessionId);
  deny(markProblem(ctx.me, s, ctx.data.members.find((m) => m.id === memberId), ctx.data, ctx.today));
  const others = (ctx.data.attendance ?? []).filter((a) => !(a.sessionId === sessionId && a.memberId === memberId));
  const existing = (ctx.data.attendance ?? []).find((a) => a.sessionId === sessionId && a.memberId === memberId);
  if (!present) return { ...ctx.data, attendance: others };
  if (existing) return ctx.data;
  return {
    ...ctx.data,
    attendance: [...others, { sessionId, memberId, checkedInAt: nowOf(ctx), markedBy: ctx.me!.id }],
  };
}

export function closeCheckin(ctx: DemoCtx, sessionId: string): ClubData {
  const s = sessionOf(ctx.data, sessionId);
  deny(closeProblem(ctx.me, s, ctx.data));
  return {
    ...ctx.data,
    checkinSessions: (ctx.data.checkinSessions ?? []).map((x) => (x.id === sessionId ? { ...x, closedAt: nowOf(ctx) } : x)),
  };
}

// ---------------------------------------------------------------------------
// The board's decisions
// ---------------------------------------------------------------------------

const cleanNote = (note: string) => note.trim() || null;

export function decideApplication(ctx: DemoCtx, memberId: string, status: MemberStatus | null, votes: Votes, note: string): ClubData {
  const target = ctx.data.members.find((m) => m.id === memberId);
  if (!target) throw new NotAllowedError('No such applicant.');
  deny(decideApplicationProblem(ctx.me, target, status, votes, ctx.data));
  const data = status === null ? decline(ctx, memberId) : approve(ctx, memberId, status);
  const decision = {
    id: newId('d'), memberId, kind: 'application' as const, atMonths: null,
    outcome: status === null ? ('declined' as const) : ('approved' as const), status,
    votesFor: votes.for, votesAgainst: votes.against, votesAbstained: votes.abstained, note: cleanNote(note),
    decidedOn: ctx.today, recordedBy: ctx.me!.id,
  };
  return { ...data, decisions: [...(data.decisions ?? []), decision] };
}

export function recordFngReview(ctx: DemoCtx, memberId: string, atMonths: number, outcome: FngOutcome, votes: Votes, note: string): ClubData {
  const target = memberOf(ctx.data, memberId);
  deny(fngReviewProblem(ctx.me, target, atMonths, outcome, votes, ctx.data, ctx.today));
  const decision = {
    id: newId('d'), memberId, kind: 'fng_review' as const, atMonths, outcome, status: null,
    votesFor: votes.for, votesAgainst: votes.against, votesAbstained: votes.abstained, note: cleanNote(note),
    decidedOn: ctx.today, recordedBy: ctx.me!.id,
  };
  const status = fngOutcomeStatus(outcome);
  let data: ClubData = {
    ...ctx.data,
    decisions: [...(ctx.data.decisions ?? []), decision],
    members: ctx.data.members.map((m) =>
      m.id === memberId
        ? { ...m, status, patchedOn: status === 'full' ? m.patchedOn ?? ctx.today : m.patchedOn }
        : m,
    ),
  };
  // Past twelve months, carrying on costs half the chapter's Full fee for the year, once ever
  // (constitution v4 4.11), and nothing while on hiatus.
  data = withPatchInFee(ctx, memberId, data);
  const fy = clubYearOf(ctx.today, ctx.data.agms);
  const fee = continuationFeeFor(target.chapterId, fy, ctx.data);
  const already = (ctx.data.charges ?? []).some((c) => c.memberId === memberId && c.kind === 'continuation');
  if (outcome === 'continue' && atMonths >= 12 && fee !== null && fee > 0 && !already && !target.onHiatus) {
    data = {
      ...data,
      charges: [
        ...(data.charges ?? []),
        {
          id: newId('c'), memberId, chapterId: target.chapterId, fy, kind: 'continuation', description: 'FNG continuation fee',
          amountCents: fee, dueOn: addDays(ctx.today, 30), createdAt: nowOf(ctx), waivedAt: null,
        },
      ],
    };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export function setFeeRate(ctx: DemoCtx, chapterId: string, fy: number, status: MemberStatus, amountCents: number, dueOn: string): ClubData {
  deny(feeRateProblem(ctx.me, chapterId, status, amountCents, ctx.data));
  if (!dueOn) throw new Error('Pick a due date.');
  const others = (ctx.data.feeRates ?? []).filter((r) => !(r.chapterId === chapterId && r.fy === fy && r.status === status));
  return { ...ctx.data, feeRates: [...others, { chapterId, fy, status, amountCents, dueOn }] };
}

export function setContinuationFee(ctx: DemoCtx, chapterId: string, fy: number, amountCents: number): ClubData {
  deny(continuationFeeProblem(ctx.me, chapterId, amountCents, ctx.data));
  const others = (ctx.data.continuationFees ?? []).filter((f) => !(f.chapterId === chapterId && f.fy === fy));
  return { ...ctx.data, continuationFees: [...others, { chapterId, fy, amountCents }] };
}

export function setPaymentDetails(ctx: DemoCtx, details: PaymentDetails): ClubData {
  deny(paymentDetailsProblem(ctx.me, details.chapterId, ctx.data));
  const clean = (v: string | null) => v?.trim() || null;
  const record = {
    chapterId: details.chapterId, payid: clean(details.payid), payidName: clean(details.payidName),
    bsb: clean(details.bsb), accountNo: clean(details.accountNo),
  };
  return { ...ctx.data, paymentDetails: [...(ctx.data.paymentDetails ?? []).filter((d) => d.chapterId !== details.chapterId), record] };
}

export function raiseFees(ctx: DemoCtx, chapterId: string, fy: number): { data: ClubData; count: number } {
  deny(raiseFeesProblem(ctx.me, chapterId, fy, ctx.data));
  const charges = [...(ctx.data.charges ?? [])];
  let count = 0;
  for (const m of ctx.data.members) {
    if (m.chapterId !== chapterId || !paysFees(m)) continue;
    const rate = (ctx.data.feeRates ?? []).find((r) => r.chapterId === chapterId && r.fy === fy && r.status === m.status);
    if (!rate || charges.some((c) => c.memberId === m.id && c.fy === fy && c.kind === 'annual')) continue;
    // A Full member patched after this year's AGM pays for the months left (Jeff, 25 Oct 2026).
    const { cents, months } = m.status === 'full' && m.patchedOn ? proRata(rate.amountCents, m.patchedOn, fy, ctx.data.agms) : { cents: rate.amountCents, months: 12 };
    if (months === 0) continue; // patched after that year ended
    charges.push({
      id: newId('c'), memberId: m.id, chapterId, fy, kind: 'annual', description: proRataNote(months), amountCents: cents,
      dueOn: rate.dueOn, createdAt: nowOf(ctx), waivedAt: null,
    });
    count++;
  }
  return { data: { ...ctx.data, charges }, count };
}

/** Records (or corrects) the date of a year's AGM, which starts that club year. */
export function recordAgm(ctx: DemoCtx, heldOn: string): ClubData {
  deny(recordAgmProblem(ctx.me, ctx.data.positions));
  deny(agmDateProblem(heldOn));
  const year = Number(heldOn.slice(0, 4));
  return { ...ctx.data, agms: [...(ctx.data.agms ?? []).filter((a) => a.year !== year), { year, heldOn }] };
}

export function raiseCharge(ctx: DemoCtx, memberId: string, description: string, amountCents: number, dueOn: string): ClubData {
  const target = memberOf(ctx.data, memberId);
  deny(raiseChargeProblem(ctx.me, target, description, amountCents, ctx.data));
  if (!dueOn) throw new Error('Pick a due date.');
  const charge: Charge = {
    id: newId('c'), memberId, chapterId: target.chapterId, fy: clubYearOf(ctx.today, ctx.data.agms), kind: 'other', description: description.trim(),
    amountCents, dueOn, createdAt: nowOf(ctx), waivedAt: null,
  };
  return { ...ctx.data, charges: [...(ctx.data.charges ?? []), charge] };
}

export function waiveCharge(ctx: DemoCtx, chargeId: string): ClubData {
  const charge = chargeOf(ctx.data, chargeId);
  deny(waiveProblem(ctx.me, charge, ctx.data));
  return { ...ctx.data, charges: (ctx.data.charges ?? []).map((c) => (c.id === chargeId ? { ...c, waivedAt: nowOf(ctx) } : c)) };
}

function nextReceipt(data: ClubData, charge: Charge): string {
  const slug = data.chapters.find((c) => c.id === charge.chapterId)?.slug ?? 'x';
  return nextReceiptNo(slug, charge.fy, (data.payments ?? []).flatMap((p) => (p.receiptNo ? [p.receiptNo] : [])));
}

export function claimPayment(ctx: DemoCtx, chargeId: string, amountCents: number, paidOn: string, method: PaymentMethod, reference: string): ClubData {
  const charge = (ctx.data.charges ?? []).find((c) => c.id === chargeId);
  if (!charge) throw new NotAllowedError('You can only pay your own fees.');
  deny(claimProblem(ctx.me, charge, amountCents, paidOn, method, ctx.data, ctx.today));
  const payment: Payment = {
    id: newId('pay'), chargeId, amountCents, paidOn, method, reference: reference.trim() || null, state: 'claimed',
    claimedBy: ctx.me!.id, receiptNo: null, decidedAt: null,
  };
  return { ...ctx.data, payments: [...(ctx.data.payments ?? []), payment] };
}

export function recordPayment(ctx: DemoCtx, chargeId: string, amountCents: number, paidOn: string, method: PaymentMethod, reference: string): ClubData {
  const charge = chargeOf(ctx.data, chargeId);
  deny(recordPaymentProblem(ctx.me, charge, amountCents, paidOn, method, ctx.data, ctx.today));
  const payment: Payment = {
    id: newId('pay'), chargeId, amountCents, paidOn, method, reference: reference.trim() || null, state: 'confirmed',
    claimedBy: null, receiptNo: nextReceipt(ctx.data, charge), decidedAt: nowOf(ctx),
  };
  return { ...ctx.data, payments: [...(ctx.data.payments ?? []), payment] };
}

function decide(ctx: DemoCtx, paymentId: string, decision: 'confirm' | 'reject'): ClubData {
  const payment = (ctx.data.payments ?? []).find((p) => p.id === paymentId);
  if (!payment) throw new Error('No such payment.');
  deny(decidePaymentProblem(ctx.me, payment, decision, ctx.data));
  const charge = chargeOf(ctx.data, payment.chargeId);
  const patch: Partial<Payment> =
    decision === 'confirm'
      ? { state: 'confirmed', receiptNo: nextReceipt(ctx.data, charge), decidedAt: nowOf(ctx) }
      : { state: 'rejected', decidedAt: nowOf(ctx) };
  return { ...ctx.data, payments: (ctx.data.payments ?? []).map((p) => (p.id === paymentId ? { ...p, ...patch } : p)) };
}

export const confirmPayment = (ctx: DemoCtx, paymentId: string) => decide(ctx, paymentId, 'confirm');
export const rejectPayment = (ctx: DemoCtx, paymentId: string) => decide(ctx, paymentId, 'reject');

/** The Stage 4 actions the shared parity cases use, by name, with their dates already worked out. */
export type Stage4Action =
  | { action: 'openCheckin'; kind: 'ride' | 'meeting'; ride: string | null; chapter: string | null; title: string; heldOn: string }
  | { action: 'checkIn'; code: string }
  | { action: 'markAttendance'; session: string; member: string; present: boolean }
  | { action: 'closeCheckin'; session: string }
  | { action: 'decideApplication'; member: string; status: MemberStatus | null; votes: Votes; note: string }
  | { action: 'fngReview'; member: string; atMonths: number; outcome: FngOutcome; votes: Votes; note: string }
  | { action: 'setFeeRate'; chapter: string; fy: number; status: MemberStatus; amountCents: number; dueOn: string }
  | { action: 'setContinuationFee'; chapter: string; fy: number; amountCents: number }
  | { action: 'setPaymentDetails'; chapter: string; payid: string | null }
  | { action: 'raiseFees'; chapter: string; fy: number }
  | { action: 'recordAgm'; heldOn: string }
  | { action: 'raiseCharge'; member: string; description: string; amountCents: number; dueOn: string }
  | { action: 'waiveCharge'; charge: string }
  | { action: 'claimPayment' | 'recordPayment'; charge: string; amountCents: number; paidOn: string; method: PaymentMethod; reference: string }
  | { action: 'confirmPayment' | 'rejectPayment'; payment: string };

export const STAGE4_ACTIONS = new Set<string>([
  'openCheckin', 'checkIn', 'markAttendance', 'closeCheckin', 'decideApplication', 'fngReview', 'setFeeRate',
  'setContinuationFee', 'setPaymentDetails', 'raiseFees', 'recordAgm', 'raiseCharge', 'waiveCharge', 'claimPayment',
  'recordPayment', 'confirmPayment', 'rejectPayment',
]);

export function runStage4Action(ctx: DemoCtx, a: Stage4Action): ClubData {
  switch (a.action) {
    case 'openCheckin':
      return openCheckin(ctx, { kind: a.kind, rideId: a.ride, chapterId: a.chapter, title: a.title, heldOn: a.heldOn }).data;
    case 'checkIn':
      return checkIn(ctx, a.code).data;
    case 'markAttendance':
      return markAttendance(ctx, a.session, a.member, a.present);
    case 'closeCheckin':
      return closeCheckin(ctx, a.session);
    case 'decideApplication':
      return decideApplication(ctx, a.member, a.status, a.votes, a.note);
    case 'fngReview':
      return recordFngReview(ctx, a.member, a.atMonths, a.outcome, a.votes, a.note);
    case 'setFeeRate':
      return setFeeRate(ctx, a.chapter, a.fy, a.status, a.amountCents, a.dueOn);
    case 'setContinuationFee':
      return setContinuationFee(ctx, a.chapter, a.fy, a.amountCents);
    case 'setPaymentDetails':
      return setPaymentDetails(ctx, { chapterId: a.chapter, payid: a.payid, payidName: null, bsb: null, accountNo: null });
    case 'raiseFees':
      return raiseFees(ctx, a.chapter, a.fy).data;
    case 'recordAgm':
      return recordAgm(ctx, a.heldOn);
    case 'raiseCharge':
      return raiseCharge(ctx, a.member, a.description, a.amountCents, a.dueOn);
    case 'waiveCharge':
      return waiveCharge(ctx, a.charge);
    case 'claimPayment':
      return claimPayment(ctx, a.charge, a.amountCents, a.paidOn, a.method, a.reference);
    case 'recordPayment':
      return recordPayment(ctx, a.charge, a.amountCents, a.paidOn, a.method, a.reference);
    case 'confirmPayment':
      return confirmPayment(ctx, a.payment);
    case 'rejectPayment':
      return rejectPayment(ctx, a.payment);
  }
}
