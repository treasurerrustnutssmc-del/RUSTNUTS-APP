// Where a signed-in person should be, given how far loading has got. Kept apart from the
// provider so it can be tested: "not loaded yet" and "failed to load" must never be
// mistaken for "hasn't applied yet".

export type SessionView = 'signed-out' | 'loading' | 'error' | 'needs-application' | 'ready';

export function sessionView(s: {
  userId: string | null;
  /** Whose data is currently loaded (null before the first successful load). */
  loadedFor: string | null;
  loadError: string | null;
  hasMe: boolean;
}): SessionView {
  if (!s.userId) return 'signed-out';
  if (s.loadedFor === s.userId) {
    if (s.hasMe) return 'ready';
    // Data from before they applied: if the reload since then failed, don't show the join form again.
    return s.loadError ? 'error' : 'needs-application';
  }
  return s.loadError ? 'error' : 'loading';
}

/** A refresh that failed while the person's data is still on screen: worth a small notice. */
export function refreshError(view: SessionView, loadError: string | null): string | null {
  return view === 'ready' || view === 'needs-application' ? loadError : null;
}
