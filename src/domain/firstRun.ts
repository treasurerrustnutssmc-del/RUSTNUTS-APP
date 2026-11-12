// The first-run guide: a short "here's where things are" card on Home, shown until the member
// dismisses it, remembered per member on their phone. Help can bring it back. If the phone's
// storage fails it stays hidden rather than nag or break anything.
import { daysBetween } from './dates';
import type { FilterStorage } from './savedFilters';

export const FIRST_RUN_STEPS: { title: string; text: string; icon: string }[] = [
  { title: 'Rides', text: 'See what is on, and tap Going, Maybe or Can’t make it.', icon: 'calendar-outline' },
  { title: 'Chat', text: 'The whole club, your chapter, and a chat for each ride.', icon: 'chatbubbles-outline' },
  { title: 'Members', text: 'Find anyone, by name, road name or bike.', icon: 'people-outline' },
  { title: 'Me', text: 'Your profile, bikes, fees and Road Rules, and Club words if a word is new.', icon: 'person-circle-outline' },
];

const keyFor = (memberId: string) => `firstRunSeen:${memberId}`;

/**
 * Whether to leave the guide out. Dismissed (1) means seen. Asked for from Help (0) means show it.
 * Never touched: shown only to a recent member (`recent`), so long-standing members are not greeted
 * with a "where things are" card the first time the app updates.
 */
export async function hasSeenFirstRun(storage: FilterStorage, memberId: string, recent: boolean): Promise<boolean> {
  try {
    const raw = await storage.getItem(keyFor(memberId));
    if (raw === '1') return true;
    if (raw === '0') return false;
    return !recent;
  } catch {
    return true;
  }
}

/** New for the first 60 days after joining. A member with no join date counts as new. */
export function isRecentMember(joinedOn: string | null, today: string): boolean {
  return joinedOn === null || daysBetween(joinedOn, today) <= 60;
}

export async function markFirstRunSeen(storage: FilterStorage, memberId: string): Promise<void> {
  try {
    await storage.setItem(keyFor(memberId), '1');
  } catch {
    // Nothing to do: it just may show again.
  }
}

export async function resetFirstRun(storage: FilterStorage, memberId: string): Promise<void> {
  try {
    await storage.setItem(keyFor(memberId), '0');
  } catch {
    // Nothing to do.
  }
}
