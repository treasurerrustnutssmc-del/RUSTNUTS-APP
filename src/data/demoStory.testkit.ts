// Test-only: the demo built for the story instant, and the spread of instants the freshness tests
// build it for. Tests read the pinned build so their dates never depend on the day they run.

import { melbourneInstant } from '../domain/business';
import { addDays } from '../domain/dates';
import type { ClubData } from '../domain/types';
import { buildDemoData } from './demoData';
import { STORY_ANCHOR } from './demoStory';

/** Sun 25/10/2026 9:00 pm Melbourne: the instant the story was written for. */
export const STORY_NOW = new Date('2026-10-25T10:00:00.000Z');
/** STORY_NOW's Melbourne date. */
export const STORY_TODAY: string = STORY_ANCHOR;
/** The demo club built for the story instant. */
export const DEMO_DATA: ClubData = buildDemoData(STORY_NOW);

const DAYS = [
  '2026-10-24', '2026-10-25', '2026-10-31',
  ...Array.from({ length: 7 }, (_, i) => addDays('2026-11-15', i)),
  '2026-12-31', '2027-01-01', '2027-02-15', '2027-04-03', '2027-04-04', '2027-04-05',
  '2027-06-30', '2027-07-01', '2027-07-15', '2027-07-20', '2027-07-31',
  '2027-08-01', '2027-08-02', '2027-08-05', '2027-08-15', '2027-09-11', '2027-09-26',
  '2027-10-02', '2027-10-03', '2027-10-04', '2028-02-29', '2028-11-14', '2030-06-15',
];
const TIMES = ['00:05', '09:00', '19:30', '23:55'];

/** Each of DAYS at each of TIMES, Melbourne time, as ISO instants. */
export const INSTANTS: string[] = DAYS.flatMap((day) =>
  TIMES.map((hhmm) => {
    const instant = melbourneInstant(day, hhmm);
    if (!instant) throw new Error(`No Melbourne ${hhmm} on ${day}`);
    return instant;
  }),
);

const built = new Map<string, ClubData>();
/** The demo built for an instant, built once per instant. */
export function builtFor(instant: string): ClubData {
  let data = built.get(instant);
  if (!data) {
    data = buildDemoData(new Date(instant));
    built.set(instant, data);
  }
  return data;
}
