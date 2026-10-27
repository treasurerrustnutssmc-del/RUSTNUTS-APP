// Made-up social data for the demo build, dated from the demo's today so the Home shout-outs
// always have someone on. Nobody here is a real person.

import { addDays } from '../../domain/dates';
import type { Birthday } from '../../domain/social/shoutouts';
import type { SocialData } from './demoSocialActions';

const monthDay = (iso: string) => ({ month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });

/** Birthdays: Torque's today, Smokey's in three days, Rusty's in a fortnight (outside the card). */
export function demoSocialData(today: string): SocialData {
  const birthdays: Birthday[] = [
    { memberId: 'm-torque', ...monthDay(today) },
    { memberId: 'm-smokey', ...monthDay(addDays(today, 3)) },
    { memberId: 'm-rusty', ...monthDay(addDays(today, 14)) },
  ];
  return { birthdays };
}
