// Meetings, minutes and action items: who sees them and who can change them. A meeting belongs to
// one chapter, run by its board, or to the whole club (chapterId null), run by the NEC. The
// database's actions (supabase/migrations/20270101000000_meetings_votes.sql) apply the same rules
// with the same words.

import { isAuditor, isBoardOf, isNational, seesBoardOf } from './access';
import { kindsFor } from './labels';
import { melbourneDate } from './rides';
import type { ActionItem, AgendaItem, ClubData, Meeting, MeetingKind, Member, Position } from './types';

/** Minutes go out within seven days of the meeting (constitution 10.8). */
export const MINUTES_DUE_DAYS = 7;

export interface MeetingInput {
  id: string | null;
  chapterId: string | null;
  kind: MeetingKind;
  title: string;
  startsAt: string;
  location: string | null;
  agenda: AgendaItem[];
}

export interface ActionItemInput {
  id: string | null;
  chapterId: string | null;
  meetingId: string | null;
  title: string;
  ownerId: string;
  dueOn: string | null;
}

/** An ISO date plus some days. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const approved = (me: Member | null): me is Member => !!me && me.approval === 'approved';

/** Runs a chapter (its seated board, 8.2) or the whole club (the NEC). Mirrors private.runs_scope. */
export function runsScope(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return chapterId === null ? isNational(me.id, positions) : isBoardOf(me, chapterId, positions);
}

/**
 * Sees a scope's private business (board and NEC meetings, draft minutes, votes, draft merch): a
 * chapter's by its board or anyone national, the club's by the NEC. Mirrors private.sees_scope.
 */
export function seesScope(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return chapterId === null ? isNational(me.id, positions) : seesBoardOf(me, chapterId, positions);
}

/** Reads a scope's private business: whoever sees it, or the Auditor (11.8). Mirrors private.reviews_scope. */
export function reviewsScope(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  return seesScope(me, chapterId, positions) || isAuditor(me, positions);
}

export function scopeRefusal(chapterId: string | null): string {
  return chapterId === null ? 'Only the NEC can do that.' : 'Only that chapter’s board can do that.';
}

/** Session and approval, the first two checks of every action. */
export function signedInProblem(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  return null;
}

const isPrivateKind = (kind: MeetingKind) => kind === 'board' || kind === 'nec';

export function canSeeMeeting(me: Member | null, meeting: Meeting, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return isPrivateKind(meeting.kind) ? reviewsScope(me, meeting.chapterId, positions) : true;
}

const started = (meeting: Meeting, now: string) => new Date(now).getTime() >= new Date(meeting.startsAt).getTime();

/**
 * Everyone who sees a meeting sees its minutes once the board shares the draft, marked as a draft
 * until they're confirmed (10.8). Until then, notes for the minutes stay with whoever runs it.
 */
export function canSeeMinutes(me: Member | null, meeting: Meeting, positions: Position[]): boolean {
  if (!canSeeMeeting(me, meeting, positions)) return false;
  return meeting.minutesApprovedAt !== null || !!meeting.minutesSharedAt || reviewsScope(me, meeting.chapterId, positions);
}

export function canSeeActionItem(me: Member | null, item: ActionItem, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return item.ownerId === me.id || reviewsScope(me, item.chapterId, positions);
}

/**
 * The days' notice a meeting needs, and how a refusal names it (constitution v4 10.4, 11.5).
 * Board meetings have no notice rule. NEC meetings need 7 days but may go ahead sooner when urgent,
 * so they only warn.
 */
function noticeRule(kind: MeetingKind, chapterId: string | null): { days: number; name: string } | null {
  if (chapterId !== null) {
    if (kind === 'general') return { days: 7, name: 'A chapter meeting' };
    if (kind === 'special') return { days: 7, name: 'A special meeting' };
    if (kind === 'agm') return { days: 14, name: 'An Annual Chapter Meeting' };
    return null;
  }
  if (kind === 'general' || kind === 'special') return { days: 14, name: 'A National Club meeting' };
  if (kind === 'agm') return { days: 14, name: 'The Association AGM' };
  return null;
}

const NEC_NOTICE_DAYS = 7;
const DAY_MS = 86_400_000;
const msOf = (iso: string) => new Date(iso).getTime();

/**
 * Notice counts when a meeting is called, moved earlier, or changed into another kind, for a time
 * still to come. A meeting dated in the past is a record of one already held.
 */
function noticeApplies(input: MeetingInput, existing: Meeting | null | undefined, now: string): boolean {
  if (msOf(input.startsAt) <= msOf(now)) return false;
  if (!existing) return true;
  // Moved earlier, brought back from the past, or turned into another kind of meeting.
  return (
    msOf(input.startsAt) < msOf(existing.startsAt) ||
    msOf(existing.startsAt) <= msOf(now) ||
    input.kind !== existing.kind ||
    input.chapterId !== existing.chapterId
  );
}

function noticeProblem(input: MeetingInput, existing: Meeting | null | undefined, now: string): string | null {
  const rule = noticeRule(input.kind, input.chapterId);
  if (!rule || !noticeApplies(input, existing, now)) return null;
  return msOf(input.startsAt) - msOf(now) < rule.days * DAY_MS ? `${rule.name} needs ${rule.days} days’ notice (10.4).` : null;
}

/** The notice a kind of meeting needs, for the form ("Needs 14 days’ notice (10.4)."), or null. */
export function noticeLine(kind: MeetingKind, chapterId: string | null): string | null {
  if (kind === 'nec') return `Needs ${NEC_NOTICE_DAYS} days’ notice, unless it’s urgent (11.5).`;
  const rule = noticeRule(kind, chapterId);
  return rule ? `Needs ${rule.days} days’ notice (10.4).` : null;
}

/** The NEC's short-notice warning, shown on the form (it doesn't refuse). */
export function noticeWarning(input: MeetingInput, now: string, existing: Meeting | null = null): string | null {
  if (input.kind !== 'nec' || !input.startsAt || !noticeApplies(input, existing, now)) return null;
  return msOf(input.startsAt) - msOf(now) < NEC_NOTICE_DAYS * DAY_MS
    ? 'NEC meetings need 7 days’ notice unless most of the NEC agree to an urgent one (11.5).'
    : null;
}

export function saveMeetingProblem(
  me: Member | null,
  input: MeetingInput,
  existing: Meeting | null | undefined,
  data: ClubData,
  now: string,
): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (input.id !== null && !existing) return 'No such meeting.';
  if (existing && !runsScope(me, existing.chapterId, data.positions)) return scopeRefusal(existing.chapterId);
  if (!runsScope(me, input.chapterId, data.positions)) return scopeRefusal(input.chapterId);
  if (existing?.cancelledAt) return 'That meeting was cancelled.';
  if (!input.title.trim()) return 'Give the meeting a title.';
  if (!input.startsAt) return 'Pick a date and time.';
  if (!kindsFor(input.chapterId).includes(input.kind)) return 'That kind of meeting doesn’t fit here.';
  if (input.agenda.some((a) => !a.title.trim())) return 'Each agenda item needs a title.';
  return noticeProblem(input, existing, now);
}

function meetingProblem(me: Member | null, meeting: Meeting | undefined, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!meeting) return 'No such meeting.';
  if (!runsScope(me, meeting.chapterId, data.positions)) return scopeRefusal(meeting.chapterId);
  if (meeting.cancelledAt) return 'That meeting was cancelled.';
  return null;
}


export function cancelMeetingProblem(me: Member | null, meeting: Meeting | undefined, data: ClubData, now: string): string | null {
  return meetingProblem(me, meeting, data) ?? (started(meeting!, now) ? 'That meeting has already started.' : null);
}

export function saveMinutesProblem(me: Member | null, meeting: Meeting | undefined, data: ClubData): string | null {
  return meetingProblem(me, meeting, data) ?? (meeting!.minutesApprovedAt ? 'Those minutes are approved and locked.' : null);
}

/** The board sends the draft to members after the meeting, within seven days (10.8). */
export function shareMinutesProblem(me: Member | null, meeting: Meeting | undefined, data: ClubData, now: string): string | null {
  const problem = approveMinutesProblem(me, meeting, data, now);
  if (problem) return problem;
  if (meeting!.minutesSharedAt) return 'The draft is already out to members.';
  return null;
}

export function approveMinutesProblem(me: Member | null, meeting: Meeting | undefined, data: ClubData, now: string): string | null {
  const problem = saveMinutesProblem(me, meeting, data);
  if (problem) return problem;
  if (!started(meeting!, now)) return 'The meeting hasn’t happened yet.';
  if (!meeting!.minutes?.trim()) return 'Write the minutes first.';
  return null;
}

/** The Melbourne date the minutes are due. */
export function minutesDueOn(meeting: Meeting): string {
  return addDays(melbourneDate(meeting.startsAt), MINUTES_DUE_DAYS);
}

/** 'draft': shared with members, waiting to be confirmed at the next meeting (10.8). */
export function minutesState(meeting: Meeting, now: string): 'upcoming' | 'cancelled' | 'approved' | 'draft' | 'due' | 'overdue' {
  if (meeting.cancelledAt) return 'cancelled';
  if (meeting.minutesApprovedAt) return 'approved';
  if (!started(meeting, now)) return 'upcoming';
  if (meeting.minutesSharedAt) return 'draft';
  return melbourneDate(now) > minutesDueOn(meeting) ? 'overdue' : 'due';
}

/** Who can own an action item in this scope: approved, not Legacy, and in the chapter. */
export function canOwnAction(member: Member | undefined, chapterId: string | null): boolean {
  if (!member || member.approval !== 'approved' || member.status === 'legacy') return false;
  return chapterId === null || member.chapterId === chapterId;
}

export function actionItemProblem(me: Member | null, input: ActionItemInput, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const existing = input.id === null ? null : (data.actionItems ?? []).find((a) => a.id === input.id);
  if (input.id !== null && !existing) return 'No such action item.';
  const chapterId = existing ? existing.chapterId : input.chapterId;
  if (!runsScope(me, chapterId, data.positions)) return scopeRefusal(chapterId);
  if (!existing && input.meetingId !== null) {
    const meeting = (data.meetings ?? []).find((x) => x.id === input.meetingId);
    if (!meeting || meeting.chapterId !== input.chapterId) return 'No such meeting.';
  }
  if (!input.title.trim()) return 'Give the action item a title.';
  if (!canOwnAction(data.members.find((x) => x.id === input.ownerId), chapterId)) {
    return 'Pick an approved member of this chapter.';
  }
  return null;
}

export function setDoneProblem(me: Member | null, item: ActionItem | undefined, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!item) return 'No such action item.';
  if (item.ownerId === me!.id || runsScope(me, item.chapterId, data.positions)) return null;
  return 'Only the owner or the board can tick this off.';
}
