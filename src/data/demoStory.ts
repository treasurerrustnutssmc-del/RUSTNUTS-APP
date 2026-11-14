// The demo clock. The fixed half of the demo club is a story written for the week that starts
// Sun 25/10/2026. When the demo is built, every story date moves forward by whole weeks so the
// story sits in the current Melbourne week: weekdays hold, and every time keeps its Melbourne
// clock time across daylight saving. Pure: no pictures, no React, no reading of the machine clock.

import { melbourneHhmm, melbourneInstant } from '../domain/business';
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
 * Melbourne's offset from UTC (ms) on a calendar date, or null on a day the clocks change.
 * Looked up once per date and kept: a formatter per call made a build slow.
 */
const offsets = new Map<string, number | null>();

function offsetOn(date: string): number | null {
  const kept = offsets.get(date);
  if (kept !== undefined) return kept;
  const at = (hhmm: string) => {
    const iso = melbourneInstant(date, hhmm);
    const [h, min] = hhmm.split(':').map(Number);
    return iso === null ? null : dateMs(date) + h * HOUR + min * 60_000 - Date.parse(iso);
  };
  const start = at('00:00');
  const end = at('23:59');
  const offset = start !== null && start === end ? start : null;
  offsets.set(date, offset);
  return offset;
}

/** An instant's Melbourne date and its ms since that date's midnight on the wall clock. */
function wallOf(ms: number): { date: string; sinceMidnight: number } {
  for (const hours of [11, 10]) {
    const date = dateOf(ms + hours * HOUR);
    if (offsetOn(date) === hours * HOUR) return { date, sinceMidnight: ms + hours * HOUR - dateMs(date) };
  }
  // On a day the clocks change: ask the formatter (whole-hour offsets, so seconds and ms carry over).
  const iso = new Date(ms).toISOString();
  const [h, min] = melbourneHhmm(iso).split(':').map(Number);
  return { date: melbourneDate(iso), sinceMidnight: h * HOUR + min * 60_000 + (ms % 60_000 + 60_000) % 60_000 };
}

/** The instant at a Melbourne wall time on a date. A skipped time moves to the next hour; a repeated one is the first. */
function instantAt(date: string, sinceMidnight: number): number {
  const offset = offsetOn(date);
  if (offset !== null) return dateMs(date) + sinceMidnight - offset;
  const minutes = Math.floor(sinceMidnight / 60_000);
  const rest = sinceMidnight - minutes * 60_000;
  const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const iso = melbourneInstant(date, hhmm(minutes)) ?? melbourneInstant(date, hhmm(minutes + 60));
  if (iso === null) throw new Error(`No Melbourne instant for ${date} ${hhmm(minutes)}`);
  return Date.parse(iso) + rest;
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
