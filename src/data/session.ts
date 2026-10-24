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
  if (s.loadedFor === s.userId) return s.hasMe ? 'ready' : 'needs-application';
  return s.loadError ? 'error' : 'loading';
}
