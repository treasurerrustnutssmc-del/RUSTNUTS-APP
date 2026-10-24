// The way in: the introduction phase (constitution 3.2), the board's decision, and the FNG
// reviews at 6, 9 and 12 months and every 3 months after (5.2, 5.4, 5.5). The database's
// decide_application and record_fng_review actions apply the same rules with the same words.

import { isBoardOf } from './access';
import { attendanceCount } from './attendance';
import { daysBetween } from './dates';
import { APPROVE_AS } from './labels';
import { addMonths } from './profile';
import type { ClubData, DecisionOutcome, Member, MemberDecision, MemberStatus, Votes } from './types';

export const INTRO = { months: 3, meetings: 2, rides: 1 };

export interface IntroProgress {
  startedOn: string;
  endsOn: string;
  daysLeft: number;
  meetings: number;
  rides: number;
  timeDone: boolean;
  meetingsDone: boolean;
  ridesDone: boolean;
  ready: boolean;
}

/** How far through the introduction phase someone is, counted from the day they asked to join. */
export function introProgress(member: Member, data: ClubData, today: string): IntroProgress {
  const startedOn = member.appliedOn ?? member.joinedOn ?? today;
  const endsOn = addMonths(startedOn, INTRO.months);
  const { meetings, rides } = attendanceCount(member.id, data, startedOn);
  const timeDone = today >= endsOn;
  const meetingsDone = meetings >= INTRO.meetings;
  const ridesDone = rides >= INTRO.rides;
  return {
    startedOn,
    endsOn,
    daysLeft: Math.max(0, daysBetween(today, endsOn)),
    meetings,
    rides,
    timeDone,
    meetingsDone,
    ridesDone,
    ready: timeDone && meetingsDone && ridesDone,
  };
}

export interface FngDue {
  atMonths: number;
  date: string;
  overdue: boolean;
}

/**
 * The FNG review that's due: of the slots after the last one recorded (6, 9, 12, 15 …), the latest
 * whose day has come, or else the next one coming.
 */
export function fngDue(member: Member, decisions: MemberDecision[], today: string): FngDue | null {
  if (member.status !== 'fng' || !member.fngStartedOn) return null;
  const last = decisions
    .filter((d) => d.memberId === member.id && d.kind === 'fng_review' && d.atMonths !== null)
    .reduce((max, d) => Math.max(max, d.atMonths!), 0);
  let months = Math.max(6, last + 3);
  while (addMonths(member.fngStartedOn, months + 3) <= today) months += 3;
  const date = addMonths(member.fngStartedOn, months);
  return { atMonths: months, date, overdue: date < today };
}

export function fngReviews(memberId: string, decisions: MemberDecision[]): MemberDecision[] {
  return decisions
    .filter((d) => d.memberId === memberId && d.kind === 'fng_review')
    .sort((a, b) => (a.atMonths ?? 0) - (b.atMonths ?? 0));
}

export function votesProblem(v: Votes): string | null {
  const bad = [v.for, v.against, v.abstained].some((n) => n !== null && (!Number.isInteger(n) || n < 0));
  return bad ? 'Vote counts can’t be negative.' : null;
}

/** Approving (as `status`) or declining (null) an applicant, with the board's tally. */
export function decideApplicationProblem(
  me: Member | null,
  target: Member,
  status: MemberStatus | null,
  votes: Votes,
  data: ClubData,
): string | null {
  if (!isBoardOf(me, target.chapterId, data.positions)) {
    if (status === null) return 'Only that chapter’s board can decline this applicant.';
    const chapter = data.chapters.find((c) => c.id === target.chapterId)?.name ?? 'that chapter’s';
    return `Only the ${chapter} board can approve this applicant.`;
  }
  if (target.approval !== 'pending') return 'This person isn’t waiting for approval.';
  if (status !== null && !APPROVE_AS.includes(status)) return 'Let them in as Introduced, FNG, Supporter or Family.';
  return votesProblem(votes);
}

export type FngOutcome = Extract<DecisionOutcome, 'continue' | 'patch' | 'not_continuing'>;

/** Reviews can be recorded up to this many days before they fall due. */
export const REVIEW_EARLY_DAYS = 30;

export function fngReviewProblem(
  me: Member | null,
  target: Member,
  atMonths: number,
  outcome: FngOutcome,
  votes: Votes,
  data: ClubData,
  today: string,
): string | null {
  if (!me) return 'Sign in first.';
  if (me.id === target.id) return 'You can’t record your own review.';
  if (!isBoardOf(me, target.chapterId, data.positions)) return 'Only that chapter’s board can record this review.';
  const due = fngDue(target, data.decisions ?? [], today);
  if (!due) return 'They’re not an FNG.';
  if (atMonths !== due.atMonths) return 'Record the review that’s due.';
  if (daysBetween(today, due.date) > REVIEW_EARLY_DAYS) return 'That review isn’t due yet.';
  const v = votesProblem(votes);
  if (v) return v;
  if (outcome === 'patch' && !((votes.for ?? 0) >= 1 && votes.against === 0)) {
    return 'Full membership needs a unanimous vote: at least one for and none against.';
  }
  return null;
}

export function fngOutcomeStatus(outcome: FngOutcome): Extract<MemberStatus, 'fng' | 'full' | 'supporter'> {
  return outcome === 'patch' ? 'full' : outcome === 'not_continuing' ? 'supporter' : 'fng';
}
