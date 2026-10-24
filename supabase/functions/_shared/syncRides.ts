// The calendar sync, without the network or the database (both are passed in), so `npm test`
// runs exactly what the sync-rides Edge Function runs.

import { categoryFor, melbourneMidnight, parseIcs, type RideCategory } from './ics.ts';

export interface Feed {
  id: string;
  url: string;
  category: RideCategory | null;
}

export interface SyncDeps {
  feeds: Feed[];
  fetchText: (url: string) => Promise<string>;
  /** Hands one feed's rides to the database (public.apply_ride_sync). */
  apply: (feedId: string, events: object[]) => Promise<void>;
  recordError: (feedId: string, message: string) => Promise<void>;
  now: Date;
}

/** From the start of today in Melbourne to the same date a year on. */
export function syncWindow(now: Date): { from: string; to: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(now); // YYYY-MM-DD
  const [y, m, d] = today.split('-').map(Number);
  return { from: melbourneMidnight(y, m, d), to: melbourneMidnight(y + 1, m, d) };
}

/** Reads every feed. A feed that fails is recorded and left alone, so its rides aren't cancelled. */
export async function syncAllFeeds(deps: SyncDeps): Promise<{ ok: number; failed: number }> {
  const { from, to } = syncWindow(deps.now);
  let ok = 0;
  let failed = 0;
  for (const feed of deps.feeds) {
    try {
      const events = parseIcs(await deps.fetchText(feed.url), from, to).map((ev) => ({
        uid: ev.uid,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        allDay: ev.allDay,
        title: ev.title,
        location: ev.location,
        notes: ev.notes,
        category: categoryFor(feed.category, ev),
      }));
      await deps.apply(feed.id, events);
      ok += 1;
    } catch (e) {
      failed += 1;
      // If even that fails, carry on: the feed's rides are left as they were either way.
      await deps.recordError(feed.id, e instanceof Error ? e.message : String(e)).catch(() => {});
    }
  }
  return { ok, failed };
}
