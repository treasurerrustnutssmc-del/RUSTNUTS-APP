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
    for (const part of full.split(/[\s._-]+/)) add(part);
    add(m.roadName ?? '');
  }
  return [...all].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Spaces in a name also match no space, a hyphen, a dot or an underscore: "Bam Bam", "BamBam", "bam-bam". */
const flexible = (name: string) => name.split(/[\s._-]+/).map(escape).join('[\\s._-]*');
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}_])';

/** The club's own words, never taken for a name (a road name of Rusty doesn't touch the Rusty Bus). */
const CLUB_WORDS = /(?<![\p{L}\p{N}_])rusty[\s._-]*bus(?![\p{L}\p{N}_])/giu;
const CLUB_WORD = 'Rusty Bus';
const COLLAPSE = /a member(?:\s+a member)+(?![\p{L}\p{N}_])/gu;

/** One pattern for all the names (longest first), built once per members list: the books can be long. */
const patterns = new WeakMap<Named[], RegExp | null>();
function patternFor(members: Named[]): RegExp | null {
  if (patterns.has(members)) return patterns.get(members)!;
  const names = namesOf(members);
  const re = names.length ? new RegExp(`${NOT_WORD_BEFORE}(?:${names.map(flexible).join('|')})${NOT_WORD_AFTER}`, 'giu') : null;
  patterns.set(members, re);
  return re;
}

/** Replaces any member's name (full, any part of it, or road name; whole words, any case) with "a member". */
export function hideMemberNames(text: string, members: Named[]): string {
  const re = patternFor(members);
  if (!re) return text;
  // The club's words are set aside first, then put back; two parts of one name side by side
  // ("Christopher Andrew D") become one "a member".
  return text
    .split(CLUB_WORDS)
    .map((part) => part.replace(re, 'a member').replace(COLLAPSE, 'a member'))
    .join(CLUB_WORD);
}

/**
 * A typed payee as someone without names reads it: unchanged when no name is in it, "A member" when
 * it's only a name, else with the name taken out ("Shell Ringwood" stays a business).
 */
export function payeeShown(name: string, members: Named[]): string {
  const hidden = hideMemberNames(name, members);
  if (hidden === name) return name;
  return hidden.trim().toLowerCase() === 'a member' ? A_MEMBER : hidden;
}

function payeeOf(payeeMemberId: string | null, payeeName: string | null, members: Named[]): string | null {
  if (payeeMemberId) return A_MEMBER;
  const name = (payeeName ?? '').trim();
  if (!name) return null;
  return payeeShown(name, members);
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
