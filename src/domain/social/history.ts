// The club's history and hall of fame. The board keeps a timeline of what happened when, and
// honours (life members, awards); founders and past office holders come from the positions. The
// database's save_history_entry, archive_history_entry, save_honour and archive_honour apply the
// same checks with the same words, in the same order.

import { ROLE_ORDER } from '../labels';
import { formatAuDate, isRealIsoDate } from '../dates';
import { signedInProblem } from '../routes';
import type { Member, Position, PositionRole } from '../types';
import { isAnyBoard } from './help';

export const MAX_HISTORY_TITLE = 80;
export const MAX_HISTORY_STORY = 1000;
export const MAX_HONOUR_NAME = 80;
export const MAX_HONOUR = 60;
export const MAX_HONOUR_NOTE = 300;
/** The club was founded in 2019; nothing in its hall of fame is older. */
export const FIRST_YEAR = 2019;

export const NOT_KEEPER = 'Only the board can keep the club’s history.';
export const ENTRY_GONE = 'No such entry.';
export const ENTRY_OFF = 'That entry has been taken off.';
export const ENTRY_OFF_ALREADY = 'That entry has already been taken off.';
export const BAD_HISTORY_DATE = 'Pick a date.';
export const NO_TITLE = 'Give it a title.';
export const HONOUR_GONE = 'No such honour.';
export const HONOUR_OFF = 'That honour has been taken off.';
export const HONOUR_OFF_ALREADY = 'That honour has already been taken off.';
export const NO_HONOUR_WHO = 'Pick a member or type a name.';
export const NO_SUCH_MEMBER = 'No such member.';
export const HONOUR_NO_NAME = 'Name the honour.';
export const BAD_YEAR = 'Pick a year from 2019 on.';

/** How exactly the date is known: shown as 09/03/2019, March 2019 or 2019. */
export type HistoryPrecision = 'day' | 'month' | 'year';
export const HISTORY_PRECISIONS: HistoryPrecision[] = ['day', 'month', 'year'];

export interface HistoryEntry {
  id: string;
  /** ISO date. For a month or a year, the first day of it is fine; only the shown part counts. */
  happenedOn: string;
  precision: HistoryPrecision;
  title: string;
  story: string | null;
  addedBy: string;
  archivedAt: string | null;
}

export interface HistoryInput {
  id: string | null;
  happenedOn: string;
  precision: HistoryPrecision;
  title: string;
  story: string;
}

export interface Honour {
  id: string;
  /** A member in the app, or null when the honour names someone who isn't (see name). */
  memberId: string | null;
  name: string | null;
  honour: string;
  year: number;
  note: string | null;
  addedBy: string;
  archivedAt: string | null;
}

export interface HonourInput {
  id: string | null;
  memberId: string | null;
  name: string;
  honour: string;
  year: number;
  note: string;
}

const chars = (s: string) => [...s].length;

function keeperProblem(me: Member | null, positions: Position[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!isAnyBoard(me, positions)) return NOT_KEEPER;
  return null;
}

export function canKeepHistory(me: Member | null, positions: Position[]): boolean {
  return isAnyBoard(me, positions);
}

export function cleanEntry(input: HistoryInput): Omit<HistoryEntry, 'id' | 'addedBy' | 'archivedAt'> {
  return {
    happenedOn: input.happenedOn,
    precision: input.precision,
    title: input.title.trim(),
    story: input.story.trim() || null,
  };
}

export function historyProblem(
  me: Member | null,
  input: HistoryInput,
  entries: HistoryEntry[],
  positions: Position[],
  today: string,
): string | null {
  const notKeeper = keeperProblem(me, positions);
  if (notKeeper) return notKeeper;
  if (input.id !== null) {
    const was = entries.find((e) => e.id === input.id);
    if (!was) return ENTRY_GONE;
    if (was.archivedAt) return ENTRY_OFF;
  }
  const c = cleanEntry(input);
  if (!isRealIsoDate(c.happenedOn) || c.happenedOn > today || !HISTORY_PRECISIONS.includes(c.precision)) {
    return BAD_HISTORY_DATE;
  }
  if (!c.title) return NO_TITLE;
  if (chars(c.title) > MAX_HISTORY_TITLE) return `Keep the title to ${MAX_HISTORY_TITLE} characters at most.`;
  if (c.story && chars(c.story) > MAX_HISTORY_STORY) return 'Keep the story to 1,000 characters at most.';
  return null;
}

export function archiveEntryProblem(
  me: Member | null,
  id: string,
  entries: HistoryEntry[],
  positions: Position[],
): string | null {
  const notKeeper = keeperProblem(me, positions);
  if (notKeeper) return notKeeper;
  const was = entries.find((e) => e.id === id);
  if (!was) return ENTRY_GONE;
  if (was.archivedAt) return ENTRY_OFF_ALREADY;
  return null;
}

export function cleanHonour(input: HonourInput): Omit<Honour, 'id' | 'addedBy' | 'archivedAt'> {
  return {
    memberId: input.memberId,
    name: input.name.trim() || null,
    honour: input.honour.trim(),
    year: input.year,
    note: input.note.trim() || null,
  };
}

export function honourProblem(
  me: Member | null,
  input: HonourInput,
  honours: Honour[],
  members: Member[],
  positions: Position[],
  today: string,
): string | null {
  const notKeeper = keeperProblem(me, positions);
  if (notKeeper) return notKeeper;
  if (input.id !== null) {
    const was = honours.find((h) => h.id === input.id);
    if (!was) return HONOUR_GONE;
    if (was.archivedAt) return HONOUR_OFF;
  }
  const c = cleanHonour(input);
  if ((c.memberId === null) === (c.name === null)) return NO_HONOUR_WHO;
  // Changing an honour keeps its member even when they're no longer on this member's list.
  const kept = input.id !== null && honours.find((h) => h.id === input.id)?.memberId === c.memberId;
  if (c.memberId !== null && !kept && !members.some((m) => m.id === c.memberId)) return NO_SUCH_MEMBER;
  if (c.name && chars(c.name) > MAX_HONOUR_NAME) return `Keep the name to ${MAX_HONOUR_NAME} characters at most.`;
  if (!c.honour) return HONOUR_NO_NAME;
  if (chars(c.honour) > MAX_HONOUR) return `Keep the honour to ${MAX_HONOUR} characters at most.`;
  const thisYear = Number(today.slice(0, 4));
  if (!Number.isInteger(c.year) || c.year < FIRST_YEAR || c.year > thisYear) return BAD_YEAR;
  if (c.note && chars(c.note) > MAX_HONOUR_NOTE) return `Keep the note to ${MAX_HONOUR_NOTE} characters at most.`;
  return null;
}

export function archiveHonourProblem(
  me: Member | null,
  id: string,
  honours: Honour[],
  positions: Position[],
): string | null {
  const notKeeper = keeperProblem(me, positions);
  if (notKeeper) return notKeeper;
  const was = honours.find((h) => h.id === id);
  if (!was) return HONOUR_GONE;
  if (was.archivedAt) return HONOUR_OFF_ALREADY;
  return null;
}

// ---------------------------------------------------------------------------------------------
// What members see

export const FOUNDED_ID = 'founded';

/** An entry on the timeline. The founding is derived from the founder positions, not kept. */
export interface TimelineEntry {
  id: string;
  happenedOn: string;
  precision: HistoryPrecision;
  title: string;
  story: string | null;
  /** Kept by the board, so it can be changed; the founding can't. */
  kept: boolean;
}

export interface TimelineYear {
  year: number;
  entries: TimelineEntry[];
}

/** The timeline, oldest first and grouped by year, headed by the club's founding. */
export function timeline(entries: HistoryEntry[], positions: Position[]): TimelineYear[] {
  const items: TimelineEntry[] = [];
  const foundedOn = positions
    .filter((p) => p.role === 'founder')
    .map((p) => p.startedOn)
    .sort()[0];
  if (foundedOn) {
    items.push({ id: FOUNDED_ID, happenedOn: foundedOn, precision: 'day', title: 'The club is founded', story: null, kept: false });
  }
  const kept = entries
    .filter((e) => !e.archivedAt)
    .sort((a, b) => a.happenedOn.localeCompare(b.happenedOn) || a.title.localeCompare(b.title));
  for (const e of kept) {
    items.push({ id: e.id, happenedOn: e.happenedOn, precision: e.precision, title: e.title, story: e.story, kept: true });
  }
  // The founding stays first in its year even when an entry shares its day.
  items.sort((a, b) => a.happenedOn.localeCompare(b.happenedOn) || Number(a.kept) - Number(b.kept));

  const years: TimelineYear[] = [];
  for (const item of items) {
    const year = Number(item.happenedOn.slice(0, 4));
    const last = years[years.length - 1];
    if (last && last.year === year) last.entries.push(item);
    else years.push({ year, entries: [item] });
  }
  return years;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function historyDateLabel(e: { happenedOn: string; precision: HistoryPrecision }): string {
  const [y, m] = e.happenedOn.split('-');
  if (e.precision === 'year') return y;
  if (e.precision === 'month') return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  return formatAuDate(e.happenedOn);
}

/** The club's founders, earliest first, then by name. */
export function founders(members: Member[], positions: Position[]): Member[] {
  const firstStart = new Map<string, string>();
  for (const p of positions) {
    if (p.role !== 'founder') continue;
    const was = firstStart.get(p.memberId);
    if (!was || p.startedOn < was) firstStart.set(p.memberId, p.startedOn);
  }
  return members
    .filter((m) => firstStart.has(m.id))
    .sort((a, b) => firstStart.get(a.id)!.localeCompare(firstStart.get(b.id)!) || a.fullName.localeCompare(b.fullName));
}

export interface PastHolder {
  /** Null when the member is no longer in the app's list. */
  member: Member | null;
  chapterId: string | null;
  startedOn: string;
  endedOn: string;
}

export interface PastRole {
  role: PositionRole;
  holders: PastHolder[];
}

/** Everyone who has held an office and stepped down, by role in the club's order, latest first. */
export function pastOfficeHolders(members: Member[], positions: Position[]): PastRole[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const groups: PastRole[] = [];
  for (const role of ROLE_ORDER) {
    if (role === 'founder') continue;
    const holders = positions
      .filter((p): p is Position & { endedOn: string } => p.role === role && p.endedOn !== null)
      .sort((a, b) => b.endedOn.localeCompare(a.endedOn) || b.startedOn.localeCompare(a.startedOn))
      .map((p) => ({ member: byId.get(p.memberId) ?? null, chapterId: p.chapterId, startedOn: p.startedOn, endedOn: p.endedOn }));
    if (holders.length) groups.push({ role, holders });
  }
  return groups;
}

/** "2019 to 2023", or just "2020" when it all happened in one year. */
export function yearsLabel(startedOn: string, endedOn: string): string {
  const from = startedOn.slice(0, 4);
  const to = endedOn.slice(0, 4);
  return from === to ? from : `${from} to ${to}`;
}

/** Honours on show: none taken off, the newest year first. */
export function honoursFor(honours: Honour[]): Honour[] {
  return honours.filter((h) => !h.archivedAt).sort((a, b) => b.year - a.year);
}
