// Made-up social data for the demo build, dated from the demo's today so the Home cards always have
// something on. Nobody here is a real person, and the photos are drawn scenes.

import { addDays } from '../../domain/dates';
import type { Birthday } from '../../domain/social/shoutouts';
import type { FeedItem } from '../chat/chatContext';
import type { Mechanic } from '../../domain/social/help';
import type { Listing } from '../../domain/social/swap';
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
  // Made-up workshops: the names are invented and the numbers are the 555 range kept for drama.
  const added = '2026-09-01T00:00:00.000Z';
  const shop = (id: string, over: Partial<Mechanic> & Pick<Mechanic, 'name' | 'addedBy'>): Mechanic => ({
    id, suburb: null, phone: null, website: null, speciality: null, notes: null, addedAt: added, archivedAt: null, ...over,
  });
  const mechanics: Mechanic[] = [
    shop('mech-1', { name: 'Westside Moto Works', suburb: 'Sunshine', phone: '03 5550 1234', speciality: 'Old Japanese and British',
      notes: 'Ask for Col. Fair on price and won’t rush you.', addedBy: 'm-spanner' }),
    shop('mech-2', { name: 'Hume Highway Harley', suburb: 'Craigieburn', phone: '03 5550 9876', website: 'https://example.com',
      speciality: 'Harley servicing', addedBy: 'm-smokey' }),
    shop('mech-3', { name: 'Two Stroke Terry', suburb: 'Melton', phone: '0400 555 321', speciality: 'Carbs and two-strokes',
      notes: 'Works out of his shed. Cash only.', addedBy: 'm-rusty' }),
    shop('mech-4', { name: 'Tyre Barn', suburb: 'Laverton North', speciality: 'Tyres while you wait', addedBy: 'm-diesel' }),
  ];
  return {
    birthdays,
    pastPhotos,
    skills: [
      { memberId: 'm-diesel', skills: ['servicing', 'diagnostics', 'trailer'] },
      { memberId: 'm-sparks', skills: ['electrics', 'diagnostics'] },
      { memberId: 'm-rusty', skills: ['carbs', 'welding', 'tools'] },
      { memberId: 'm-chook', skills: ['tyres', 'wheels'] },
      { memberId: 'm-crank', skills: ['servicing', 'suspension'] },
      { memberId: 'm-ratchet', skills: ['paint'] },
    ],
    mechanics,
    vouches: [
      { mechanicId: 'mech-1', memberId: 'm-rusty', vouched: true },
      { mechanicId: 'mech-1', memberId: 'm-gravel', vouched: true },
      { mechanicId: 'mech-1', memberId: 'm-chook', vouched: true },
      { mechanicId: 'mech-2', memberId: 'm-jet', vouched: true },
      { mechanicId: 'mech-3', memberId: 'm-diesel', vouched: true },
    ],
    listings: demoListings(today),
  };
}

/** Swap and sell: a few things up, one sold last week, and one of Spanner's (the demo member) to try Edit on. */
function demoListings(today: string): Listing[] {
  const daysAgo = (n: number, hourUtc = 9) => `${addDays(today, -n)}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`;
  const item = (id: string, over: Partial<Listing> & Pick<Listing, 'sellerId' | 'kind' | 'title'>): Listing => ({
    id, priceDollars: null, details: null, photos: [], listedAt: daysAgo(3), soldAt: null, takenDownAt: null, ...over,
  });
  // Photos are the demo's drawn scenes, kept in each seller's own folder like the real thing.
  const pic = (sellerId: string, name: string) => ({ path: `${sellerId}/demo/${name}`, width: 1200, height: 900 });
  return [
    item('listing-1', { sellerId: 'm-diesel', kind: 'sell', title: 'Givi panniers, pair', priceDollars: 250, listedAt: daysAgo(1),
      details: 'Off the Tenere. Keys for both, one scuff on the left lid. Pick up Sunshine or bring to the next run.',
      photos: [pic('m-diesel', 'dusk-run.jpg')] }),
    item('listing-2', { sellerId: 'm-chook', kind: 'swap', title: 'Heated grips for a tank bag', listedAt: daysAgo(2),
      details: 'Oxford heated grips, barely used. After a magnetic tank bag.' }),
    item('listing-3', { sellerId: 'm-spanner', kind: 'sell', title: 'Dainese jacket, size 52', priceDollars: 180, listedAt: daysAgo(4),
      details: 'Armour in. Too small since the pies.', photos: [pic('m-spanner', 'servo-night.jpg')] }),
    item('listing-4', { sellerId: 'm-rusty', kind: 'free', title: 'Box of old manuals', listedAt: daysAgo(6),
      details: 'Haynes for a GS, CB and an XS. Come and get them.' }),
    item('listing-5', { sellerId: 'm-sparks', kind: 'wanted', title: 'Left mirror for a Bonneville', listedAt: daysAgo(8) }),
    item('listing-6', { sellerId: 'm-crank', kind: 'sell', title: 'Michelin Road 6, rear', priceDollars: 90, listedAt: daysAgo(12),
      soldAt: daysAgo(5), photos: [pic('m-crank', 'coast-road.jpg')] }),
  ];
}
