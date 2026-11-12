// A small confirmation at the bottom of the screen ("Saved", "Going", with an optional Undo).
// Only the latest toast is shown. Each has its own id so a timer from an older toast can never
// close a newer one. The screen part lives in ui/Toast.tsx; this is the logic.

export type ToastInput = { text: string; actionLabel?: string; onAction?: () => void };
export type Toast = ToastInput & { id: number; shownAt: number };
export type ToastState = { current: Toast | null; lastId: number };

export const initialToasts: ToastState = { current: null, lastId: 0 };

export function pushToast(state: ToastState, input: ToastInput, now: number = Date.now()): ToastState {
  const id = state.lastId + 1;
  return { current: { ...input, id, shownAt: now }, lastId: id };
}

/** Closes the toast with this id. A different (newer) toast is left alone. */
export function dismissToast(state: ToastState, id: number): ToastState {
  return state.current?.id === id ? { ...state, current: null } : state;
}

/** How long a toast stays: long enough to hit Undo when there is one, and three times as long with a screen reader on. */
export function toastDuration(t: ToastInput, screenReaderOn = false): number {
  return (t.onAction ? 10000 : 3500) * (screenReaderOn ? 3 : 1);
}

/**
 * Moving to another screen clears a toast that has been up for minAgeMs or more, so it never sits
 * over the next screen. One shown a moment ago stays: a save toast is shown just before going back.
 */
export function clearIfOlder(state: ToastState, now: number, minAgeMs: number): ToastState {
  return state.current && now - state.current.shownAt >= minAgeMs ? { ...state, current: null } : state;
}
