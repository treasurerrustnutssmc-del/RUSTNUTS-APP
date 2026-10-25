// The club business one person sees, grouped for the Business screen and the Home row: votes
// waiting on them first, then open votes, action items, meetings and closed votes.

import { formatAuDate } from './dates';
import { canSeeActionItem, canSeeMeeting, minutesState, runsScope } from './meetings';
import { melbourneDate } from './rides';
import type { ActionItem, ClubData, Meeting, Member, Vote } from './types';
import { canSeeVote, castProblem } from './votes';

export interface BusinessView {
  /** Open votes this person can still cast. */
  needsMe: Vote[];
  /** Other votes not yet closed: already voted, or run by them. */
  openVotes: Vote[];
  closedVotes: Vote[];
  /** Their own open action items, soonest due first. */
  myActions: ActionItem[];
  /** Open items of scopes they run, owned by others. */
  otherActions: ActionItem[];
  /** Meetings still to come, soonest first. */
  upcoming: Meeting[];
  /** Meetings that have started or were cancelled, newest first, with where their minutes are at. */
  past: { meeting: Meeting; state: ReturnType<typeof minutesState> }[];
  /** Runs at least one chapter or the whole club (can call meetings and open votes). */
  runsAny: boolean;
  /** One line for the Home row, or null when there's nothing to say. */
  summary: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed 04/11" for a meeting's Melbourne date. */
export function shortDay(iso: string): string {
  const date = melbourneDate(iso);
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${formatAuDate(date).slice(0, 5)}`;
}

const byDue = (a: ActionItem, b: ActionItem) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function businessFor(me: Member | null, data: ClubData, now: string): BusinessView {
  const P = data.positions;
  const votes = (data.votes ?? []).filter((v) => canSeeVote(me, v, P));
  const open = votes.filter((v) => v.closedAt === null).sort((a, b) => a.closesAt.localeCompare(b.closesAt));
  const needsMe = open.filter((v) => castProblem(me, v, now) === null);
  const items = (data.actionItems ?? []).filter((a) => a.doneOn === null && canSeeActionItem(me, a, P)).sort(byDue);
  const meetings = (data.meetings ?? []).filter((m) => canSeeMeeting(me, m, P));
  const t = new Date(now).getTime();
  const upcoming = meetings
    .filter((m) => !m.cancelledAt && new Date(m.startsAt).getTime() > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = meetings
    .filter((m) => !upcoming.includes(m))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((meeting) => ({ meeting, state: minutesState(meeting, now) }));
  const myActions = items.filter((a) => a.ownerId === me?.id);
  const runsAny = !!me && (runsScope(me, null, P) || data.chapters.some((c) => runsScope(me, c.id, P)));

  const minutesOwed = past.filter((p) => (p.state === 'due' || p.state === 'overdue') && runsScope(me, p.meeting.chapterId, P));
  const parts = [
    needsMe.length ? `${plural(needsMe.length, 'vote needs', 'votes need')} you` : null,
    upcoming.length ? `Next meeting ${shortDay(upcoming[0].startsAt)}` : null,
    myActions.length ? plural(myActions.length, 'action item', 'action items') : null,
    minutesOwed.length ? `Minutes due for ${plural(minutesOwed.length, 'meeting', 'meetings')}` : null,
  ].filter(Boolean);

  return {
    needsMe,
    openVotes: open.filter((v) => !needsMe.includes(v)),
    closedVotes: votes.filter((v) => v.closedAt !== null).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!)),
    myActions,
    otherActions: items.filter((a) => a.ownerId !== me?.id),
    upcoming,
    past,
    runsAny,
    summary: parts.length ? parts.join(' · ') : null,
  };
}

/** "19:30", "7:30 pm", "7.30pm" or "7pm" as 24-hour "HH:MM", or null. */
export function parseTime(input: string): string | null {
  const m = input.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (minute > 59) return null;
  if (m[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[3] === 'pm' ? 12 : 0);
  } else if (hour > 23 || m[2] === undefined) {
    return null; // a bare "7" could be morning or night
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The instant of a Melbourne wall-clock date and "HH:MM" time (AEST or AEDT, whichever applies). */
export function melbourneInstant(dateIso: string, hhmm: string): string | null {
  const [h, min] = hhmm.split(':').map(Number);
  const [y, mo, d] = dateIso.split('-').map(Number);
  for (const offset of [11, 10]) {
    const iso = new Date(Date.UTC(y, mo - 1, d, h - offset, min)).toISOString();
    if (melbourneDate(iso) === dateIso && melbourneHhmm(iso) === hhmm) return iso;
  }
  return null; // the hour skipped when the clocks go forward
}

/** An instant's Melbourne time as 24-hour "HH:MM". */
export function melbourneHhmm(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}
