// The filters a member sets (which ride colours on the Rides tab, which chapter on Members) are
// remembered on their phone, per member, so they don't have to set them every visit. A broken copy
// is ignored and a failing phone never breaks the screen.
import { RIDE_CATEGORIES } from './labels';
import type { RideCategory } from './types';

export interface FilterStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type SavedFilters = { rideColours?: RideCategory[]; memberChapter?: string };

const keyFor = (memberId: string) => `filters:${memberId}`;

export async function readFilters(storage: FilterStorage, memberId: string): Promise<SavedFilters> {
  try {
    const raw = await storage.getItem(keyFor(memberId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { rideColours?: unknown; memberChapter?: unknown };
    const out: SavedFilters = {};
    if (Array.isArray(parsed.rideColours)) {
      const colours = parsed.rideColours.filter((c): c is RideCategory => RIDE_CATEGORIES.includes(c as RideCategory));
      // An explicit empty list ("show none") is a real choice; a list of only unknown colours is not.
      if (colours.length > 0 || parsed.rideColours.length === 0) out.rideColours = colours;
    }
    if (typeof parsed.memberChapter === 'string' && parsed.memberChapter) out.memberChapter = parsed.memberChapter;
    return out;
  } catch {
    return {};
  }
}

/** Saves some filters and keeps the rest as they were. */
export async function saveFilters(storage: FilterStorage, memberId: string, patch: SavedFilters): Promise<void> {
  try {
    const current = await readFilters(storage, memberId);
    await storage.setItem(keyFor(memberId), JSON.stringify({ ...current, ...patch }));
  } catch {
    // The filters just won't be remembered; nothing else is affected.
  }
}

/** Whether two ride-colour lists hold the same colours, in any order. */
export function sameColours(a: RideCategory[], b: RideCategory[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}
