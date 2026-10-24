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
