// Fees by financial year (1 July to 30 June), charges, PayID claims and receipts. Money is whole
// cents. The database's fee actions apply the same rules with the same words.

import { activePositions, holdsBoardSeat, isBoardOf } from './access';
import { daysBetween } from './dates';
import type { Charge, ClubData, Member, MemberStatus, Payment, PaymentMethod, Position } from './types';

/** Who pays a yearly fee. Introduced applicants don't yet, and Legacy members have left. */
export const PAYING_STATUSES: MemberStatus[] = ['full', 'nomad', 'fng', 'supporter', 'family'];

/** Approved, with a paying status, and not on hiatus (members on hiatus don't pay, Jeff 24 Oct 2026). */
export function paysFees(member: Member): boolean {
  return member.approval === 'approved' && !member.onHiatus && PAYING_STATUSES.includes(member.status);
}

export const MONEY_ONLY = 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
export const SET_FEES_ONLY = 'Only that chapter’s board sets its fees.';
export const NOT_YOUR_OWN = 'Someone else with money rights has to handle your own fees.';
const AMOUNT = 'Enter an amount over $0.';

/** The financial year an ISO date falls in, by the year it starts (2026 = FY26–27). */
export function fyOf(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

export function fyLabel(fy: number): string {
  const two = (n: number) => String(n % 100).padStart(2, '0');
  return `FY${two(fy)}–${two(fy + 1)}`;
}

export function formatCents(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100).toLocaleString('en-AU');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

/** "250", "$12.50", "1,250" → cents. Null for anything else. */
export function parseDollars(input: string): number | null {
  const t = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = t.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const isAmount = (cents: number) => Number.isInteger(cents) && cents > 0;

export interface Balance {
  paidCents: number;
  owingCents: number;
  state: 'paid' | 'part' | 'owing' | 'waived';
}

export function chargeBalance(charge: Charge, payments: Payment[]): Balance {
  const paidCents = payments
    .filter((p) => p.chargeId === charge.id && p.state === 'confirmed')
    .reduce((sum, p) => sum + p.amountCents, 0);
  if (charge.waivedAt) return { paidCents, owingCents: 0, state: 'waived' };
  const owingCents = Math.max(0, charge.amountCents - paidCents);
  return { paidCents, owingCents, state: owingCents === 0 ? 'paid' : paidCents > 0 ? 'part' : 'owing' };
}

/** "soon" = due within 30 days. */
export function dueState(charge: Charge, balance: Balance, today: string): 'overdue' | 'soon' | 'later' | 'settled' {
  if (balance.owingCents === 0) return 'settled';
  const days = daysBetween(today, charge.dueOn);
  if (days < 0) return 'overdue';
  return days <= 30 ? 'soon' : 'later';
}

/** W26-0001: chapter initial, financial year, then a running number per chapter and year. */
export function receiptNo(chapterSlug: string, fy: number, seq: number): string {
  return `${chapterSlug.charAt(0).toUpperCase()}${String(fy % 100).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;
}

/** The receipt after the highest already issued in that chapter's book for the year. */
export function nextReceiptNo(chapterSlug: string, fy: number, issued: string[]): string {
  const prefix = receiptNo(chapterSlug, fy, 0).slice(0, -4);
  const top = issued.filter((r) => r.startsWith(prefix)).reduce((max, r) => Math.max(max, Number(r.slice(prefix.length))), 0);
  return receiptNo(chapterSlug, fy, top + 1);
}

/** What to put in the bank transfer's description, so the treasurer can match it. */
export function paymentReference(member: Pick<Member, 'roadName' | 'fullName'>): string {
  const name = member.roadName?.trim() || member.fullName.trim().split(/\s+/).pop() || 'MEMBER';
  return `${name.toUpperCase().slice(0, 18).trim()} FEES`;
}

/** The chapter's Treasurer, or the National Chairman or Secretary. */
export function canManageFees(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  return activePositions(viewer.id, positions).some(
    (p) => (p.role === 'treasurer' && p.chapterId === chapterId) || p.role === 'nec_chair' || p.role === 'nec_secretary',
  );
}

/** The chapter's board sets the amounts (Jeff, 24 Oct 2026), as can whoever handles its money. */
export function canSetFees(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  return canManageFees(viewer, chapterId, positions) || holdsBoardSeat(viewer.id, chapterId, positions);
}

/** Fee handlers, the chapter's board and the NEC (the National Auditor included) can look. */
export function canSeeFees(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  return canManageFees(viewer, chapterId, positions) || isBoardOf(viewer, chapterId, positions);
}

export function feeRateProblem(me: Member | null, chapterId: string, status: MemberStatus, amountCents: number, data: ClubData): string | null {
  if (!canSetFees(me, chapterId, data.positions)) return SET_FEES_ONLY;
  if (!PAYING_STATUSES.includes(status)) return 'That status doesn’t pay fees.';
  return isAmount(amountCents) ? null : AMOUNT;
}

export function continuationFeeProblem(me: Member | null, chapterId: string, amountCents: number, data: ClubData): string | null {
  if (!canSetFees(me, chapterId, data.positions)) return SET_FEES_ONLY;
  return isAmount(amountCents) ? null : AMOUNT;
}

export function paymentDetailsProblem(me: Member | null, chapterId: string, data: ClubData): string | null {
  return canManageFees(me, chapterId, data.positions) ? null : MONEY_ONLY;
}

export function raiseFeesProblem(me: Member | null, chapterId: string, fy: number, data: ClubData): string | null {
  if (!canManageFees(me, chapterId, data.positions)) return MONEY_ONLY;
  const rated = (data.feeRates ?? []).some((r) => r.chapterId === chapterId && r.fy === fy);
  return rated ? null : 'Set this year’s fees first.';
}

export function raiseChargeProblem(me: Member | null, target: Member, description: string, amountCents: number, data: ClubData): string | null {
  if (!canManageFees(me, target.chapterId, data.positions)) return MONEY_ONLY;
  if (target.approval !== 'approved') return 'Approve them first.';
  if (!description.trim()) return 'Add what it’s for.';
  return isAmount(amountCents) ? null : AMOUNT;
}

export function waiveProblem(me: Member | null, charge: Charge, data: ClubData): string | null {
  if (!canManageFees(me, charge.chapterId, data.positions)) return MONEY_ONLY;
  if (me!.id === charge.memberId) return NOT_YOUR_OWN;
  if (charge.waivedAt) return 'That charge is already waived.';
  return chargeBalance(charge, data.payments ?? []).owingCents === 0 ? 'That charge is already paid.' : null;
}

function paymentProblem(
  charge: Charge,
  amountCents: number,
  paidOn: string,
  method: PaymentMethod,
  data: ClubData,
  today: string,
  tooMuch: string,
): string | null {
  if (charge.waivedAt) return 'That charge was waived.';
  const { owingCents } = chargeBalance(charge, data.payments ?? []);
  if (owingCents === 0) return 'That’s already paid.';
  if (!isAmount(amountCents)) return AMOUNT;
  if (amountCents > owingCents) return tooMuch;
  if (paidOn > today) return 'The payment date can’t be in the future.';
  if (method === 'card') return 'Card payments aren’t set up yet.';
  return null;
}

/** A member saying they've paid (by PayID, transfer or cash), for the treasurer to confirm. */
export function claimProblem(
  me: Member | null,
  charge: Charge,
  amountCents: number,
  paidOn: string,
  method: PaymentMethod,
  data: ClubData,
  today: string,
): string | null {
  if (!me || me.id !== charge.memberId) return 'You can only pay your own fees.';
  return paymentProblem(charge, amountCents, paidOn, method, data, today, 'That’s more than you owe.');
}

/** The treasurer recording money they've received: confirmed straight away. */
export function recordPaymentProblem(
  me: Member | null,
  charge: Charge,
  amountCents: number,
  paidOn: string,
  method: PaymentMethod,
  data: ClubData,
  today: string,
): string | null {
  if (!canManageFees(me, charge.chapterId, data.positions)) return MONEY_ONLY;
  if (me!.id === charge.memberId) return NOT_YOUR_OWN;
  return paymentProblem(charge, amountCents, paidOn, method, data, today, 'That’s more than they owe.');
}

export function decidePaymentProblem(me: Member | null, payment: Payment, decision: 'confirm' | 'reject', data: ClubData): string | null {
  const charge = (data.charges ?? []).find((c) => c.id === payment.chargeId);
  if (!charge || !canManageFees(me, charge.chapterId, data.positions)) return MONEY_ONLY;
  if (me!.id === charge.memberId) return NOT_YOUR_OWN;
  if (payment.state !== 'claimed') return 'That payment has already been dealt with.';
  if (decision === 'confirm' && payment.amountCents > chargeBalance(charge, data.payments ?? []).owingCents) {
    return 'That’s more than they owe.';
  }
  return null;
}

/** A member's charges, newest year first, then by due date. */
export function chargesOf(memberId: string, data: ClubData): Charge[] {
  return (data.charges ?? [])
    .filter((c) => c.memberId === memberId)
    .sort((a, b) => b.fy - a.fy || a.dueOn.localeCompare(b.dueOn));
}

/** What a member still owes across all their charges. */
export function totalOwing(memberId: string, data: ClubData): number {
  return chargesOf(memberId, data).reduce((sum, c) => sum + chargeBalance(c, data.payments ?? []).owingCents, 0);
}
