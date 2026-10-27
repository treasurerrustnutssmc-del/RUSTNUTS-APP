// Shout-outs: birthdays (shared by the member, day and month only) and patch anniversaries, for
// the Home card. The database's set_birthday applies birthdayProblem's checks in the same order
// with the same words.

import { canSeeMember } from '../access';
import { addDays, weekday } from '../dates';
import { displayName } from '../profile';
import type { Member, Position } from '../types';

/** A member's shared birthday: no year is ever kept. */
export interface Birthday {
  memberId: string;
  month: number;
  day: number;
}

export type ShoutoutKind = 'birthday' | 'patch';

export interface Shoutout {
  member: Member;
  kind: ShoutoutKind;
  /** The ISO date it falls on, in the window. */
  date: string;
  /** 0 today, 1 tomorrow, and so on. */
  daysAway: number;
  /** Years patched, for an anniversary; null for a birthday. */
  years: number | null;
  isMe: boolean;
}

/** How many days the Home card looks at, today included. */
export const SHOUTOUT_DAYS = 7;

export const BIRTHDAY_MISSING = 'Pick a day and a month.';
export const BIRTHDAY_BAD_DAY = 'That day isn’t in that month.';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days in a month, counting 29 for February (a birthday can be on the leap day). */
export function daysInMonth(month: number): number {
  return new Date(Date.UTC(2024, month, 0)).getUTCDate();
}

/** Whether a day and month land on this ISO date: 29 February counts as 28 February in other years. */
function landsOn(month: number, day: number, iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  if (m === month && d === day) return true;
  return month === 2 && day === 29 && m === 2 && d === 28 && !isLeap(y);
}

/** Why a birthday can't be saved, or null. Two nulls take it off. */
export function birthdayProblem(month: number | null, day: number | null): string | null {
  if (month === null && day === null) return null;
  if (month === null || day === null) return BIRTHDAY_MISSING;
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12) return BIRTHDAY_BAD_DAY;
  if (day < 1 || day > daysInMonth(month)) return BIRTHDAY_BAD_DAY;
  return null;
}

/** "7 March", or "Not shared". */
export function birthdayLabel(b: Birthday | null | undefined): string {
  return b ? `${b.day} ${MONTH_NAMES[b.month - 1]}` : 'Not shared';
}

export const MONTH_OPTIONS = MONTH_NAMES.map((name, i) => ({ month: i + 1, name, short: name.slice(0, 3) }));

/**
 * Birthdays and patch anniversaries in the next `days` days (today first), for approved members
 * the viewer can see. Patch anniversaries are for members who are Full or Nomad now, from one
 * year on. Ordered by date, then birthdays before anniversaries, then you, then name.
 */
export function shoutoutsFor(
  viewer: Member | null,
  members: Member[],
  birthdays: Birthday[],
  today: string,
  days: number = SHOUTOUT_DAYS,
  positions: Position[] = [],
): Shoutout[] {
  if (!viewer || viewer.approval !== 'approved') return [];
  const seen = members.filter((m) => m.approval === 'approved' && canSeeMember(viewer, m, positions));
  const byId = new Map(seen.map((m) => [m.id, m]));
  const out: Shoutout[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const year = Number(date.slice(0, 4));
    for (const b of birthdays) {
      const m = byId.get(b.memberId);
      if (m && landsOn(b.month, b.day, date)) {
        out.push({ member: m, kind: 'birthday', date, daysAway: i, years: null, isMe: m.id === viewer.id });
      }
    }
    for (const m of seen) {
      if (!m.patchedOn || (m.status !== 'full' && m.status !== 'nomad')) continue;
      const [py, pm, pd] = m.patchedOn.split('-').map(Number);
      const years = year - py;
      if (years >= 1 && landsOn(pm, pd, date)) {
        out.push({ member: m, kind: 'patch', date, daysAway: i, years, isMe: m.id === viewer.id });
      }
    }
  }
  const kindOrder = (k: ShoutoutKind) => (k === 'birthday' ? 0 : 1);
  return out.sort(
    (a, b) =>
      a.daysAway - b.daysAway ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      Number(b.isMe) - Number(a.isMe) ||
      displayName(a.member).localeCompare(displayName(b.member)),
  );
}

/** "Your birthday", "Birthday", "3 years patched". */
export function shoutoutLine(s: Pick<Shoutout, 'kind' | 'isMe' | 'years'>): string {
  if (s.kind === 'birthday') return s.isMe ? 'Your birthday' : 'Birthday';
  return `${s.years} ${s.years === 1 ? 'year' : 'years'} patched`;
}

/** "Today", "Tomorrow", or "Fri 30/10". */
export function shoutoutDayLabel(date: string, daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return `${weekday(date)} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
