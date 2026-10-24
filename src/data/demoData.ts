// Made-up example members for the demo build. Nobody here is a real person.
// Replaced by the live database once Supabase is connected.

import { readGpx } from '../domain/gpx';
import type { ClubData, Member, MemberPrivate, Ride, Route } from '../domain/types';

const member = (m: Partial<Member> & Pick<Member, 'id' | 'chapterId' | 'fullName' | 'status'>): Member => ({
  roadName: null,
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  bio: null,
  sharePhone: false,
  appliedOn: null,
  onHiatus: false,
  ...m,
});

const priv = (p: Partial<MemberPrivate> & Pick<MemberPrivate, 'memberId'>): MemberPrivate => ({
  email: null,
  phone: null,
  licenceClass: 'full_open',
  licenceExpiry: null,
  firstAidExpiry: null,
  introducedBy: null,
  applicationNote: null,
  ...p,
});

/**
 * An instant `days` days after today (UTC), at a UTC clock time. The demo's other rides are fixed
 * dates; North coffee and curves uses this so there's always a ride in the next fortnight with no
 * Tail Gunner, and crew managers see the "Crew needed" tag whatever the real date.
 */
const daysFromNow = (days: number, utcTime: string): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 10)}T${utcTime}`;
};

// ---- Made-up routes ----
// Each is a handful of real towns (lat, lng, metres up) joined with in-between points that wander
// a little, as a road does, written out as a GPX file. The summary each route shows is read back
// from that file by the app's own GPX reader, so the demo looks exactly as an uploaded file would.

type Town = [lat: number, lng: number, ele: number];
type Stop = { name: string; lat: number; lng: number };

/** The towns joined up, `between` points on each leg, with a small steady sideways wander. */
function road(towns: Town[], between = 3): Town[] {
  const out: Town[] = [];
  towns.forEach((to, leg) => {
    if (leg === 0) return void out.push(to);
    const from = towns[leg - 1];
    for (let k = 1; k <= between + 1; k++) {
      const t = k / (between + 1);
      const wander = k <= between ? Math.sin(leg * 2.1 + k * 1.7) * 0.006 : 0;
      out.push([
        +(from[0] + (to[0] - from[0]) * t + wander).toFixed(5),
        +(from[1] + (to[1] - from[1]) * t - wander).toFixed(5),
        Math.round(from[2] + (to[2] - from[2]) * t + Math.abs(wander) * 4000),
      ]);
    }
  });
  return out;
}

/** A GPX 1.1 file of stops and one track, as a route planner writes one. */
function gpxFile(name: string, points: Town[], stops: Stop[]): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const wpts = stops.map((w) => `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${esc(w.name)}</name></wpt>`);
  const trkpts = points.map(([lat, lng, ele]) => `      <trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele></trkpt>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Rustnuts demo" xmlns="http://www.topografix.com/GPX/1/1">',
    ...wpts,
    `  <trk><name>${esc(name)}</name><trkseg>`,
    ...trkpts,
    '  </trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n');
}

const DEMO_ROUTES: { route: Omit<Route, 'distanceM' | 'climbM' | 'line' | 'stops' | 'bounds' | 'archivedAt'>; towns: Town[]; stops: Stop[] }[] = [
  {
    route: { id: 'rt-west-loop', name: 'Daylesford breakfast loop', chapterId: 'ch-west', updatedAt: '2026-10-18T09:00:00.000Z',
      notes: 'Out through Bacchus Marsh and Ballan, breakfast in Daylesford, home over Blackwood and Myrniong.' },
    towns: [
      [-37.835, 144.795, 15], [-37.9, 144.661, 15], [-37.8, 144.556, 110], [-37.675, 144.438, 105], [-37.6, 144.226, 430],
      [-37.341, 144.143, 620], [-37.474, 144.304, 520], [-37.618, 144.35, 300], [-37.683, 144.585, 90], [-37.73, 144.66, 70],
      [-37.835, 144.795, 15],
    ],
    stops: [
      { name: 'KSU, Laverton North servo', lat: -37.835, lng: 144.795 },
      { name: 'Fuel, Bacchus Marsh', lat: -37.675, lng: 144.438 },
      { name: 'Breakfast, Daylesford', lat: -37.341, lng: 144.143 },
    ],
  },
  {
    route: { id: 'rt-north-hills', name: 'Kinglake hills', chapterId: 'ch-north', updatedAt: '2026-10-12T09:00:00.000Z',
      notes: 'Tight and steep up the Kinglake range. Watch for gravel on the corners after rain.' },
    towns: [
      [-37.603, 145.097, 150], [-37.512, 145.118, 200], [-37.493, 145.18, 330], [-37.474, 145.225, 520], [-37.522, 145.34, 550],
      [-37.593, 145.27, 200], [-37.64, 145.193, 100], [-37.673, 145.158, 110], [-37.57, 145.105, 170], [-37.603, 145.097, 150],
    ],
    stops: [
      { name: 'Coffee, Whittlesea', lat: -37.512, lng: 145.118 },
      { name: 'Kinglake lookout', lat: -37.522, lng: 145.34 },
      { name: 'Regroup, Hurstbridge', lat: -37.64, lng: 145.193 },
    ],
  },
  {
    route: { id: 'rt-club-run', name: 'Two chapters run', chapterId: null, updatedAt: '2026-10-05T09:00:00.000Z',
      notes: 'From the clubhouse up to Lancefield for lunch, then across to Kilmore and home through the North.' },
    towns: [
      [-37.866, 144.745, 20], [-37.745, 144.735, 70], [-37.627, 144.719, 180], [-37.577, 144.727, 200], [-37.465, 144.678, 400],
      [-37.351, 144.743, 470], [-37.278, 144.733, 480], [-37.296, 144.953, 400], [-37.416, 144.978, 300], [-37.6, 144.943, 170],
    ],
    stops: [
      { name: 'Regroup, Sunbury', lat: -37.577, lng: 144.727 },
      { name: 'Lunch, Lancefield', lat: -37.278, lng: 144.733 },
      { name: 'Finish, Craigieburn', lat: -37.6, lng: 144.943 },
    ],
  },
];

/** Each demo route's GPX file, by route id. The demo hands these out as `routeGpx`. */
export const DEMO_ROUTE_GPX: Record<string, string> = Object.fromEntries(
  DEMO_ROUTES.map((d) => [d.route.id, gpxFile(d.route.name, road(d.towns), d.stops)]),
);

const demoRoutes: Route[] = DEMO_ROUTES.map(({ route }) => {
  const summary = readGpx(DEMO_ROUTE_GPX[route.id]);
  if (typeof summary === 'string') throw new Error(`Demo route ${route.name}: ${summary}`);
  const { name: _fileName, ...shape } = summary; // the route keeps its own name
  return { ...route, ...shape, archivedAt: null };
});

export const DEMO_DATA: ClubData = {
  chapters: [
    { id: 'ch-west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
    { id: 'ch-north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
  ],

  members: [
    // West
    member({ id: 'm-rusty', chapterId: 'ch-west', fullName: 'Gary Kowalski', roadName: 'Rusty', status: 'full', joinedOn: '2019-05-11', patchedOn: '2020-04-18', sharePhone: true, bio: 'Founding member. If it has two wheels and leaks oil, I want it.' }),
    member({ id: 'm-torque', chapterId: 'ch-west', fullName: 'Tania Walsh', roadName: 'Torque', status: 'full', joinedOn: '2020-02-08', patchedOn: '2021-02-20' }),
    member({ id: 'm-diesel', chapterId: 'ch-west', fullName: 'Dean Mercer', roadName: 'Diesel', status: 'full', joinedOn: '2019-09-14', patchedOn: '2020-09-26', sharePhone: true }),
    member({ id: 'm-sparks', chapterId: 'ch-west', fullName: 'Lisa Romano', roadName: 'Sparks', status: 'full', joinedOn: '2021-06-05', patchedOn: '2022-06-18', sharePhone: true }),
    member({ id: 'm-gravel', chapterId: 'ch-west', fullName: 'Brett Hughes', roadName: 'Gravel', status: 'full', joinedOn: '2020-11-21', patchedOn: '2021-11-27' }),
    member({ id: 'm-spanner', chapterId: 'ch-west', fullName: 'Mick Doherty', roadName: 'Spanner', status: 'full', joinedOn: '2022-03-12', patchedOn: '2023-03-25', sharePhone: true, bio: 'Tail Gunner. Carries the first aid kit and the cable ties.' }),
    member({ id: 'm-chook', chapterId: 'ch-west', fullName: 'Shane Fitzgerald', roadName: 'Chook', status: 'full', joinedOn: '2022-08-20', patchedOn: '2023-09-02' }),
    member({ id: 'm-throttle', chapterId: 'ch-west', fullName: 'Nikki Barnes', roadName: 'Throttle', status: 'fng', joinedOn: '2025-12-13', fngStartedOn: '2026-03-21', sharePhone: true }),
    member({ id: 'm-patches', chapterId: 'ch-west', fullName: 'Paul Nguyen', roadName: 'Patches', status: 'supporter', joinedOn: '2024-04-06' }),
    member({ id: 'm-kerry', chapterId: 'ch-west', fullName: 'Kerry Mercer', status: 'family', joinedOn: '2021-01-16' }),
    member({ id: 'm-rooster', chapterId: 'ch-west', fullName: 'Rob Kennedy', roadName: 'Rooster', status: 'legacy', joinedOn: '2019-06-15', patchedOn: '2020-01-18', bio: 'Patched in 2020. Moved on in 2025, still drops in for a beer.' }),
    // North
    member({ id: 'm-smokey', chapterId: 'ch-north', fullName: 'Steve Brennan', roadName: 'Smokey', status: 'full', joinedOn: '2023-01-28', patchedOn: '2024-02-10', sharePhone: true }),
    member({ id: 'm-jet', chapterId: 'ch-north', fullName: 'Jodie Harper', roadName: 'Jet', status: 'full', joinedOn: '2023-02-25', patchedOn: '2024-03-09', sharePhone: true }),
    member({ id: 'm-crank', chapterId: 'ch-north', fullName: 'Craig Morrison', roadName: 'Crank', status: 'full', joinedOn: '2023-04-15', patchedOn: '2024-05-04' }),
    member({ id: 'm-ace', chapterId: 'ch-north', fullName: 'Aaron Delaney', roadName: 'Ace', status: 'full', joinedOn: '2024-01-20', patchedOn: '2025-02-01', sharePhone: true }),
    member({ id: 'm-ratchet', chapterId: 'ch-north', fullName: 'Ray Simmons', roadName: 'Ratchet', status: 'nomad', joinedOn: '2023-03-11', patchedOn: '2024-03-23', bio: 'Moved to the Sunshine Coast in 2025. Phones in to North meetings.' }),
    member({ id: 'm-lefty', chapterId: 'ch-north', fullName: 'Luke Carter', roadName: 'Lefty', status: 'fng', joinedOn: '2026-04-18', fngStartedOn: '2026-07-25' }),
    member({ id: 'm-ben', chapterId: 'ch-north', fullName: 'Ben Whitfield', status: 'introduced', joinedOn: '2026-09-26' }),
    // Waiting for approval
    member({ id: 'm-dylan', chapterId: 'ch-west', fullName: 'Dylan Pryce', status: 'introduced', approval: 'pending', appliedOn: '2026-10-21' }),
    member({ id: 'm-josh', chapterId: 'ch-north', fullName: 'Josh Tran', status: 'family', approval: 'pending', appliedOn: '2026-10-23' }),
  ],

  privates: [
    priv({ memberId: 'm-rusty', email: 'rusty@example.com', phone: '0412 555 100', licenceExpiry: '2029-06-30' }),
    priv({ memberId: 'm-torque', email: 'torque@example.com', phone: '0423 555 214', licenceExpiry: '2027-09-03' }),
    priv({ memberId: 'm-diesel', email: 'diesel@example.com', phone: '0438 555 377', licenceExpiry: '2028-05-19', firstAidExpiry: '2027-02-11' }),
    priv({ memberId: 'm-sparks', email: 'sparks@example.com', phone: '0401 555 468', licenceExpiry: '2030-01-08' }),
    priv({ memberId: 'm-gravel', email: 'gravel@example.com', phone: '0415 555 592', licenceExpiry: '2026-11-15' }),
    priv({ memberId: 'm-spanner', email: 'spanner@example.com', phone: '0427 555 603', licenceExpiry: '2028-02-14', firstAidExpiry: '2027-07-01' }),
    priv({ memberId: 'm-chook', email: 'chook@example.com', phone: '0433 555 719', licenceExpiry: null }),
    priv({ memberId: 'm-throttle', email: 'throttle@example.com', phone: '0409 555 826', licenceClass: 'probationary_open', licenceExpiry: '2027-01-30' }),
    priv({ memberId: 'm-patches', email: 'patches@example.com', phone: '0419 555 937', licenceExpiry: '2028-08-22' }),
    priv({ memberId: 'm-kerry', email: 'kerry@example.com', phone: '0402 555 048', licenceClass: null }),
    priv({ memberId: 'm-smokey', email: 'smokey@example.com', phone: '0414 555 151', licenceExpiry: '2027-12-01' }),
    priv({ memberId: 'm-jet', email: 'jet@example.com', phone: '0425 555 262', licenceExpiry: '2029-03-17' }),
    priv({ memberId: 'm-crank', email: 'crank@example.com', phone: '0436 555 373', licenceExpiry: '2027-06-09', firstAidExpiry: '2026-11-20' }),
    priv({ memberId: 'm-ace', email: 'ace@example.com', phone: '0447 555 484', licenceExpiry: '2028-10-30' }),
    priv({ memberId: 'm-ratchet', email: 'ratchet@example.com', phone: '0458 555 595', licenceExpiry: '2027-04-12' }),
    priv({ memberId: 'm-lefty', email: 'lefty@example.com', phone: '0469 555 606', licenceClass: 'probationary_open', licenceExpiry: '2027-07-25' }),
    priv({ memberId: 'm-ben', email: 'ben@example.com', phone: '0470 555 717', licenceExpiry: '2028-01-04' }),
    priv({ memberId: 'm-dylan', email: 'dylan@example.com', phone: '0481 555 828', licenceExpiry: '2029-02-19', introducedBy: 'Spanner', applicationNote: 'Been riding with the West crew since August. Ride a 2019 Street Bob.' }),
    priv({ memberId: 'm-josh', email: 'josh@example.com', phone: '0492 555 939', licenceClass: null, introducedBy: 'Jet', applicationNote: "Jet's partner. Keen to see ride days and come along to the family BBQs." }),
  ],

  bikes: [
    { id: 'b-1', memberId: 'm-rusty', make: 'Harley-Davidson', model: 'Road King', year: 2014, nickname: 'The Barge', isProject: false },
    { id: 'b-2', memberId: 'm-torque', make: 'Triumph', model: 'Bonneville T120', year: 2019, nickname: 'Bonnie', isProject: false },
    { id: 'b-3', memberId: 'm-diesel', make: 'Harley-Davidson', model: 'Street Glide', year: 2017, nickname: 'Midnight', isProject: false },
    { id: 'b-4', memberId: 'm-sparks', make: 'Indian', model: 'Scout Bobber', year: 2021, nickname: null, isProject: false },
    { id: 'b-5', memberId: 'm-gravel', make: 'Harley-Davidson', model: 'Fat Boy', year: 2012, nickname: 'Tank', isProject: false },
    { id: 'b-6', memberId: 'm-spanner', make: 'Harley-Davidson', model: 'Softail Slim', year: 2016, nickname: 'Old Faithful', isProject: false },
    { id: 'b-7', memberId: 'm-spanner', make: 'Honda', model: 'CB750', year: 1978, nickname: 'The Resurrection', isProject: true },
    { id: 'b-8', memberId: 'm-chook', make: 'Yamaha', model: 'XVS1300', year: 2010, nickname: null, isProject: false },
    { id: 'b-9', memberId: 'm-throttle', make: 'Kawasaki', model: 'Vulcan S', year: 2020, nickname: 'Little Red', isProject: false },
    { id: 'b-10', memberId: 'm-patches', make: 'BMW', model: 'R1200GS', year: 2015, nickname: null, isProject: false },
    { id: 'b-11', memberId: 'm-smokey', make: 'Harley-Davidson', model: 'Heritage Classic', year: 2018, nickname: 'Smoke Signal', isProject: false },
    { id: 'b-12', memberId: 'm-jet', make: 'Harley-Davidson', model: 'Sport Glide', year: 2022, nickname: null, isProject: false },
    { id: 'b-13', memberId: 'm-crank', make: 'Victory', model: 'Cross Country', year: 2013, nickname: 'Big Vic', isProject: false },
    { id: 'b-14', memberId: 'm-ace', make: 'Triumph', model: 'Speed Triple', year: 2019, nickname: null, isProject: false },
    { id: 'b-15', memberId: 'm-ratchet', make: 'Harley-Davidson', model: 'Electra Glide', year: 2011, nickname: 'The Lounge', isProject: false },
    { id: 'b-16', memberId: 'm-lefty', make: 'Royal Enfield', model: 'Interceptor 650', year: 2023, nickname: null, isProject: false },
    { id: 'b-17', memberId: 'm-ben', make: 'Honda', model: 'Rebel 1100', year: 2022, nickname: null, isProject: false },
    { id: 'b-18', memberId: 'm-dylan', make: 'Harley-Davidson', model: 'Street Bob', year: 2019, nickname: null, isProject: false },
  ],

  registrations: [
    { bikeId: 'b-1', rego: '1RN 7GK', regoExpiry: '2027-03-02' },
    { bikeId: 'b-2', rego: '2TW 4BN', regoExpiry: '2027-01-14' },
    { bikeId: 'b-3', rego: '9DM 3MN', regoExpiry: '2026-11-19' },
    { bikeId: 'b-4', rego: '4LR 8SB', regoExpiry: '2027-05-20' },
    { bikeId: 'b-5', rego: '6BH 1FT', regoExpiry: '2026-10-12' },
    { bikeId: 'b-6', rego: '3MD 5SS', regoExpiry: '2026-11-08' },
    { bikeId: 'b-8', rego: '7SF 2XV', regoExpiry: '2027-04-02' },
    { bikeId: 'b-9', rego: '5NB 6VS', regoExpiry: '2027-02-27' },
    { bikeId: 'b-10', rego: '8PN 9GS', regoExpiry: '2027-08-15' },
    { bikeId: 'b-11', rego: '1SB 4HC', regoExpiry: '2027-06-03' },
    { bikeId: 'b-12', rego: '2JH 7SG', regoExpiry: '2027-03-29' },
    { bikeId: 'b-13', rego: '3CM 1VX', regoExpiry: '2026-12-18' },
    { bikeId: 'b-14', rego: '4AD 8ST', regoExpiry: '2027-09-10' },
    { bikeId: 'b-15', rego: '772 RAY', regoExpiry: '2027-02-05' },
    { bikeId: 'b-16', rego: '6LC 2IE', regoExpiry: '2027-07-25' },
    { bikeId: 'b-17', rego: '7BW 3HR', regoExpiry: '2027-09-26' },
    { bikeId: 'b-18', rego: '8DP 4SB', regoExpiry: '2027-05-01' },
  ],

  emergencyContacts: [
    { id: 'e-1', memberId: 'm-rusty', name: 'Debbie Kowalski', relationship: 'Wife', phone: '0412 555 101' },
    { id: 'e-2', memberId: 'm-torque', name: 'Mark Walsh', relationship: 'Husband', phone: '0423 555 215' },
    { id: 'e-3', memberId: 'm-diesel', name: 'Kerry Mercer', relationship: 'Partner', phone: '0402 555 048' },
    { id: 'e-4', memberId: 'm-sparks', name: 'Anthony Romano', relationship: 'Brother', phone: '0401 555 469' },
    { id: 'e-5', memberId: 'm-gravel', name: 'Sue Hughes', relationship: 'Mum', phone: '0415 555 593' },
    { id: 'e-6', memberId: 'm-spanner', name: 'Jen Doherty', relationship: 'Wife', phone: '0427 555 604' },
    { id: 'e-7', memberId: 'm-throttle', name: 'Carol Barnes', relationship: 'Mum', phone: '0409 555 827' },
    { id: 'e-8', memberId: 'm-smokey', name: 'Michelle Brennan', relationship: 'Wife', phone: '0414 555 152' },
    { id: 'e-9', memberId: 'm-jet', name: 'Josh Tran', relationship: 'Partner', phone: '0492 555 939' },
    { id: 'e-10', memberId: 'm-crank', name: 'Helen Morrison', relationship: 'Wife', phone: '0436 555 374' },
    { id: 'e-11', memberId: 'm-ace', name: 'Rob Delaney', relationship: 'Dad', phone: '0447 555 485' },
    { id: 'e-12', memberId: 'm-ratchet', name: 'Donna Simmons', relationship: 'Wife', phone: '0458 555 596' },
    { id: 'e-13', memberId: 'm-lefty', name: 'Amy Carter', relationship: 'Sister', phone: '0469 555 607' },
  ],

  positions: [
    { id: 'p-1', memberId: 'm-rusty', chapterId: 'ch-west', role: 'president', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-2', memberId: 'm-rusty', chapterId: null, role: 'nec_chair', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-3', memberId: 'm-torque', chapterId: 'ch-west', role: 'secretary', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-4', memberId: 'm-diesel', chapterId: 'ch-west', role: 'road_captain', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-5', memberId: 'm-sparks', chapterId: 'ch-west', role: 'treasurer', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-6', memberId: 'm-gravel', chapterId: 'ch-west', role: 'sergeant_at_arms', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-7', memberId: 'm-spanner', chapterId: 'ch-west', role: 'tail_gunner', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-8', memberId: 'm-chook', chapterId: 'ch-west', role: 'officer', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-9', memberId: 'm-smokey', chapterId: 'ch-north', role: 'president', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-10', memberId: 'm-jet', chapterId: 'ch-north', role: 'vice_president', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-11', memberId: 'm-crank', chapterId: 'ch-north', role: 'road_captain', startedOn: '2025-08-16', endedOn: null },
    { id: 'p-12', memberId: 'm-ace', chapterId: 'ch-north', role: 'officer', startedOn: '2025-08-16', endedOn: null },
  ],
  // Made-up rides, spread over the website's five colours. Times are Melbourne local, as instants.
  rides: [
    { id: 'r-1', title: 'West breakfast run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: '2026-11-08T01:00:00.000Z', allDay: false,
      location: 'Caltex Laverton North', notes: 'KSU 8:30. Breakfast at Daylesford, home by lunch.', category: 'west', cancelledAt: null },
    // About a week out (9 am Melbourne in summer time, 8 am in winter), so it always needs crew soon.
    { id: 'r-2', title: 'North coffee and curves', startsAt: daysFromNow(6, '22:00:00.000Z'), endsAt: daysFromNow(7, '03:00:00.000Z'), allDay: false,
      location: 'Kilmore Bakery', notes: 'Up through Pyalong and back via Lancefield.', category: 'north', cancelledAt: null },
    { id: 'r-3', title: 'Toy Run (Non-Nuts)', startsAt: '2026-11-28T23:00:00.000Z', endsAt: null, allDay: false,
      location: 'Werribee Racecourse', notes: 'Another club’s charity run. Bring a wrapped toy.', category: 'non_nuts', cancelledAt: null },
    { id: 'r-4', title: 'Rustnuts Christmas ride', startsAt: '2026-12-05T23:00:00.000Z', endsAt: '2026-12-06T06:00:00.000Z', allDay: false,
      location: 'Clubhouse, Williams Landing', notes: 'Both chapters. Lunch and the Kris Kringle after.', category: 'club', cancelledAt: null },
    { id: 'r-5', title: 'West twisties', startsAt: '2026-12-12T22:00:00.000Z', endsAt: null, allDay: false,
      location: 'Bacchus Marsh McDonald’s', notes: null, category: 'west', cancelledAt: '2026-12-01T00:00:00.000Z' },
    { id: 'r-6', title: 'Ride for Kids (supported)', startsAt: '2027-01-16T23:00:00.000Z', endsAt: null, allDay: false,
      location: 'Geelong Waterfront', notes: 'Supporting a mate’s club. Rusty Bus on recovery.', category: 'supported', cancelledAt: null },
    { id: 'r-7', title: 'Big 4: Phillip Island weekend', startsAt: '2027-01-29T13:00:00.000Z', endsAt: '2027-01-31T13:00:00.000Z', allDay: true,
      location: 'Phillip Island', notes: 'Two nights. Book your own room.', category: 'club', cancelledAt: null },
    { id: 'r-8', title: 'North night ride', startsAt: '2027-02-13T08:00:00.000Z', endsAt: null, allDay: false,
      location: 'Wallan servo', notes: null, category: 'north', cancelledAt: null },
  ],
  rsvps: [
    { rideId: 'r-1', memberId: 'm-rusty', answer: 'going', updatedAt: '2026-10-20T08:00:00.000Z' },
    { rideId: 'r-1', memberId: 'm-spanner', answer: 'going', updatedAt: '2026-10-20T09:00:00.000Z' },
    { rideId: 'r-1', memberId: 'm-gravel', answer: 'maybe', updatedAt: '2026-10-21T09:00:00.000Z' },
    { rideId: 'r-1', memberId: 'm-throttle', answer: 'going', updatedAt: '2026-10-21T10:00:00.000Z' },
    { rideId: 'r-1', memberId: 'm-diesel', answer: 'going', updatedAt: '2026-10-21T11:00:00.000Z' },
    { rideId: 'r-1', memberId: 'm-chook', answer: 'going', updatedAt: '2026-10-21T12:00:00.000Z' },
    { rideId: 'r-2', memberId: 'm-crank', answer: 'going', updatedAt: '2026-10-22T09:00:00.000Z' },
    { rideId: 'r-2', memberId: 'm-smokey', answer: 'going', updatedAt: '2026-10-22T10:00:00.000Z' },
    { rideId: 'r-2', memberId: 'm-jet', answer: 'going', updatedAt: '2026-10-22T11:00:00.000Z' },
    { rideId: 'r-4', memberId: 'm-rusty', answer: 'going', updatedAt: '2026-10-22T12:00:00.000Z' },
    { rideId: 'r-4', memberId: 'm-crank', answer: 'going', updatedAt: '2026-10-22T12:30:00.000Z' },
    { rideId: 'r-4', memberId: 'm-chook', answer: 'no', updatedAt: '2026-10-23T08:00:00.000Z' },
  ],
  // The West breakfast run is fully crewed; North coffee and curves (always about a week out) still needs a Tail Gunner.
  // Tail Gunners here have first aid dates that pass.
  crew: [
    { rideId: 'r-1', memberId: 'm-diesel', role: 'road_captain', assignedBy: 'm-torque', assignedAt: '2026-10-21T11:30:00.000Z' },
    { rideId: 'r-1', memberId: 'm-spanner', role: 'tail_gunner', assignedBy: 'm-spanner', assignedAt: '2026-10-20T09:30:00.000Z' },
    { rideId: 'r-1', memberId: 'm-chook', role: 'officer', assignedBy: 'm-torque', assignedAt: '2026-10-21T12:30:00.000Z' },
    { rideId: 'r-2', memberId: 'm-crank', role: 'road_captain', assignedBy: 'm-smokey', assignedAt: '2026-10-22T09:30:00.000Z' },
  ],
  // The library, and the West breakfast run uses the West loop. North coffee and curves has no route yet.
  routes: demoRoutes,
  rideRoutes: [{ rideId: 'r-1', routeId: 'rt-west-loop' }],
  // The West breakfast run's briefing. Diesel (its Road Captain) read an earlier version, then
  // Torque added the roadworks on the evening of 23 Oct; Spanner read it at 7:42 am the next
  // morning. Fixed instants, well before the ride's fixed start. North coffee and curves has none.
  briefings: [
    {
      rideId: 'r-1',
      hazards: [
        'Fresh gravel on the Ballan–Daylesford Rd after Korweinguboora',
        'Kangaroos at dusk on the way home',
        'Roadworks at Bacchus Marsh: 40 km/h',
      ],
      changes: 'Single file through Myrniong, no staggered formation',
      notes: 'Breakfast at the Daylesford bakery, cash only.',
      updatedAt: '2026-10-23T09:15:00.000Z',
      updatedBy: 'm-torque',
    },
  ],
  briefingReads: [
    { rideId: 'r-1', memberId: 'm-diesel', readAt: '2026-10-22T10:05:00.000Z' },
    { rideId: 'r-1', memberId: 'm-spanner', readAt: '2026-10-23T20:42:00.000Z' },
  ],
};

/** The people you can "view as" in the demo, one per access level. */
export const DEMO_PERSONAS = [
  { level: 'public', memberId: null, label: 'Public', blurb: 'Not signed in' },
  { level: 'pending', memberId: 'm-dylan', label: 'Applicant', blurb: 'Dylan, waiting on approval' },
  { level: 'member', memberId: 'm-spanner', label: 'Member', blurb: 'Spanner, West Tail Gunner' },
  { level: 'board', memberId: 'm-torque', label: 'Board', blurb: 'Torque, West Secretary' },
  { level: 'national', memberId: 'm-rusty', label: 'National', blurb: 'Rusty, West President and NEC Chair' },
] as const;

// Lane E: live ride
/** A made-up ride that's always on now (started an hour ago, ends in three), so live mode can be shown. */
export function demoTodayRide(now: Date = new Date()): Ride {
  const hour = 3600_000;
  return {
    id: 'r-today',
    title: 'Today’s coffee run (demo)',
    startsAt: new Date(now.getTime() - hour).toISOString(),
    endsAt: new Date(now.getTime() + 3 * hour).toISOString(),
    allDay: false,
    location: 'BP Ravenhall',
    notes: 'A made-up ride for trying out live ride mode.',
    category: 'west',
    cancelledAt: null,
  };
}
