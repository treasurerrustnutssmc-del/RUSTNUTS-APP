// How often a sharing phone posts its position. Android's location service hands over a fix every
// 30 seconds at most (timeInterval), but iOS ignores timeInterval: the task gets a fix every second
// or so while the app is open, and only batches them (deferredUpdatesInterval) once it's in the
// background. So the phone decides for itself which fixes are worth a post. Pure, so it's testable;
// liveTracker.ts holds the state between fixes.

/** The least time between two position posts. The same as iOS's deferral, so the two never fight. */
export const FIX_POST_GAP_MS = 25_000;

export interface FixThrottle {
  /** A post hasn't answered yet. */
  inFlight: boolean;
  /** When the last post was started (ms since the epoch), null before the first. */
  lastAttemptAt: number | null;
}

export const NO_POSTS: FixThrottle = { inFlight: false, lastAttemptAt: null };

/**
 * Whether this fix should be posted. The first fix of a share always goes; after that one at a
 * time and at most one every 25 seconds, counted from the attempt (a failed post isn't retried any
 * sooner than a good one). An alert or stop waiting for signal skips the wait: a post is how the
 * phone finds out signal is back and sends what's queued, and an emergency mustn't sit for 25 s. It
 * still waits for a post already in flight, or a phone with no signal would start one every second.
 */
export function shouldPostFix(t: FixThrottle, now: number, queued: boolean): boolean {
  if (t.inFlight) return false;
  if (queued) return true;
  if (t.lastAttemptAt === null) return true;
  return now - t.lastAttemptAt >= FIX_POST_GAP_MS;
}

export const beforePost = (t: FixThrottle, now: number): FixThrottle => ({ ...t, inFlight: true, lastAttemptAt: now });
export const afterPost = (t: FixThrottle): FixThrottle => ({ ...t, inFlight: false });
