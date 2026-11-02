// "Check for updates" on Me > The app: ask the update server now instead of waiting for the app to
// be closed and opened twice. The steps are kept here, away from expo-updates, so they can be tested.

import { formatAuDate } from './dates';
import { melbourneDate, melbourneTime } from './rides';

/** What the app is running right now. */
export interface RunningUpdate {
  isEnabled: boolean;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  createdAt: Date | null;
}

/** Just the parts of expo-updates the check uses. */
export interface UpdateApi {
  isEnabled: boolean;
  check: () => Promise<{ isAvailable: boolean; isRollBackToEmbedded: boolean }>;
  fetch: () => Promise<{ isNew: boolean; isRollBackToEmbedded: boolean }>;
  reload: () => Promise<void>;
}

export type UpdateStep = 'checking' | 'downloading' | 'restarting';
export type UpdateOutcome = { kind: 'current' } | { kind: 'restarting' } | { kind: 'off' } | { kind: 'failed'; message: string };

export const NO_SIGNAL = 'Couldn’t reach the update server. Check your signal and try again.';

/** "1A2B3C4D": enough to tell two phones apart when someone reads it out. */
export function shortUpdateId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** The line under "Check for updates": which update this phone is on. */
export function describeRunning(r: RunningUpdate): string {
  if (!r.isEnabled) return 'Updates don’t run in this version';
  if (!r.updateId || r.isEmbeddedLaunch) return 'The build’s own code (no update yet)';
  const when = r.createdAt ? ` · ${formatAuDate(melbourneDate(r.createdAt.toISOString()))} ${melbourneTime(r.createdAt.toISOString())}` : '';
  return `Update ${shortUpdateId(r.updateId)}${when}`;
}

/** Check, download if there's something new (or a roll-back), then restart into it. */
export async function checkAndUpdate(api: UpdateApi, onStep: (s: UpdateStep) => void): Promise<UpdateOutcome> {
  if (!api.isEnabled) return { kind: 'off' };
  try {
    onStep('checking');
    const found = await api.check();
    if (!found.isAvailable && !found.isRollBackToEmbedded) return { kind: 'current' };
    onStep('downloading');
    const got = await api.fetch();
    if (!got.isNew && !got.isRollBackToEmbedded) return { kind: 'current' };
    onStep('restarting');
    await api.reload();
    return { kind: 'restarting' };
  } catch {
    return { kind: 'failed', message: NO_SIGNAL };
  }
}
