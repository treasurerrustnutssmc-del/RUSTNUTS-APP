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
export type UpdateOutcome =
  | { kind: 'current' }
  | { kind: 'restarting' }
  /** Downloaded, but the app couldn't restart itself: it applies on the next open. */
  | { kind: 'downloaded' }
  | { kind: 'off' }
  | { kind: 'failed'; message: string };

// Kept short: each fits one line on a phone, so the row never changes height.
export const NO_SIGNAL = 'No connection. Try again.';
export const NO_DOWNLOAD = 'Download failed. Try again.';
export const REOPEN = 'Downloaded. Close and reopen the app.';

/** The status line (top line under the title). */
export function statusLine(step: UpdateStep | null, result: UpdateOutcome | null): string {
  if (step === 'checking') return 'Checking…';
  if (step === 'downloading') return 'Downloading…';
  if (step === 'restarting') return 'Restarting…';
  if (!result) return 'Tap to check now';
  if (result.kind === 'current') return 'You’re up to date';
  if (result.kind === 'failed') return result.message;
  if (result.kind === 'downloaded') return REOPEN;
  if (result.kind === 'off') return 'Updates are off in this version';
  return 'Restarting…';
}

/** Ask at least this long, so "Checking…" can be read instead of flashing. */
export const MIN_CHECK_MS = 900;

/** "1A2B3C4D": enough to tell two phones apart when someone reads it out. */
export function shortUpdateId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** The line under "Check for updates": which update this phone is on. The time is Melbourne time on
 *  every phone, so two phones on the same update read the same. */
export function describeRunning(r: RunningUpdate): string {
  if (!r.isEnabled) return 'Updates are off in this version';
  if (!r.updateId || r.isEmbeddedLaunch) return 'Built-in version (no update yet)';
  const when = r.createdAt ? ` · ${formatAuDate(melbourneDate(r.createdAt.toISOString()))} ${melbourneTime(r.createdAt.toISOString())}` : '';
  return `Update ${shortUpdateId(r.updateId)}${when}`;
}

/** Check, download if there's something new (or a roll-back), then restart into it. */
export async function checkAndUpdate(api: UpdateApi, onStep: (s: UpdateStep) => void): Promise<UpdateOutcome> {
  if (!api.isEnabled) return { kind: 'off' };
  let found: Awaited<ReturnType<UpdateApi['check']>>;
  try {
    onStep('checking');
    found = await api.check();
  } catch {
    return { kind: 'failed', message: NO_SIGNAL };
  }
  if (!found.isAvailable && !found.isRollBackToEmbedded) return { kind: 'current' };
  let got: Awaited<ReturnType<UpdateApi['fetch']>>;
  try {
    onStep('downloading');
    got = await api.fetch();
  } catch {
    return { kind: 'failed', message: NO_DOWNLOAD };
  }
  if (!got.isNew && !got.isRollBackToEmbedded) return { kind: 'current' };
  try {
    onStep('restarting');
    await api.reload();
    return { kind: 'restarting' };
  } catch {
    return { kind: 'downloaded' };
  }
}

// "Update ready" strip (src/ui/UpdateReadyStrip.tsx). The phone fetches updates by itself when the
// app opens and, from here, when it comes back to the front; once one is downloaded and waiting, a
// strip offers one tap to restart into it, so nobody has to close and open the app twice.

export const UPDATE_READY_TITLE = 'Update ready';
export const UPDATE_READY_TEXT = 'Restart to load the new version.';
export const UPDATE_READY_ACTION = 'Restart';

/** Coming back to the front checks again, but no more often than this. */
export const RESUME_CHECK_GAP_MS = 10 * 60_000;

export function shouldCheckOnResume(lastCheckedMs: number | null, nowMs: number): boolean {
  return lastCheckedMs === null || nowMs - lastCheckedMs >= RESUME_CHECK_GAP_MS;
}

/** Check and download in the background, never restarting and never showing an error: true when
 *  something new is now waiting (expo-updates then marks it pending, which shows the strip). */
export async function fetchQuietly(api: UpdateApi): Promise<boolean> {
  if (!api.isEnabled) return false;
  try {
    const found = await api.check();
    if (!found.isAvailable && !found.isRollBackToEmbedded) return false;
    const got = await api.fetch();
    return got.isNew || got.isRollBackToEmbedded;
  } catch {
    return false;
  }
}

/** The strip's Restart: load the update that's already downloaded. */
export async function restartNow(api: UpdateApi): Promise<UpdateOutcome> {
  try {
    await api.reload();
    return { kind: 'restarting' };
  } catch {
    return { kind: 'downloaded' };
  }
}
