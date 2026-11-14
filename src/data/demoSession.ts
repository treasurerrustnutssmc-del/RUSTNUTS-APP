// One instant per demo session. The first `now()` after a mode change reads the clock; later calls
// give back the same instant, so every demo seed is built for the same moment and stays put until
// the reviewer signs out and back in, or the app is fully closed and opened again. Pure.

export interface DemoSession {
  now(): Date;
}

/** `onModeChange` registers a listener (appMode.subscribe); `read` is the clock. */
export function createDemoSession(onModeChange: (listener: () => void) => unknown, read: () => Date = () => new Date()): DemoSession {
  let current: Date | null = null;
  onModeChange(() => {
    current = null;
  });
  return {
    now() {
      current ??= read();
      return current;
    },
  };
}
