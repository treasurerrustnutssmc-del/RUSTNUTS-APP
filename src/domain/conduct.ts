// Conduct records (constitution v4 6.9 and section 14): a short factual record of a conduct
// decision, which deletes itself 12 months on, and the member's review or appeal of it. The
// database's actions (supabase/migrations/20270420000000_board_admin.sql) refuse with the same
// words, in the same order.

import { isBoardOf } from './access';
import { addDays, formatAuDate } from './dates';
import { signedInProblem } from './meetings';
import { addMonths } from './profile';
import type { AppealOutcome, ClubData, ConductKind, ConductRecord, Member } from './types';

export const CONDUCT_KINDS: ConductKind[] = ['vest', 'ride_safety', 'attendance', 'other', 'reprimand', 'suspension', 'expulsion'];

export const KIND_LABEL: Record<ConductKind, string> = {
  vest: 'Vest',
  ride_safety: 'Ride safety',
  attendance: 'Attendance',
  other: 'Other internal',
  reprimand: 'Reprimand',
  suspension: 'Suspension',
  expulsion: 'Expulsion',
};

/** Formal Association discipline (14.4): appealed within 7 days of the vote, not reviewed. */
export const isFormal = (kind: ConductKind): boolean => kind === 'reprimand' || kind === 'suspension' || kind === 'expulsion';

/** "review" for an internal decision, "appeal" for a formal outcome. */
export const appealWord = (kind: ConductKind): string => (isFormal(kind) ? 'appeal' : 'review');

/** How long a record is kept (6.9), and the longest a hold can keep it (inferred: 13.5's 7 years). */
export const KEEP_MONTHS = 12;
export const MAX_HOLD_MONTHS = 84;
/** Days to ask: 14 from written notice for a review (14.6A), 7 from the vote for an appeal (14.4B). */
export const REVIEW_DAYS = 14;
export const APPEAL_DAYS = 7;
/** Hearing within 21 days of lodging (14.6, 14.6B); a review's decision within 14 of the hearing (14.6B). */
export const HEARING_DAYS = 21;
export const DECISION_DAYS = 14;

export const MAX_SUMMARY = 1000;
export const MAX_RULE = 200;
export const MAX_HOLD_REASON = 300;
export const MAX_GROUNDS = 1000;

export const NO_RECORD = 'No such record.';
export const NOT_CONDUCT_BOARD = 'Only that member’s chapter board or the NEC can do that.';
export const ABOUT_YOURSELF = 'You can’t record one about yourself.';
export const NO_APPEAL = 'No review or appeal is lodged.';
export const SETTLED = 'That one is settled.';

const length = (s: string) => [...s].length;
const max = (a: string, b: string) => (a > b ? a : b);

/** A real calendar date, written YYYY-MM-DD. */
export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The first day the record is gone: 12 months after the decision (or after a suspension ends,
 * when later), or the day after a hold runs out, whichever is later (6.9).
 */
export function deleteOn(r: Pick<ConductRecord, 'decidedOn' | 'suspendedUntil' | 'holdUntil'>): string {
  const base = addMonths(max(r.decidedOn, r.suspendedUntil ?? r.decidedOn), KEEP_MONTHS);
  return r.holdUntil ? max(base, addDays(r.holdUntil, 1)) : base;
}

export const appealOpen = (r: Pick<ConductRecord, 'appeal'>): boolean =>
  r.appeal !== null && r.appeal.outcome === null && r.appeal.withdrawnOn === null;

/** Still kept: before its day, or while its review or appeal is open. */
export const isKept = (r: ConductRecord, today: string): boolean => appealOpen(r) || today < deleteOn(r);

/** The last day to lodge a review (14 days from notice) or an appeal (7 days from the vote). */
export const appealBy = (r: Pick<ConductRecord, 'kind' | 'decidedOn' | 'noticeOn'>): string =>
  isFormal(r.kind) ? addDays(r.decidedOn, APPEAL_DAYS) : addDays(r.noticeOn, REVIEW_DAYS);

export const hearingDueOn = (lodgedOn: string): string => addDays(lodgedOn, HEARING_DAYS);
export const decisionDueOn = (hearingOn: string): string => addDays(hearingOn, DECISION_DAYS);

export function outcomeLabel(kind: ConductKind, outcome: AppealOutcome): string {
  if (isFormal(kind)) return outcome === 'set_aside' ? 'Revoked' : 'Upheld';
  return outcome === 'confirmed' ? 'Confirmed' : outcome === 'varied' ? 'Varied' : 'Set aside';
}

/** The member's chapter now, so a record follows them when they move (12.4). */
export const conductChapter = (r: Pick<ConductRecord, 'memberId' | 'chapterId'>, data: ClubData): string =>
  data.members.find((m) => m.id === r.memberId)?.chapterId ?? r.chapterId;

/** The member, their chapter's board, the NEC, and the panel hearing it. */
export function seesConduct(me: Member | null, r: ConductRecord, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return me.id === r.memberId || isBoardOf(me, conductChapter(r, data), data.positions) || (r.appeal?.panelIds ?? []).includes(me.id);
}

/** Every record this viewer may see that's still kept, newest decision first. */
export function visibleConduct(me: Member | null, data: ClubData, today: string): ConductRecord[] {
  return (data.conduct ?? [])
    .filter((r) => isKept(r, today) && seesConduct(me, r, data))
    .sort((a, b) => b.decidedOn.localeCompare(a.decidedOn) || b.recordedAt.localeCompare(a.recordedAt));
}

export const conductFor = (memberId: string, me: Member | null, data: ClubData, today: string): ConductRecord[] =>
  visibleConduct(me, data, today).filter((r) => r.memberId === memberId);

const findRecord = (me: Member | null, id: string, data: ClubData, today: string) =>
  visibleConduct(me, data, today).find((r) => r.id === id);

// ---------------------------------------------------------------------------------------------

export interface ConductInput {
  memberId: string;
  kind: ConductKind | null;
  summary: string;
  rule: string;
  /** ISO dates; '' when not picked. */
  decidedOn: string;
  /** Internal decisions only; a formal outcome's notice is its decision date. */
  noticeOn: string;
  /** Suspensions only. */
  suspendedUntil: string | null;
}

export function recordConductProblem(me: Member | null, input: ConductInput, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const member = data.members.find((m) => m.id === input.memberId);
  if (!member || member.approval !== 'approved') return 'Pick an approved member.';
  if (member.id === me!.id) return ABOUT_YOURSELF;
  if (!isBoardOf(me, member.chapterId, data.positions)) return NOT_CONDUCT_BOARD;
  if (!input.kind) return 'Pick what kind of record it is.';
  const summary = input.summary.trim();
  if (!summary) return 'Say what happened.';
  if (length(summary) > MAX_SUMMARY) return 'Keep what happened to 1000 characters at most.';
  if (length(input.rule.trim()) > MAX_RULE) return 'Keep the rule to 200 characters at most.';
  if (!isIsoDate(input.decidedOn)) return 'Pick the date of the decision.';
  if (input.decidedOn > today) return 'The decision can’t be in the future.';
  const suspended = input.kind === 'suspension' ? input.suspendedUntil : null;
  if (input.kind === 'suspension' && (!isIsoDate(suspended) || suspended <= input.decidedOn)) return 'Pick when the suspension ends.';
  if (today >= deleteOn({ decidedOn: input.decidedOn, suspendedUntil: suspended, holdUntil: null })) {
    return 'That decision is more than 12 months old, so it isn’t kept.';
  }
  if (!isFormal(input.kind)) {
    if (!isIsoDate(input.noticeOn)) return 'Pick when written notice was given.';
    if (input.noticeOn < input.decidedOn) return 'Written notice can’t come before the decision.';
    if (input.noticeOn > today) return 'Written notice can’t be in the future.';
  }
  return null;
}

/** Found, and the board or NEC acting on someone else's record. */
function boardOnRecord(me: Member | null, id: string, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const r = findRecord(me, id, data, today);
  if (!r) return NO_RECORD;
  if (!isBoardOf(me, conductChapter(r, data), data.positions)) return NOT_CONDUCT_BOARD;
  if (r.memberId === me!.id) return ABOUT_YOURSELF;
  return null;
}

/** Keeps a record through `until` for an active matter (6.9); null lets go of the hold. */
export function holdProblem(me: Member | null, id: string, until: string | null, reason: string, data: ClubData, today: string): string | null {
  const base = boardOnRecord(me, id, data, today);
  if (base || until === null) return base;
  const why = reason.trim();
  if (!why) return 'Say which matter needs it kept.';
  if (length(why) > MAX_HOLD_REASON) return 'Keep the reason to 300 characters at most.';
  if (!isIsoDate(until) || until <= today) return 'Pick a date after today.';
  if (until > addMonths(today, MAX_HOLD_MONTHS)) return 'Hold it at most 7 years.';
  return null;
}

/** Takes away a record made by mistake. */
export const removeConductProblem = (me: Member | null, id: string, data: ClubData, today: string): string | null =>
  boardOnRecord(me, id, data, today);

export function lodgeProblem(me: Member | null, id: string, grounds: string, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const r = findRecord(me, id, data, today);
  if (!r) return NO_RECORD;
  if (me!.id !== r.memberId && !isBoardOf(me, conductChapter(r, data), data.positions)) return 'Only the member or their board can lodge this.';
  if (r.appeal) return 'A review or appeal has already been lodged.';
  const why = grounds.trim();
  if (!why) return 'Say why.';
  if (length(why) > MAX_GROUNDS) return 'Keep it to 1000 characters at most.';
  if (today > appealBy(r)) return `The window closed on ${formatAuDate(appealBy(r))}.`;
  return null;
}

/** Found, with a review or appeal that's still open. */
function openAppeal(me: Member | null, id: string, data: ClubData, today: string): { problem: string } | { record: ConductRecord } {
  const signedIn = signedInProblem(me);
  if (signedIn) return { problem: signedIn };
  const r = findRecord(me, id, data, today);
  if (!r) return { problem: NO_RECORD };
  if (!r.appeal) return { problem: NO_APPEAL };
  if (!appealOpen(r)) return { problem: SETTLED };
  return { record: r };
}

export function hearingProblem(
  me: Member | null, id: string, panelIds: string[], hearingOn: string, data: ClubData, today: string,
): string | null {
  const found = openAppeal(me, id, data, today);
  if ('problem' in found) return found.problem;
  const r = found.record;
  if (!isBoardOf(me, conductChapter(r, data), data.positions) || me!.id === r.memberId || me!.id === r.recordedBy) {
    return 'Only the board or NEC, apart from whoever recorded it, can set up the hearing.';
  }
  if (panelIds.length !== 3 || new Set(panelIds).size !== 3) return 'Pick three different people.';
  const fit = (pid: string) => data.members.some((m) => m.id === pid && m.approval === 'approved' && m.status !== 'legacy');
  if (!panelIds.every(fit)) return 'Pick approved members for the panel.';
  if (panelIds.some((pid) => pid === r.memberId || pid === r.recordedBy)) return 'The panel can’t include the member or whoever recorded it.';
  if (!isIsoDate(hearingOn) || hearingOn < r.appeal!.lodgedOn) return 'Pick the hearing date.';
  return null;
}

export function outcomeProblem(
  me: Member | null, id: string, outcome: AppealOutcome, note: string, data: ClubData, today: string,
): string | null {
  const found = openAppeal(me, id, data, today);
  if ('problem' in found) return found.problem;
  const r = found.record;
  const a = r.appeal!;
  if (!a.panelIds.includes(me!.id) || a.hearingOn === null) return 'Only the hearing panel can record the outcome.';
  if (today < a.hearingOn) return 'Wait until the hearing.';
  if (outcome === 'varied' && isFormal(r.kind)) return 'A formal appeal is upheld or revoked (14.6).';
  const text = note.trim();
  if (outcome === 'varied' && !text) return 'Say how it was varied.';
  if (length(text) > MAX_GROUNDS) return 'Keep it to 1000 characters at most.';
  return null;
}

export function withdrawProblem(me: Member | null, id: string, data: ClubData, today: string): string | null {
  const found = openAppeal(me, id, data, today);
  if ('problem' in found) return found.problem;
  return found.record.memberId === me!.id ? null : 'Only the member can withdraw it.';
}

/** Board seats this viewer can record conduct for: anyone they're on the board or NEC over. */
export const recordsConductFor = (me: Member | null, data: ClubData): boolean =>
  !!me && me.approval === 'approved' && data.chapters.some((c) => isBoardOf(me, c.id, data.positions));
