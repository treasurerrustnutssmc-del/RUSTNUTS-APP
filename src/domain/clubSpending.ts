// Club spending for members (Jeff, 21 Nov 2026): every paid expense in a financial year, with
// member names taken out (Jeff chose "Hide member names"). The database's club_spending() does the
// same for live members, who never receive the ledger lines themselves; this is the demo's copy
// and the rule both follow. Money coming in isn't listed: it would show who paid fees.

import { fyOf } from './fees';
import { isDebit } from './ledger';
import type { ClubData, LedgerCode, Member, SpendingLine } from './types';

export type { SpendingLine };

export const A_MEMBER = 'A member';
const MIN_NAME = 3;

type Named = Pick<Member, 'fullName' | 'roadName'>;

/**
 * Every member's full name, each part of it (first name, middle names, surname) and road name worth
 * hiding, longest first so a full name goes before a part of it. Jeff, 24 Nov 2026: "no personal or
 * road names on any transactions".
 */
function namesOf(members: Named[]): string[] {
  const all = new Set<string>();
  const add = (n: string) => {
    const t = n.trim();
    if ([...t].length >= MIN_NAME) all.add(t);
  };
  for (const m of members) {
    const full = (m.fullName ?? '').trim();
    add(full);
    for (const part of full.split(/\s+/)) add(part);
    add(m.roadName ?? '');
  }
  return [...all].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Spaces in a name also match no space, a hyphen, a dot or an underscore: "Bam Bam", "BamBam", "bam-bam". */
const flexible = (name: string) => name.split(/\s+/).map(escape).join('[\\s._-]*');
const wordRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${flexible(name)}(?![\\p{L}\\p{N}_])`, 'giu');

/** Replaces any member's name (full, any part of it, or road name; whole words, any case) with "a member". */
export function hideMemberNames(text: string, members: Named[]): string {
  let out = text;
  for (const name of namesOf(members)) out = out.replace(wordRe(name), 'a member');
  // "Christopher Andrew D" is two parts of one name, so one "a member", not two in a row.
  return out.replace(/a member(?:\s+a member)+/g, 'a member');
}

function payeeOf(payeeMemberId: string | null, payeeName: string | null, members: Named[]): string | null {
  if (payeeMemberId) return A_MEMBER;
  const name = (payeeName ?? '').trim();
  if (!name) return null;
  return hideMemberNames(name, members) === name ? name : A_MEMBER;
}

/** Paid expenses dated in financial year `fy` (1 July fy to 30 June fy+1), newest first. */
export function spendingLines(data: ClubData, fy: number): SpendingLine[] {
  const members = data.members;
  return (data.ledger ?? [])
    .filter((e) => e.state === 'paid' && isDebit(e.code) && !!e.entryOn && fyOf(e.entryOn) === fy)
    .sort((a, b) => b.entryOn!.localeCompare(a.entryOn!) || b.recordedAt.localeCompare(a.recordedAt))
    .map((e) => ({
      id: e.id,
      entryOn: e.entryOn!,
      code: e.code,
      chapterId: e.chapterId,
      amountCents: e.amountCents,
      description: hideMemberNames(e.description, members),
      payee: payeeOf(e.payeeMemberId, e.payeeName, members),
    }));
}

export const spendingTotal = (lines: SpendingLine[]) => lines.reduce((s, l) => s + l.amountCents, 0);

/** The year's lines: the database's for live members (who never get the ledger), else worked out here. */
export function spendingFor(data: ClubData, fy: number): SpendingLine[] {
  return data.spending ? data.spending.filter((l) => fyOf(l.entryOn) === fy) : spendingLines(data, fy);
}

/** Spending by kind (payment code), biggest first. */
export function spendingByCode(lines: SpendingLine[]): { code: LedgerCode; cents: number }[] {
  const by = new Map<LedgerCode, number>();
  for (const l of lines) by.set(l.code, (by.get(l.code) ?? 0) + l.amountCents);
  return [...by].map(([code, cents]) => ({ code, cents })).sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code));
}

/** This financial year and the one before, newest first. */
export const spendingYears = (today: string): number[] => [fyOf(today), fyOf(today) - 1];

/** Lines grouped by month ("2026-10"), newest month and line first. */
export function spendingMonths(lines: SpendingLine[]): { month: string; lines: SpendingLine[] }[] {
  const sorted = [...lines].sort((a, b) => b.entryOn.localeCompare(a.entryOn) || b.id.localeCompare(a.id));
  const out: { month: string; lines: SpendingLine[] }[] = [];
  for (const l of sorted) {
    const month = l.entryOn.slice(0, 7);
    if (out[out.length - 1]?.month !== month) out.push({ month, lines: [] });
    out[out.length - 1].lines.push(l);
  }
  return out;
}
