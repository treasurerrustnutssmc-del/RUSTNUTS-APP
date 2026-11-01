// Minutes from an Otter transcript: what the phone checks before and after the club's AI drafts
// them, who goes in the people list, which check-in a meeting's attendance goes to, and what
// "Use this draft" saves. Saving goes through the app's existing actions (save_minutes,
// mark_attendance, action items), so nobody can do more here than with the usual buttons.
// Spec: docs/superpowers/specs/2026-11-01-otter-minutes-design.md

import type { MinutesDraft, MinutesPerson } from '../../supabase/functions/_shared/minutesDraft';
import { markProblem } from './attendance';
import { canOwnAction, saveMinutesProblem, type ActionItemInput } from './meetings';
import { melbourneDate } from './rides';
import type { CheckinSession, ClubData, Meeting, Member } from './types';

export type { MinutesDraft, MinutesPerson } from '../../supabase/functions/_shared/minutesDraft';

/** About three hours of talk; Otter's text export runs ~5,000 characters a 10 minutes. */
export const TRANSCRIPT_MAX = 200_000;
export const TRANSCRIPT_MIN = 200;

export function transcriptProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Pick the Otter transcript or paste it in.';
  // A .docx is a zip ("PK"), a PDF starts "%PDF": read as text they're gibberish.
  if (t.startsWith('PK\u0003\u0004') || t.startsWith('%PDF')) return 'Export it from Otter as Text (.txt), not Word or PDF.';
  if (t.length > TRANSCRIPT_MAX) return 'That transcript is too long (about 3 hours is the most). Split it in two.';
  if (t.length < TRANSCRIPT_MIN) return 'That’s too short to be a meeting. Check you have the whole transcript.';
  return null;
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

const started = (meeting: Meeting, now: string) => new Date(now).getTime() >= new Date(meeting.startsAt).getTime();

/** Same people as writing the minutes by hand, once the meeting has started. */
export function draftMinutesProblem(me: Member | null, meeting: Meeting | undefined, data: ClubData, now: string): string | null {
  const problem = saveMinutesProblem(me, meeting, data);
  if (problem) return problem;
  return started(meeting!, now) ? null : 'The meeting hasn’t happened yet.';
}

/**
 * Who could have been at the meeting, for matching names: approved members other than Family
 * (members from the other chapter visit), and for a chapter meeting its introduced applicants.
 * Mirrors public.minutes_draft_start.
 */
export function minutesPeople(meeting: Meeting, data: ClubData): MinutesPerson[] {
  const chapterName = new Map(data.chapters.map((c) => [c.id, c.name]));
  return data.members
    .filter((m) =>
      m.approval === 'approved'
        ? m.status !== 'family'
        : meeting.chapterId !== null && m.approval === 'pending' && m.status === 'introduced' && m.chapterId === meeting.chapterId,
    )
    .map((m) => ({ id: m.id, name: m.fullName, roadName: m.roadName, chapter: chapterName.get(m.chapterId) ?? null, status: m.status }));
}

const BAD_DRAFT = 'The draft didn’t come back properly. Try again.';
const EMPTY_DRAFT = 'The draft came back empty. Check the transcript and try again.';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The draft as it came back, checked against the people that were sent: an id that wasn't sent is
 * left unmatched, the same person isn't listed twice, and anything without words is dropped.
 */
export function cleanDraft(raw: unknown, peopleIds: Set<string>): MinutesDraft | string {
  if (!isObject(raw) || typeof raw.minutes !== 'string') return BAD_DRAFT;
  const minutes = raw.minutes.trim();
  if (!minutes) return EMPTY_DRAFT;
  const known = (id: unknown) => (typeof id === 'string' && peopleIds.has(id) ? id : null);
  const people = (v: unknown) => {
    const seen = new Set<string>();
    return list(v)
      .map((p) => ({ heard: text(p.heard), memberId: known(p.memberId) }))
      .filter((p) => {
        if (!p.heard) return false;
        if (p.memberId === null) return true;
        if (seen.has(p.memberId)) return false;
        seen.add(p.memberId);
        return true;
      });
  };
  return {
    minutes,
    present: people(raw.present),
    apologies: people(raw.apologies),
    actionItems: list(raw.actionItems)
      .map((a) => ({
        title: text(a.title),
        ownerId: known(a.ownerId),
        ownerHeard: text(a.ownerHeard),
        dueOn: typeof a.dueOn === 'string' && ISO_DAY.test(a.dueOn) ? a.dueOn : null,
      }))
      .filter((a) => a.title),
    checkThese: (Array.isArray(raw.checkThese) ? raw.checkThese : []).map(text).filter(Boolean),
  };
}

/** The meeting check-in that day for that chapter, which ticks go to; none for a whole-club meeting. */
export function attendanceSessionFor(meeting: Meeting, data: ClubData): CheckinSession | null {
  if (meeting.chapterId === null) return null;
  const day = melbourneDate(meeting.startsAt);
  return (data.checkinSessions ?? []).find((s) => s.kind === 'meeting' && s.chapterId === meeting.chapterId && s.heldOn === day) ?? null;
}

export interface DraftChoices {
  minutes: string;
  /** Members ticked as there. */
  present: string[];
  /** Action items ticked to keep. */
  actionItems: { title: string; ownerId: string; dueOn: string | null }[];
}

export interface DraftPlan {
  minutes: string;
  sessionId: string | null;
  /** Ticked, not already marked, and allowed by the check-in's own rule. */
  markPresent: string[];
  actionItems: ActionItemInput[];
  /** Titles of ticked items whose owner can't own one in this meeting's scope. */
  skippedActions: string[];
}

/** What "Use this draft" will save, checked with the same rules as the buttons it stands in for. */
export function draftPlan(me: Member | null, meeting: Meeting, choices: DraftChoices, data: ClubData, today: string): DraftPlan {
  const session = attendanceSessionFor(meeting, data);
  const already = new Set((data.attendance ?? []).filter((a) => a.sessionId === session?.id).map((a) => a.memberId));
  const markPresent = session
    ? [...new Set(choices.present)].filter((id) => {
        if (already.has(id)) return false;
        const target = data.members.find((m) => m.id === id);
        return !!target && markProblem(me, session, target, data, today) === null;
      })
    : [];
  const actionItems: ActionItemInput[] = [];
  const skippedActions: string[] = [];
  for (const a of choices.actionItems) {
    if (canOwnAction(data.members.find((m) => m.id === a.ownerId), meeting.chapterId)) {
      actionItems.push({ id: null, chapterId: meeting.chapterId, meetingId: meeting.id, title: a.title.trim(), ownerId: a.ownerId, dueOn: a.dueOn });
    } else {
      skippedActions.push(a.title.trim());
    }
  }
  return { minutes: choices.minutes.trim(), sessionId: session?.id ?? null, markPresent, actionItems, skippedActions };
}
