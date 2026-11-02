// The notifications explainer: a card in the app that says what notifications are for before the
// phone's own prompt comes up. The prompt only comes after "Turn on notifications". "Not now" just
// puts the card away; the Notifications section on Me can still ask. src/ui/NotificationIntro.tsx
// shows it and src/data/notifyIntro.ts keeps the answer on the phone.

import { phoneNotificationState } from './notifications';

/** The card's answer on this phone: turned on, not now, never answered, or undefined while it's read. */
export type IntroAnswer = 'on' | 'later' | null | undefined;

export const NOTIFY_INTRO = {
  title: 'Stay in the loop',
  body: 'Rustnuts can let you know when it matters on the road. You choose which ones under Me, Notifications.',
  points: ['Ride reminders', 'Live ride alerts', 'Chat messages'],
  turnOn: 'Turn on notifications',
  notNow: 'Not now',
} as const;

/** Whether the card shows: on a phone that can still be asked, until it's answered on this phone. */
export function showNotifyIntro(p: {
  os: string;
  permission: { granted: boolean; canAskAgain: boolean } | null;
  answer: IntroAnswer;
}): boolean {
  if (p.os !== 'ios' && p.os !== 'android') return false;
  if (p.answer !== null) return false;
  return phoneNotificationState(p.permission) === 'ask';
}

/** Whether the app may bring up the phone's prompt by itself (the reminders and push sign-up do,
 *  once): only after the member chose to turn notifications on. */
export function mayAskAutomatically(answer: IntroAnswer): boolean {
  return answer === 'on';
}
