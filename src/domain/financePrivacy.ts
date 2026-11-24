// Member privacy on the club's finances (Jeff, 24 Nov 2026: "no personal or road names on any
// transactions"; he chose "Treasurer and auditor only"). Whoever keeps a fund's books, and the
// National Auditor, read its lines as written. Everyone else who reads them (board members approving
// spending) gets members' names swapped for "a member", and the meeting report notes the same way
// unless they keep the Club fund's books. Members' own Club spending list is in clubSpending.ts.
// Mirrors public.club_ledger() and public.meeting_reports() (20270990000000_finance_privacy.sql).

import { isAuditor } from './access';
import { A_MEMBER, hideMemberNames } from './clubSpending';
import { keepsBooks } from './ledger';
import type { ClubData, LedgerCode, LedgerEntry, Member } from './types';

/** The line every finance screen carries. */
export const PRIVACY_LINE = 'Member privacy is protected: no member’s name or road name is shown on any transaction.';

/** Reads members' names on a fund's lines: whoever keeps its books, and the National Auditor. */
export function seesMemberNames(me: Member | null, chapterId: string | null, data: Pick<ClubData, 'positions'>): boolean {
  return keepsBooks(me, chapterId, data.positions) || isAuditor(me, data.positions);
}

function lineWithoutNames(e: LedgerEntry, me: Member | null, members: Member[]): LedgerEntry {
  const name = (e.payeeName ?? '').trim();
  const payeeName = e.payeeMemberId || (name && hideMemberNames(name, members) !== name) ? A_MEMBER : e.payeeName;
  return {
    ...e,
    description: hideMemberNames(e.description, members),
    payeeName,
    // Kept only when it's you, so a payment to yourself still can't be approved.
    payeeMemberId: e.payeeMemberId && e.payeeMemberId === me?.id ? e.payeeMemberId : null,
    paymentId: null,
    voidReason: e.voidReason ? hideMemberNames(e.voidReason, members) : e.voidReason,
  };
}

/** The club's data as this person may read its finances. Unchanged (the same object) when nothing is hidden. */
export function financesAsSeenBy(data: ClubData, me: Member | null): ClubData {
  const ledger = data.ledger;
  const hideLine = (e: LedgerEntry) => !seesMemberNames(me, e.chapterId, data);
  const linesChange = !!ledger?.some(hideLine);
  const notesChange = !keepsBooks(me, null, data.positions) && !isAuditor(me, data.positions) && !!data.meetingReports?.length;
  if (!linesChange && !notesChange) return data;
  return {
    ...data,
    ledger: linesChange ? ledger!.map((e) => (hideLine(e) ? lineWithoutNames(e, me, data.members) : e)) : ledger,
    meetingReports: notesChange
      ? data.meetingReports!.map((r) => ({ ...r, notes: hideMemberNames(r.notes, data.members) }))
      : data.meetingReports,
  };
}

/** A report going out as a PDF: names taken out of the notes and every line, since PDFs get passed around. */
export function forSharing<L extends Partial<Record<LedgerCode, LedgerEntry[]>> | undefined>(
  report: { notes: string; lines: L },
  members: Pick<Member, 'fullName' | 'roadName'>[],
): { notes: string; lines: L } {
  const lines = report.lines
    ? (Object.fromEntries(Object.entries(report.lines).map(([code, ls]) =>
      [code, (ls ?? []).map((e) => ({ ...e, description: hideMemberNames(e.description, members) }))])) as L)
    : report.lines;
  return { notes: hideMemberNames(report.notes, members), lines };
}

/** The line on the books screens for whoever reads names there: who sees them, and that nothing shared carries them. */
export const NAMES_HERE_LINE =
  'Only treasurers and the National Auditor see members’ names here. What members read, and every PDF, has them taken out.';

/** The privacy line for a screen: about one fund's books when given, else any fund this person reads. */
export function privacyLine(me: Member | null, data: Pick<ClubData, 'positions' | 'chapters'>, fund?: string | null): string {
  const funds = fund === undefined ? [null, ...data.chapters.map((c) => c.id)] : [fund];
  return funds.some((f) => seesMemberNames(me, f, data)) ? NAMES_HERE_LINE : PRIVACY_LINE;
}

/** On a member's own fees. */
export const FEES_PRIVATE = 'Your fees are private: only you, your board and the treasurers see them. Members never see who has paid.';
