// Notifications are on by default: after the first sign-in the phone's own prompt comes up by itself.
// The answer is kept on the phone (src/data/notifyIntro.ts), so after a no nothing asks again by
// itself; the Notifications section on Me can still ask.

/** This phone's answer: turned on, said no, never answered, or undefined while it's read. */
export type IntroAnswer = 'on' | 'later' | null | undefined;

/** Whether the app may bring up the phone's prompt by itself (the push sign-up does after the first
 *  sign-in, once, and the ride reminders do): notifications are on by default, so yes unless the
 *  member said no. Not while the answer is still being read. */
export function mayAskAutomatically(answer: IntroAnswer): boolean {
  return answer === 'on' || answer === null;
}
