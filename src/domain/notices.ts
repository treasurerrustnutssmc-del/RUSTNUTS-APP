// The 5.5 notice (constitution v4): before proposing a change in internal status, the Secretary or
// an appointed Officer gives the member the relevant record, the proposed consequence and at least
// 14 days to explain, correct an error or seek an exemption or payment arrangement. The board then
// decides at a meeting; that decision is a conduct record (src/domain/conduct.ts), not this. The
// database's give_status_notice, respond_to_notice and close_status_notice refuse with the same
// words, in the same order.

import { isBoardOf } from './access';
import { isIsoDate } from './conduct';
import { addDays, formatAuDate } from './dates';
import { isShareLine, type Standing } from './standing';
import type { ClubData, Member, NoticeAbout, NoticeOutcome, StatusNotice } from './types';

export const NOTICE_DAYS = 14;
export const MAX_RECORD = 2000;
export const MAX_PROPOSAL = 500;
export const MAX_RESPONSE = 2000;
export const MAX_OUTCOME_NOTE = 500;

export const NOTICE_BOARD_ONLY = 'Only their chapter’s board can give them notice (5.5).';
export const NOTICE_CLOSED = 'That notice is closed.';

export const ABOUT_LABEL: Record<NoticeAbout, string> = { attendance: 'Attendance', dues: 'Dues' };
const ABOUTS: string[] = ['attendance', 'dues'];
const OUTCOMES: string[] = ['withdrawn', 'decided'];
/** Who has an internal status a notice can be about. */
const NOTICE_STATUSES: string[] = ['fng', 'full', 'nomad', 'supporter'];

const length = (s: string) => [...s].length;

export interface NoticeInput {
  about: string;
  record: string;
  proposal: string;
  respondBy: string;
}

export const isOpen = (n: StatusNotice): boolean => n.outcome === null;

export const noticeOf = (id: string, data: ClubData): StatusNotice | undefined => (data.statusNotices ?? []).find((n) => n.id === id);

/** A member's open notices, newest first. */
export function openNoticesOf(memberId: string, data: ClubData): StatusNotice[] {
  return (data.statusNotices ?? [])
    .filter((n) => n.memberId === memberId && isOpen(n))
    .sort((a, b) => b.givenOn.localeCompare(a.givenOn));
}

/** Why `me` can't give `memberId` this notice today, or null. */
export function giveNoticeProblem(me: Member | null, memberId: string, input: NoticeInput, data: ClubData, today: string): string | null {
  const target = data.members.find((m) => m.id === memberId);
  if (!target) return 'That member no longer exists.';
  if (!isBoardOf(me, target.chapterId, data.positions)) return NOTICE_BOARD_ONLY;
  if (me!.id === target.id) return 'Someone else on the board has to give you notice.';
  if (target.approval !== 'approved' || !NOTICE_STATUSES.includes(target.status)) return 'Notice is for FNGs, Full Members, Nomads and Supporters.';
  if (!ABOUTS.includes(input.about)) return 'Say what it’s about: attendance or dues.';
  const record = input.record.trim();
  if (!record) return 'Set out the record.';
  if (length(record) > MAX_RECORD) return `Keep the record under ${MAX_RECORD} characters.`;
  const proposal = input.proposal.trim();
  if (!proposal) return 'Say what’s proposed.';
  if (length(proposal) > MAX_PROPOSAL) return `Keep the proposal under ${MAX_PROPOSAL} characters.`;
  if (!isIsoDate(input.respondBy)) return 'Pick a real date.';
  if (input.respondBy < addDays(today, NOTICE_DAYS)) return `Give them at least ${NOTICE_DAYS} days to respond (5.5).`;
  if (openNoticesOf(memberId, data).some((n) => n.about === input.about)) return 'They already have an open notice about that.';
  return null;
}

/** Why `me` can't reply to this notice, or null. Only the member, while it's open; a new reply replaces the last. */
export function respondProblem(me: Member | null, noticeId: string, response: string, data: ClubData): string | null {
  const n = noticeOf(noticeId, data);
  if (!n) return 'No such notice.';
  if (!me || me.id !== n.memberId) return 'Only the member can reply to their notice.';
  if (!isOpen(n)) return NOTICE_CLOSED;
  const text = response.trim();
  if (!text) return 'Write your reply.';
  if (length(text) > MAX_RESPONSE) return `Keep your reply under ${MAX_RESPONSE} characters.`;
  return null;
}

/**
 * Why `me` can't close this notice, or null. The member's chapter board, not the member: withdrawn
 * any time, decided only once the respond-by date has passed.
 */
export function closeNoticeProblem(
  me: Member | null, noticeId: string, outcome: NoticeOutcome, note: string, data: ClubData, today: string,
): string | null {
  const n = noticeOf(noticeId, data);
  if (!n) return 'No such notice.';
  if (!isBoardOf(me, n.chapterId, data.positions)) return 'Only their chapter’s board can do that.';
  if (me!.id === n.memberId) return 'Someone else on the board has to do that.';
  if (!isOpen(n)) return NOTICE_CLOSED;
  if (!OUTCOMES.includes(outcome)) return 'Pick withdrawn or decided.';
  if (length(note.trim()) > MAX_OUTCOME_NOTE) return `Keep the note under ${MAX_OUTCOME_NOTE} characters.`;
  if (outcome === 'decided' && today <= n.respondBy) return `The board decides after ${formatAuDate(n.respondBy)} (5.5).`;
  return null;
}

/** The record, filled in from where they stand, for the board to check and edit. */
export function noticeRecordFrom(standing: Standing): string {
  const lines = standing.lines.map((l) =>
    isShareLine(standing, l)
      ? l.held === 0 ? `${l.label}: none held yet` : `${l.label}: ${l.attended} of ${l.held} (needs ${l.needed})`
      : `${l.label}: ${l.attended} (needs ${l.needed}${l.upcoming ? `, ${l.upcoming} still to come` : ''})`,
  );
  return [`Since ${formatAuDate(standing.from)}:`, ...lines].join('\n');
}
