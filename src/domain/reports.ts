// Reporting what members post outside the chats: a swap and sell listing, a build update, a
// bragging rights nomination, a workshop on the who-can-help list, or a member's profile (their
// bio). One board queue beside the chat reports. The database's report_content,
// content_reports, resolve_content_report and my_open_reports apply the same rules with the same
// words, in the same order (supabase/migrations/20270600000000_member_content_rules.sql).

import { isBoardOf } from './access';
import { charCount, MAX_REASON } from './chat';
import { isAnyBoard } from './social/help';
import type { Member, Position } from './types';

export const REPORT_KINDS = ['listing', 'build_update', 'nomination', 'mechanic', 'profile'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  listing: 'Listing',
  build_update: 'Build update',
  nomination: 'Nomination',
  mechanic: 'Workshop',
  profile: 'Profile',
};

/** The thing being reported, as far as the rules care: who posted it and whether it's still up. */
export interface ReportTarget {
  kind: ReportKind;
  id: string;
  authorId: string;
  /** Taken down, withdrawn, off the list, or (for a profile) the member isn't approved. */
  gone: boolean;
  /** What was there when it was reported, for whoever deals with it. */
  snapshot: string;
}

export interface ContentReport {
  id: string;
  kind: ReportKind;
  targetId: string;
  authorId: string;
  reporterId: string;
  reason: string | null;
  snapshot: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  outcome: 'removed' | 'dismissed' | null;
}

/** Something the member has reported that the board hasn't dealt with yet (hidden from them). */
export interface OpenReportRef {
  /** A chat message, or one of the content kinds. */
  kind: 'message' | ReportKind;
  targetId: string;
}

export const BAD_REPORT_KIND = 'Pick what you’re reporting.';
export const REPORT_GONE = 'No such report.';
export const REPORT_DEALT_WITH = 'That report was already dealt with.';
export const NOT_REPORT_BOARD = 'Only the board can do that.';
export const NOT_MEMBER_BOARD = 'Only that member’s chapter board can do that.';
export const REASON_TOO_LONG = 'Keep the reason under 500 characters.';

const MISSING: Record<ReportKind, string> = {
  listing: 'No such listing.',
  build_update: 'No such update.',
  nomination: 'No such nomination.',
  mechanic: 'No such workshop.',
  profile: 'That member no longer exists.',
};
const GONE: Record<ReportKind, string> = {
  listing: 'That listing has been taken down.',
  build_update: 'That update has been taken down.',
  nomination: 'That nomination has been withdrawn.',
  mechanic: 'That workshop is off the list.',
  profile: 'They’re not an approved member.',
};
const OWN: Record<ReportKind, string> = {
  listing: 'You can’t report your own listing.',
  build_update: 'You can’t report your own update.',
  nomination: 'You can’t report your own nomination.',
  mechanic: 'You can’t report your own workshop.',
  profile: 'You can’t report your own profile.',
};

export const missingWords = (kind: ReportKind) => MISSING[kind];
export const goneWords = (kind: ReportKind) => GONE[kind];

/** Why `me` can't use the chats or report anything: not signed in, or not an approved member. */
function approvedProblem(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved' || me.status === 'family') return 'Only approved members can do that.';
  return null;
}

/**
 * Why `me` can't report this, or null. `target` is undefined when there's no such thing. Mirrors
 * public.report_content.
 */
export function reportContentProblem(me: Member | null, kind: string, target: ReportTarget | undefined, reason: string): string | null {
  const notIn = approvedProblem(me);
  if (notIn || !me) return notIn;
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) return BAD_REPORT_KIND;
  const k = kind as ReportKind;
  if (!target) return MISSING[k];
  if (target.gone) return GONE[k];
  if (target.authorId === me.id) return OWN[k];
  if (charCount(reason) > MAX_REASON) return REASON_TOO_LONG;
  return null;
}

/**
 * Who deals with a report: a profile goes to that member's chapter board (who manage them); the
 * rest to any board member or the NEC, who can take those things down anyway. Mirrors
 * private.can_act_on_content_report. `author` is the member who posted it (for a profile, its
 * subject).
 */
export function canActOnContentReport(me: Member | null, report: Pick<ContentReport, 'kind'>, author: Member | undefined, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (report.kind === 'profile') return !!author && isBoardOf(me, author.chapterId, positions);
  return isAnyBoard(me, positions);
}

/** Why `me` can't deal with this report, or null. Mirrors public.resolve_content_report. */
export function resolveContentReportProblem(
  me: Member | null,
  report: ContentReport | undefined,
  author: Member | undefined,
  positions: Position[],
): string | null {
  const notIn = approvedProblem(me);
  if (notIn) return notIn;
  if (!report) return REPORT_GONE;
  if (!canActOnContentReport(me, report, author, positions)) return report.kind === 'profile' ? NOT_MEMBER_BOARD : NOT_REPORT_BOARD;
  if (report.resolvedAt) return REPORT_DEALT_WITH;
  return null;
}

/** Keeps only what the member hasn't reported (an open report hides the thing from them at once). */
export function withoutReported<T extends { id: string }>(items: T[], kind: OpenReportRef['kind'], mine: OpenReportRef[]): T[] {
  if (!mine.length) return items;
  const hidden = new Set(mine.filter((r) => r.kind === kind).map((r) => r.targetId));
  return hidden.size ? items.filter((x) => !hidden.has(x.id)) : items;
}

/** Has the member reported this and not heard back yet? */
export function reportedByMe(kind: OpenReportRef['kind'], targetId: string, mine: OpenReportRef[]): boolean {
  return mine.some((r) => r.kind === kind && r.targetId === targetId);
}

/** What the board reads on the card: "Reported. The board will look at it within 24 hours." */
export const REPORTED_NOTE = 'Reported. The board will look at it within 24 hours.';
