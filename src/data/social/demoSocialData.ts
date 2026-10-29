// Made-up social data for the demo build, dated from the demo's today so the Home cards always have
// something on. Nobody here is a real person, and the photos are drawn scenes.

import { addDays } from '../../domain/dates';
import type { Birthday } from '../../domain/social/shoutouts';
import type { FeedItem } from '../chat/chatContext';
import type { Mechanic } from '../../domain/social/help';
import type { Listing } from '../../domain/social/swap';
import type { BuildUpdate } from '../../domain/social/builds';
import type { HistoryEntry, Honour } from '../../domain/social/history';
import type { Award, Nomination, Vote } from '../../domain/social/brag';
import type { ClubInvite, OtherClub } from '../../domain/invites';
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
    buildUpdates: demoBuildUpdates(today),
    history: DEMO_HISTORY,
    honours: DEMO_HONOURS,
    ...demoBragging(today),
    ...demoInvites(today),
  };
}

/**
 * Invites to and from other clubs (made-up clubs). In: the Toy Run, accepted and on the calendar;
 * Ride for Kids, accepted but not linked yet (so the calendar suggestion shows); a bike show ride
 * Spanner passed on that nobody has answered. Out: two clubs asked to the Christmas ride.
 */
function demoInvites(today: string): { otherClubs: OtherClub[]; invites: ClubInvite[] } {
  const at = '2026-10-10T00:00:00.000Z';
  const club = (id: string, name: string, town: string, contact: string | null, addedBy: string): OtherClub => ({
    id, name, town, contact, note: null, addedBy, addedAt: at, archivedAt: null,
  });
  const otherClubs: OtherClub[] = [
    club('oc-1', 'Grease Monkeys MCC', 'Werribee', 'Big Al, 0400 555 101', 'm-rusty'),
    club('oc-2', 'Southern Cross Cruisers', 'Geelong', 'Their Facebook page', 'm-diesel'),
    club('oc-3', 'Goldfields Gearheads', 'Bendigo', null, 'm-spanner'),
  ];
  const base = {
    rideId: null, title: null, eventOn: null, place: null, details: null, answer: 'waiting' as const, calendarLabel: null,
    bikes: null, note: null, addedAt: at, answeredBy: null, answeredAt: null, archivedAt: null,
  };
  const invites: ClubInvite[] = [
    { ...base, id: 'inv-1', direction: 'in', clubId: 'oc-1', chapterId: null, rideId: 'r-3', title: 'Toy Run', eventOn: '2026-11-29',
      place: 'Werribee Racecourse', details: 'Charity run for the children’s hospital. Bring a wrapped toy.', answer: 'yes',
      calendarLabel: 'non_nuts', addedBy: 'm-rusty', answeredBy: 'm-rusty', answeredAt: '2026-10-12T00:00:00.000Z' },
    { ...base, id: 'inv-2', direction: 'in', clubId: 'oc-2', chapterId: 'ch-west', title: 'Ride for Kids', eventOn: '2027-01-17',
      place: 'Geelong Waterfront', answer: 'yes', calendarLabel: 'supported', note: 'Rusty Bus on recovery.', addedBy: 'm-diesel',
      answeredBy: 'm-diesel', answeredAt: '2026-10-14T00:00:00.000Z' },
    { ...base, id: 'inv-3', direction: 'in', clubId: 'oc-3', chapterId: 'ch-west', title: 'Bike show ride', eventOn: addDays(today, 20),
      place: 'Bendigo Showgrounds', details: 'They ride in together from Castlemaine and park up at the show.', addedBy: 'm-spanner' },
    { ...base, id: 'inv-4', direction: 'out', clubId: 'oc-1', chapterId: null, rideId: 'r-4', answer: 'yes', bikes: 15,
      addedBy: 'm-rusty', answeredBy: 'm-rusty', answeredAt: '2026-10-20T00:00:00.000Z' },
    { ...base, id: 'inv-5', direction: 'out', clubId: 'oc-3', chapterId: null, rideId: 'r-4', addedBy: 'm-rusty' },
  ];
  return { otherClubs, invites };
}

/**
 * Bragging rights: Ride of the year is being voted on, Best breakdown story is taking nominations,
 * and last year's Best photo has its winner. The rides are the demo's made-up ones from earlier on.
 */
function demoBragging(today: string): { awards: Award[]; nominations: Nomination[]; bragVotes: Vote[] } {
  const year = Number(today.slice(0, 4));
  const awards: Award[] = [
    { id: 'award-rides', kind: 'ride', title: `Ride of the year ${year}`, year, nominationsClose: addDays(today, -2),
      votingClose: addDays(today, 12), openedBy: 'm-rusty', archivedAt: null },
    { id: 'award-stories', kind: 'story', title: 'Best breakdown story', year, nominationsClose: addDays(today, 9),
      votingClose: addDays(today, 23), openedBy: 'm-torque', archivedAt: null },
    { id: 'award-photos', kind: 'photo', title: `Best photo ${year - 1}`, year: year - 1, nominationsClose: addDays(today, -60),
      votingClose: addDays(today, -40), openedBy: 'm-rusty', archivedAt: null },
  ];
  const at = `${addDays(today, -20)}T00:00:00.000Z`;
  const n = (id: string, awardId: string, by: string, over: Partial<Nomination>): Nomination => ({
    id, awardId, nominatedBy: by, rideId: null, title: null, photo: null, story: null, reason: null, nominatedAt: at, withdrawnAt: null, ...over,
  });
  const pic = (who: string, name: string, width = 1200, height = 900) => ({ path: `${who}/demo/${name}`, width, height });
  const nominations: Nomination[] = [
    n('nom-1', 'award-rides', 'm-diesel', { rideId: 'r-brag-3', reason: 'Two days of the best roads in the state, and nobody fell off.' }),
    n('nom-2', 'award-rides', 'm-chook', { rideId: 'r-brag-1', reason: 'Sunset over the Grampians. Enough said.' }),
    n('nom-3', 'award-rides', 'm-smokey', { rideId: 'r-big4-past' }),
    n('nom-4', 'award-stories', 'm-gravel', { title: 'The Ballan fuel line',
      story: 'Diesel’s fuel line split 20 k out of Ballan. Fixed with a biro tube and electrical tape. Made it home.' }),
    n('nom-5', 'award-photos', 'm-sparks', { title: 'Servo at midnight', photo: pic('m-sparks', 'servo-night.jpg') }),
    n('nom-6', 'award-photos', 'm-diesel', { title: 'Coast road', photo: pic('m-diesel', 'coast-road.jpg') }),
    n('nom-7', 'award-photos', 'm-rusty', { title: 'Twisties', photo: pic('m-rusty', 'twisties.jpg', 900, 1200) }),
  ];
  const v = (awardId: string, memberId: string, nominationId: string): Vote => ({ awardId, memberId, nominationId });
  const bragVotes: Vote[] = [
    v('award-rides', 'm-rusty', 'nom-1'),
    v('award-rides', 'm-torque', 'nom-2'),
    v('award-photos', 'm-torque', 'nom-6'),
    v('award-photos', 'm-chook', 'nom-6'),
    v('award-photos', 'm-gravel', 'nom-6'),
    v('award-photos', 'm-spanner', 'nom-5'),
    v('award-photos', 'm-jet', 'nom-7'),
  ];
  return { awards, nominations, bragVotes };
}

/** A made-up story of the club, from its first ride on. The founding comes from the founder positions. */
const DEMO_HISTORY: HistoryEntry[] = [
  { id: 'history-1', happenedOn: '2019-04-13', precision: 'day', title: 'The first club ride',
    story: 'Six bikes out to Daylesford and back. It rained the whole way home.', addedBy: 'm-torque', archivedAt: null },
  { id: 'history-2', happenedOn: '2019-11-01', precision: 'month', title: 'Patches arrive',
    story: 'The first run of RUSTNUTS patches, sewn on at the pub that night.', addedBy: 'm-torque', archivedAt: null },
  { id: 'history-3', happenedOn: '2020-01-01', precision: 'year', title: 'A year of riding alone',
    story: 'Lockdowns kept us apart, so the group chat did the riding.', addedBy: 'm-rusty', archivedAt: null },
  { id: 'history-4', happenedOn: '2021-08-21', precision: 'day', title: 'North chapter starts',
    story: 'Smokey and the Hume Highway crew become the North chapter.', addedBy: 'm-rusty', archivedAt: null },
  { id: 'history-5', happenedOn: '2022-12-01', precision: 'month', title: 'The Rusty Bus joins the club',
    story: 'An old Coaster bought for charity rides and getting broken bikes home.', addedBy: 'm-rusty', archivedAt: null },
  { id: 'history-6', happenedOn: '2024-03-16', precision: 'day', title: 'First toy run',
    story: 'Forty bikes and a bus full of toys for the hospital.', addedBy: 'm-diesel', archivedAt: null },
];

const DEMO_HONOURS: Honour[] = [
  { id: 'honour-1', memberId: 'm-torque', name: null, honour: 'Life member', year: 2024,
    note: 'There from the first ride.', addedBy: 'm-rusty', archivedAt: null },
  { id: 'honour-2', memberId: 'm-diesel', name: null, honour: 'Rider of the year', year: 2025,
    note: 'Most kays on club rides.', addedBy: 'm-rusty', archivedAt: null },
  { id: 'honour-3', memberId: null, name: 'Big Kev', honour: 'Honorary member', year: 2023,
    note: 'Fixed half the club’s bikes for a carton.', addedBy: 'm-rusty', archivedAt: null },
];

/** Build threads: Diesel's BSA coming back to life, and Spanner's CB750 (the demo member's, to post on). */
function demoBuildUpdates(today: string): BuildUpdate[] {
  const daysAgo = (n: number) => `${addDays(today, -n)}T08:30:00.000Z`;
  const pic = (memberId: string, name: string) => ({ path: `${memberId}/demo/${name}`, width: 1200, height: 900 });
  const u = (id: string, bikeId: string, authorId: string, n: number, body: string | null, photos: BuildUpdate['photos'] = []): BuildUpdate => ({
    id, bikeId, authorId, body, photos, postedAt: daysAgo(n), takenDownAt: null,
  });
  return [
    u('build-1', 'b-20', 'm-diesel', 90, 'Dragged her out of a shed in Ballan. Seized, but all there. Matching numbers.', [pic('m-diesel', 'servo-night.jpg')]),
    u('build-2', 'b-20', 'm-diesel', 41, 'Engine’s out and on the bench. Bores are better than I hoped.'),
    u('build-3', 'b-20', 'm-diesel', 2, 'First kick in 30 years and she fired. Took it round the block.', [pic('m-diesel', 'dusk-run.jpg'), pic('m-diesel', 'coast-road.jpg')]),
    u('build-4', 'b-7', 'm-spanner', 20, 'Carbs stripped and soaking. Anyone got a spare float bowl gasket?'),
  ];
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
