// The last club data that loaded, kept on the phone so the app still opens and shows the club with
// no signal. It holds only what the signed-in person could already see, is never shown to anyone
// else on the same phone, and is deleted on sign-out.

import { formatAuDate } from '../domain/dates';
import { melbourneDate, melbourneTime } from '../domain/rides';
import type { ClubData } from '../domain/types';
import { EMPTY_DATA } from './clubContext';
import type { KeyValue } from './liveQueue';

const KEY = 'club.cache.v1';

interface Saved {
  userId: string;
  savedAt: string;
  data: ClubData;
}

export function createClubCache(store: KeyValue) {
  return {
    save: async (userId: string, data: ClubData, savedAt: string): Promise<void> => {
      await store.setItem(KEY, JSON.stringify({ userId, savedAt, data } satisfies Saved)).catch(() => {});
    },
    load: async (userId: string): Promise<{ data: ClubData; savedAt: string } | null> => {
      try {
        const raw = await store.getItem(KEY);
        const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
        if (!saved || saved.userId !== userId || typeof saved.savedAt !== 'string') return null;
        if (!saved.data || !Array.isArray(saved.data.members)) return null;
        // A copy saved before a new kind of data was added: that part is empty until the next load.
        return { data: { ...EMPTY_DATA, ...saved.data }, savedAt: saved.savedAt };
      } catch {
        return null;
      }
    },
    clear: async (): Promise<void> => {
      await store.removeItem(KEY).catch(() => {});
    },
  };
}

/** "Offline. Showing what was saved 24/10/2026 7:30 am." */
export function offlineText(savedAt: string): string {
  return `Offline. Showing what was saved ${formatAuDate(melbourneDate(savedAt))} ${melbourneTime(savedAt)}.`;
}
