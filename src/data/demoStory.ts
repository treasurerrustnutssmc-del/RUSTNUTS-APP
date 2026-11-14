// The demo clock. The fixed half of the demo club is a story written for the week that starts
// Sun 25/10/2026. When the demo is built, every story date moves forward by whole weeks so the
// story sits in the current Melbourne week: weekdays hold, and every time keeps its Melbourne
// clock time across daylight saving. Pure: no pictures, no React, no reading of the machine clock.

import { addDays, daysBetween } from '../domain/dates';
import { melbourneDate } from '../domain/rides';

/** The Sunday the story week starts. */
export const STORY_ANCHOR = '2026-10-25';

export interface StoryDates {
  /** Whole weeks, in days, from the story week to today's week. */
  shiftDays: number;
  /** A story date (YYYY-MM-DD) moved to today's week. */
  d: (storyDate: string) => string;
  /** A story instant moved the same number of days, at the same Melbourne clock time. */
  t: (storyInstant: string) => string;
}

export interface DemoClock extends StoryDates {
  now: string; // ISO instant
  today: string; // its Melbourne date
  /** The earlier of an instant and now: something that has happened is never stamped ahead of now. */
  notAfterNow: (iso: string) => string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(2, '0');

/** UTC midnight of a calendar date, in ms. */
function dateMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function dateOf(ms: number): string {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * One Melbourne formatter for the whole module, made on first use: making a formatter is the slow
 * part (a formatter per call made a build slow), reading one is cheap.
 */
let melbourneParts: Intl.DateTimeFormat | null = null;

/** Melbourne's offset from UTC (ms) at an instant. */
function offsetAt(ms: number): number {
  melbourneParts ??= new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = melbourneParts.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return wall - (ms - (((ms % 60_000) + 60_000) % 60_000));
}

/**
 * Melbourne's offset from UTC (ms) on a calendar date, or null on a day the clocks change.
 * Melbourne's clocks change at 16:00 UTC the day before (2 am standard time), so two reads cover
 * the whole day: 14:00 UTC the day before (its first hour) and 12:59 UTC on the day (its last).
 * Looked up once per date and kept.
 */
const offsets = new Map<string, number | null>();

function offsetOn(date: string): number | null {
  const kept = offsets.get(date);
  if (kept !== undefined) return kept;
  const start = offsetAt(dateMs(date) - 10 * HOUR);
  const end = offsetAt(dateMs(date) + 12 * HOUR + 59 * 60_000);
  const offset = start === end ? start : null;
  offsets.set(date, offset);
  return offset;
}

/** An instant's Melbourne date and its ms since that date's midnight on the wall clock. */
function wallOf(ms: number): { date: string; sinceMidnight: number } {
  for (const hours of [11, 10]) {
    const date = dateOf(ms + hours * HOUR);
    if (offsetOn(date) === hours * HOUR) return { date, sinceMidnight: ms + hours * HOUR - dateMs(date) };
  }
  // On a day the clocks change: read the offset at the instant itself.
  const wall = ms + offsetAt(ms);
  const date = dateOf(wall);
  return { date, sinceMidnight: wall - dateMs(date) };
}

/** The instant at a Melbourne wall time on a date. A skipped time moves to the next hour; a repeated one is the first. */
function instantAt(date: string, sinceMidnight: number): number {
  const offset = offsetOn(date);
  if (offset !== null) return dateMs(date) + sinceMidnight - offset;
  // On a day the clocks change: summer time (+11) first, so a repeated time is its first; then the next hour.
  for (const wall of [sinceMidnight, sinceMidnight + HOUR]) {
    for (const hours of [11, 10]) {
      const ms = dateMs(date) + wall - hours * HOUR;
      if (offsetAt(ms) === hours * HOUR) return ms;
    }
  }
  throw new Error(`No Melbourne instant for ${date} at ${sinceMidnight} ms`);
}

/** Whole weeks, in days, from the story week to the week holding `today` (a Melbourne date). */
export function storyShiftDays(today: string): number {
  return 7 * Math.floor(daysBetween(STORY_ANCHOR, today) / 7);
}

export function storyDates(today: string): StoryDates {
  const shiftDays = storyShiftDays(today);
  const d = (storyDate: string) => addDays(storyDate, shiftDays);
  const t = (storyInstant: string) => {
    const { date, sinceMidnight } = wallOf(Date.parse(storyInstant));
    return new Date(instantAt(addDays(date, shiftDays), sinceMidnight)).toISOString();
  };
  return { shiftDays, d, t };
}

export function demoClock(now: Date): DemoClock {
  const nowIso = now.toISOString();
  const today = melbourneDate(nowIso);
  const nowMs = now.getTime();
  return {
    ...storyDates(today),
    now: nowIso,
    today,
    notAfterNow: (iso: string) => (Date.parse(iso) > nowMs ? nowIso : iso),
  };
}

/** Marks a date as fixed history on purpose. Returns its argument. */
export function fixed<T extends string>(iso: T): T {
  return iso;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'November' */
export function monthName(dateIso: string): string {
  return MONTHS[Number(dateIso.slice(5, 7)) - 1];
}

/** '8th' */
export function dayOrdinal(dateIso: string): string {
  const day = Number(dateIso.slice(8, 10));
  const suffix = day >= 11 && day <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

/** 'Sunday' */
export function weekdayName(dateIso: string): string {
  return WEEKDAYS[(((Math.floor(dateMs(dateIso) / DAY) + 4) % 7) + 7) % 7]; // 01/01/1970 was a Thursday
}

/** '7 December' */
export function dayMonth(dateIso: string): string {
  return `${Number(dateIso.slice(8, 10))} ${monthName(dateIso)}`;
}
