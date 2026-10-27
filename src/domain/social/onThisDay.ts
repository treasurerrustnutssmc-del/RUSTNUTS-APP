// "On this day": photos and videos posted on today's date in earlier years, by the Melbourne date.
// The database's photos_on_this_day picks the same items (with club_photos' rules for who sees
// what); this groups them by year for the screens and picks the same way for the demo.

import { melbourneDate } from '../rides';

/** Anything with an instant it was posted. */
export interface DatedItem {
  id: string;
  createdAt: string;
}

export interface YearGroup<T extends DatedItem> {
  /** The ISO date its newest item was posted (Melbourne). A leap year can hold both 28 and 29 February. */
  date: string;
  yearsAgo: number;
  /** Newest first. */
  items: T[];
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Whether a date in an earlier year falls on today: 29 February counts as 28 February in other years. */
function sameDay(date: string, today: string): boolean {
  const md = date.slice(5);
  const todayMd = today.slice(5);
  if (md === todayMd) return true;
  return md === '02-29' && todayMd === '02-28' && !isLeap(Number(today.slice(0, 4)));
}

/** Items posted on today's day and month in earlier years, grouped by year, newest year first. */
export function onThisDay<T extends DatedItem>(items: T[], today: string): YearGroup<T>[] {
  const year = Number(today.slice(0, 4));
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const date = melbourneDate(item.createdAt);
    const itemYear = Number(date.slice(0, 4));
    if (itemYear >= year || !sameDay(date, today)) continue;
    groups.set(itemYear, [...(groups.get(itemYear) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([itemYear, list]) => {
      const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { date: melbourneDate(sorted[0].createdAt), yearsAgo: year - itemYear, items: sorted };
    });
}

/** "A year ago", "4 years ago". */
export function yearsAgoLabel(years: number): string {
  return years === 1 ? 'A year ago' : `${years} years ago`;
}
