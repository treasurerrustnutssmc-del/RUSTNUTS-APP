// One file pick at a time. A double tap on Pick GPX file would otherwise open a second picker,
// which phones refuse ("Different document picking in progress"). Each pick gets a token, so a
// pick that settles late (after the web released the guard on focus) can't free a newer one.

export interface PickGuard {
  /** Starts a pick and returns its token, or null when one is already running. */
  start(): number | null;
  /** Ends the pick with this token, if it's still the current one. */
  release(token: number): void;
  readonly busy: boolean;
}

export function createPickGuard(onChange: (busy: boolean) => void): PickGuard {
  let current = 0;
  let busy = false;
  return {
    start() {
      if (busy) return null;
      busy = true;
      current += 1;
      onChange(true);
      return current;
    },
    release(token) {
      if (!busy || token !== current) return;
      busy = false;
      onChange(false);
    },
    get busy() {
      return busy;
    },
  };
}

/** What releaseAfterReturn needs from the browser window, so it can be tried without one. */
export interface ReturnWatch {
  /** Calls `fn` the next time the window gets focus back, once. Returns a function that stops it. */
  onFocusOnce(fn: () => void): () => void;
  /** How many file choices have arrived so far, from any pick. */
  changes(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** How long after the window gets focus back a pick waits for its file before it counts as backed out. */
export const RETURN_GRACE_MS = 300;

/**
 * Web only. Browsers without the file input's cancel event never settle a backed-out pick, so the
 * window getting focus back (the file chooser closing) frees it instead. Focus can come a little
 * before the input's change, so this waits RETURN_GRACE_MS first, and frees the pick only if no
 * file arrived since the watch began; a pick that got a file frees itself when it settles.
 * Returns a function that stops watching.
 */
export function releaseAfterReturn(env: ReturnWatch, release: () => void, graceMs = RETURN_GRACE_MS): () => void {
  const before = env.changes();
  let timer: unknown = null;
  const stopFocus = env.onFocusOnce(() => {
    timer = env.setTimeout(() => {
      timer = null;
      if (env.changes() === before) release();
    }, graceMs);
  });
  return () => {
    stopFocus();
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  };
}
