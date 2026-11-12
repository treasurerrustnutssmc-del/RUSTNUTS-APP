// The first-run guide: a short "here's where things are" card on Home, shown until the member
// dismisses it, remembered per member on their phone. Help can bring it back. If the phone's
// storage fails it stays hidden rather than nag or break anything.
import type { FilterStorage } from './savedFilters';

export const FIRST_RUN_STEPS: { title: string; text: string; icon: string }[] = [
  { title: 'Rides', text: 'See what is on, and tap Going, Maybe or Can’t make it.', icon: 'calendar-outline' },
  { title: 'Chat', text: 'The whole club, your chapter, and a chat for each ride.', icon: 'chatbubbles-outline' },
  { title: 'Members', text: 'Find anyone, by name, road name or bike.', icon: 'people-outline' },
  { title: 'Me', text: 'Your profile, bikes, fees and Road Rules, and Club words if a word is new.', icon: 'person-circle-outline' },
];

const keyFor = (memberId: string) => `firstRunSeen:${memberId}`;

export async function hasSeenFirstRun(storage: FilterStorage, memberId: string): Promise<boolean> {
  try {
    return (await storage.getItem(keyFor(memberId))) === '1';
  } catch {
    return true;
  }
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
