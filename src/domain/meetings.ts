// Meetings, minutes and action items: who sees them and who can change them. A meeting belongs to
// one chapter, run by its board, or to the whole club (chapterId null), run by the NEC. The
// database's actions (supabase/migrations/20270101000000_meetings_votes.sql) apply the same rules
// with the same words.

import { isBoardOf, isNational } from './access';
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

/** Runs a chapter (its board, or anyone on the NEC) or the whole club (the NEC). */
export function runsScope(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return chapterId === null ? isNational(me.id, positions) : isBoardOf(me, chapterId, positions);
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
  return isPrivateKind(meeting.kind) ? runsScope(me, meeting.chapterId, positions) : true;
}

const started = (meeting: Meeting, now: string) => new Date(now).getTime() >= new Date(meeting.startsAt).getTime();

/**
 * Everyone who sees a meeting sees its minutes once it's been held, as a draft until they're
 * confirmed (10.8). Before then, notes for the minutes stay with whoever runs it.
 */
export function canSeeMinutes(me: Member | null, meeting: Meeting, positions: Position[], now: string): boolean {
  if (!canSeeMeeting(me, meeting, positions)) return false;
  return meeting.minutesApprovedAt !== null || started(meeting, now) || runsScope(me, meeting.chapterId, positions);
}

export function canSeeActionItem(me: Member | null, item: ActionItem, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return item.ownerId === me.id || runsScope(me, item.chapterId, positions);
}

export function saveMeetingProblem(
  me: Member | null,
  input: MeetingInput,
  existing: Meeting | null | undefined,
  data: ClubData,
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
  return null;
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

/** 'draft': written and out to members once the meeting's held, waiting to be confirmed (10.8). */
export function minutesState(meeting: Meeting, now: string): 'upcoming' | 'cancelled' | 'approved' | 'draft' | 'due' | 'overdue' {
  if (meeting.cancelledAt) return 'cancelled';
  if (meeting.minutesApprovedAt) return 'approved';
  if (!started(meeting, now)) return 'upcoming';
  if (meeting.minutes?.trim()) return 'draft';
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
