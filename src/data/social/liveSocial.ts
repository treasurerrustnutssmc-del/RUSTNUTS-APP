// Turns the social tables' rows into the app's records.

import type { Birthday } from '../../domain/social/shoutouts';

export interface BirthdayRow {
  member_id: string;
  month: number | null;
  day: number | null;
}

/** Shared birthdays only: a row with no month and day is one that was taken off. */
export function toBirthdays(rows: BirthdayRow[]): Birthday[] {
  return rows.flatMap((r) => (r.month === null || r.day === null ? [] : [{ memberId: r.member_id, month: r.month, day: r.day }]));
}
