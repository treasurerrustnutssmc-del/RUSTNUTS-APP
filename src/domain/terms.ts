// When a Club position's term ends. Chapter Board terms are two years from the Annual Chapter
// Meeting, Non-Board appointments up to two years (9.2), the National Chairperson two years (11.3),
// the National Secretary up to two years (11.6) and the National Auditor twelve months (11.8). The
// two-year terms recorded as beginning 1 August 2026 are preserved (17.6), so an older start date
// counts from then. Terms can be renewed without limit: end the term and appoint again.

import { daysBetween } from './dates';
import type { Position } from './types';

export const TERMS_BEGAN = '2026-08-01';
export const TERM_SOON_DAYS = 60;

function addYears(iso: string, years: number): string {
  const end = `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;
  return end.endsWith('-02-29') ? end.replace(/-29$/, '-28') : end;
}

export function termEndsOn(position: Position): string | null {
  if (position.role === 'founder') return null;
  if (position.role === 'nec_auditor') return addYears(position.startedOn, 1);
  return addYears(position.startedOn < TERMS_BEGAN ? TERMS_BEGAN : position.startedOn, 2);
}

/** For a position still held: running, ending within 60 days, or ended (and not yet renewed). */
export function termState(position: Position, today: string): 'running' | 'ending' | 'ended' | null {
  const ends = termEndsOn(position);
  if (!ends || position.endedOn !== null) return null;
  const days = daysBetween(today, ends);
  if (days < 0) return 'ended';
  return days <= TERM_SOON_DAYS ? 'ending' : 'running';
}
