// Turns database errors into something a member can act on. Messages our own database
// actions raise (code P0001) are already written for members; anything else is replaced,
// so table names and constraint text never reach the screen.

export function friendlyError(error: { message?: string; code?: string } | null | undefined): Error {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';
  if (code === 'P0001' && msg) return new Error(msg);
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new Error("You're not allowed to do that.");
  }
  if (code === '23505') return new Error('That’s already taken. Pull down to refresh and try again.');
  if (code === '23503') return new Error('That record has changed or no longer exists. Pull down to refresh.');
  if (code.startsWith('23') || code.startsWith('22')) return new Error('Something you entered isn’t valid. Check it and try again.');
  if (/network|fetch|timed? ?out/i.test(msg)) return new Error('No connection. Check your signal and try again.');
  if (/otp|token/i.test(msg) && /expired|invalid/i.test(msg)) {
    return new Error('That code didn’t work. Check it, or ask for a new one.');
  }
  if (/email/i.test(msg) && /invalid/i.test(msg)) return new Error('Check the email address and try again.');
  if (/rate limit|too many/i.test(msg)) return new Error('Too many tries. Wait a minute and try again.');
  return new Error('Something went wrong. Try again.');
}
