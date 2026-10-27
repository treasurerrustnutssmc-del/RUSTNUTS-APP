// Made-up social data for the demo build, dated from the demo's today so the Home cards always have
// something on. Nobody here is a real person, and the photos are drawn scenes.

import { addDays } from '../../domain/dates';
import type { Birthday } from '../../domain/social/shoutouts';
import type { FeedItem } from '../chat/chatContext';
import type { SocialData } from './demoSocialActions';

const monthDay = (iso: string) => ({ month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });

/** Noon in Melbourne on a date some years before today, as an instant (an hour either way of daylight saving is still the same day). */
const yearsBack = (today: string, years: number, hourUtc = 1) =>
  `${Number(today.slice(0, 4)) - years}${today.slice(4)}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`;

const photo = (id: string, path: string, authorId: string, createdAt: string, width = 1200, height = 900): FeedItem => ({
  id, messageId: `past-${id}`, kind: 'photo', path, posterPath: null, width, height, durationMs: null, position: 0,
  conversationId: 'club', authorId, createdAt,
});

/**
 * Birthdays: Torque's today, Smokey's in three days, Rusty's in a fortnight (outside the card).
 * On this day: two photos from a year ago and one from three years ago, posted in the club chat.
 */
export function demoSocialData(today: string): SocialData {
  const birthdays: Birthday[] = [
    { memberId: 'm-torque', ...monthDay(today) },
    { memberId: 'm-smokey', ...monthDay(addDays(today, 3)) },
    { memberId: 'm-rusty', ...monthDay(addDays(today, 14)) },
  ];
  // 29 February has no date a year back, so those photos sit on the 28th, and the demo's On this day
  // is empty on a leap day.
  const back = (years: number, hour?: number) => yearsBack(today.endsWith('02-29') ? `${today.slice(0, 5)}02-28` : today, years, hour);
  const pastPhotos: FeedItem[] = [
    photo('otd-1', 'demo/coast-road.jpg', 'm-diesel', back(1, 3)),
    photo('otd-2', 'demo/servo-night.jpg', 'm-sparks', back(1, 1)),
    photo('otd-3', 'demo/twisties.jpg', 'm-rusty', back(3, 2), 900, 1200),
  ];
  return { birthdays, pastPhotos };
}
