// Whether this phone is on the live club or in the store reviewers' demo. A live build normally talks
// to the club database; once the review login is used it runs on the demo's made-up members instead,
// and keeps doing so (like a member staying signed in) until Sign out. Nothing live runs until the
// saved mode has been read.

import type { KeyValue } from './liveQueue';

const KEY = 'app.review-mode.v1';

export function createAppMode(store: KeyValue, liveBuild: boolean) {
  let loaded = false;
  let reviewing = false;
  const listeners = new Set<() => void>();
  const switches = new Set<() => void>();
  const tell = () => listeners.forEach((l) => l());
  const flip = async (on: boolean) => {
    const changed = reviewing !== on;
    reviewing = on;
    tell();
    if (changed) switches.forEach((l) => l());
    await (on ? store.setItem(KEY, '1') : store.removeItem(KEY)).catch(() => {});
  };

  let reading: Promise<void> | null = null;
  const load = (): Promise<void> =>
    (reading ??= (async () => {
      try {
        reviewing = (await store.getItem(KEY)) === '1';
      } catch {
        reviewing = false;
      }
      loaded = true;
      tell();
    })());

  return {
    /** Reads the saved mode, once; later calls wait for the same read. */
    load,
    loaded: () => loaded,
    reviewing: () => reviewing,
    /** Whether the app may use the live club database right now. */
    liveDataOn: () => liveBuild && loaded && !reviewing,
    startReview: () => flip(true),
    endReview: () => flip(false),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    /** Hears only a real switch into or out of the review demo, not the first read at start-up. */
    onSwitch: (l: () => void) => {
      switches.add(l);
      return () => {
        switches.delete(l);
      };
    },
  };
}

export type AppMode = ReturnType<typeof createAppMode>;
