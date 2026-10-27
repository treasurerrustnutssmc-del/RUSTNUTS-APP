// Made-up example members for the demo build. Nobody here is a real person.
// Replaced by the live database once Supabase is connected.

// Stage 4
import { addDays } from '../domain/dates';
import { melbourneDate } from '../domain/rides';
import { clubYearOf } from '../domain/clubYear';
import { fyOf, receiptNo } from '../domain/fees';
import { readGpx } from '../domain/gpx';
import { addMonths } from '../domain/profile';
import type { ClubData, LedgerCode, LedgerEntry, Member, MemberPrivate, MemberStatus, Ride, Route } from '../domain/types';
import { isCredit } from '../domain/ledger';

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
    member({ id: 'm-throttle', chapterId: 'ch-west', fullName: 'Nikki Barnes', roadName: 'Throttle', status: 'fng', joinedOn: '2025-12-13', fngStartedOn: '2026-01-17', sharePhone: true }),
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

  // Stage 5: made-up meetings, action items and votes. Times are Melbourne local, as instants.
  meetings: [
    { id: 'mt-1', chapterId: 'ch-west', kind: 'board', title: 'November board meeting', startsAt: '2026-11-04T08:30:00.000Z',
      location: 'Clubhouse, Williams Landing', minutes: null, minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null,
      createdBy: 'm-torque', agenda: [
        { title: 'Treasurer’s report', notes: 'Sparks to table the October figures.' },
        { title: 'Gazebo for charity rides', notes: null },
        { title: 'Throttle’s patch vote', notes: 'Result due by the 4th.' },
      ] },
    { id: 'mt-2', chapterId: 'ch-west', kind: 'general', title: 'October general meeting', startsAt: '2026-10-14T08:30:00.000Z',
      location: 'Clubhouse, Williams Landing', agenda: [{ title: 'Christmas ride', notes: null }, { title: 'Toy Run', notes: null }],
      minutes: 'Present: 14 members.\n\nChristmas ride: lunch at the clubhouse, Kris Kringle $30.\nToy Run: West rides together, KSU 9:00 from Laverton.',
      minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null, createdBy: 'm-torque' },
    { id: 'mt-3', chapterId: 'ch-north', kind: 'general', title: 'September general meeting', startsAt: '2026-09-16T09:30:00.000Z',
      location: 'Kilmore Bakery', agenda: [{ title: 'Night ride route', notes: null }],
      minutes: 'Night ride route agreed: Wallan, Whittlesea, home by 11.', minutesApprovedAt: '2026-09-20T00:00:00.000Z',
      minutesApprovedBy: 'm-jet', cancelledAt: null, createdBy: 'm-jet' },
    { id: 'mt-4', chapterId: null, kind: 'nec', title: 'NEC meeting', startsAt: '2026-11-11T08:00:00.000Z', location: 'Video call',
      agenda: [{ title: 'Chapter contributions', notes: null }], minutes: null, minutesApprovedAt: null, minutesApprovedBy: null,
      cancelledAt: null, createdBy: 'm-rusty' },
  ],
  actionItems: [
    { id: 'ai-1', meetingId: 'mt-2', chapterId: 'ch-west', title: 'Restock the first aid kit', ownerId: 'm-spanner', dueOn: '2026-11-01', doneOn: null },
    { id: 'ai-2', meetingId: 'mt-2', chapterId: 'ch-west', title: 'Get three quotes for a gazebo', ownerId: 'm-sparks', dueOn: '2026-10-20', doneOn: null },
    { id: 'ai-3', meetingId: 'mt-2', chapterId: 'ch-west', title: 'Book the clubhouse for Christmas', ownerId: 'm-torque', dueOn: '2026-10-21', doneOn: '2026-10-19' },
    { id: 'ai-4', meetingId: 'mt-3', chapterId: 'ch-north', title: 'Scout the night ride fuel stop', ownerId: 'm-crank', dueOn: '2026-11-08', doneOn: null },
  ],
  votes: [
    { id: 'v-1', chapterId: 'ch-west', meetingId: null, subjectMemberId: 'm-throttle', question: 'Patch Throttle as a Full member?',
      details: 'Nine months as an FNG, every ride since January.',
      electorate: 'chapter_patched', threshold: 'unanimous', secret: true, quorum: 3, openedAt: '2026-10-21T08:00:00.000Z',
      closesAt: '2026-11-04T08:00:00.000Z', closedAt: null, result: null, castingVote: null, tally: null,
      electorIds: ['m-chook', 'm-diesel', 'm-gravel', 'm-rusty', 'm-spanner', 'm-sparks', 'm-torque'],
      votedIds: ['m-diesel', 'm-rusty', 'm-torque'],
      ballots: [{ memberId: null, choice: 'yes' }, { memberId: null, choice: 'yes' }, { memberId: null, choice: 'yes' }],
      createdBy: 'm-torque' },
    { id: 'v-2', chapterId: 'ch-west', meetingId: 'mt-1', subjectMemberId: null, question: 'Spend up to $600 on a club gazebo?',
      details: 'For charity rides and the Toy Run stall.', electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3,
      openedAt: '2026-10-22T08:00:00.000Z', closesAt: '2026-10-30T08:00:00.000Z', closedAt: null, result: null, castingVote: null,
      tally: null, electorIds: ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque'], votedIds: ['m-sparks'],
      ballots: [{ memberId: 'm-sparks', choice: 'yes' }], createdBy: 'm-torque' },
    { id: 'v-3', chapterId: null, meetingId: null, subjectMemberId: null, question: 'Move the Christmas ride to the first Sunday of December?',
      details: null, electorate: 'club_patched', threshold: 'majority', secret: true, quorum: 7, openedAt: '2026-10-01T08:00:00.000Z',
      closesAt: '2026-10-15T08:00:00.000Z', closedAt: '2026-10-15T09:00:00.000Z', result: 'carried', castingVote: null,
      tally: { yes: 8, no: 2, abstain: 1 },
      electorIds: ['m-ace', 'm-chook', 'm-crank', 'm-diesel', 'm-gravel', 'm-jet', 'm-ratchet', 'm-rusty', 'm-smokey', 'm-spanner', 'm-sparks', 'm-torque'],
      votedIds: ['m-ace', 'm-chook', 'm-crank', 'm-diesel', 'm-gravel', 'm-jet', 'm-rusty', 'm-smokey', 'm-spanner', 'm-sparks', 'm-torque'],
      ballots: [], createdBy: 'm-rusty' },
    // Everyone's voted and it's tied, so it waits on the chair (9.10).
    { id: 'v-4', chapterId: 'ch-west', meetingId: null, subjectMemberId: null, question: 'Move board meetings to Tuesdays?',
      details: null, electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3,
      openedAt: '2026-10-20T08:00:00.000Z', closesAt: '2026-11-03T08:00:00.000Z', closedAt: null, result: null, castingVote: null,
      tally: null, electorIds: ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque'],
      votedIds: ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque'],
      ballots: [
        { memberId: 'm-diesel', choice: 'yes' }, { memberId: 'm-gravel', choice: 'no' }, { memberId: 'm-rusty', choice: 'abstain' },
        { memberId: 'm-sparks', choice: 'yes' }, { memberId: 'm-torque', choice: 'no' },
      ], createdBy: 'm-torque' },
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
// ---------------------------------------------------------------------------
// Stage 4: check-ins, decisions and fees, dated from today so the demo always has a meeting on.
// ---------------------------------------------------------------------------

const s4Today = melbourneDate(new Date().toISOString()); // the same "today" as the app
const s4Fy = fyOf(s4Today); // the treasurer's books
const s4Year = clubYearOf(s4Today, []); // fees run AGM to AGM; no AGM recorded in the demo, so 1 August
const s4Due = `${s4Year}-12-31`;
const ago = (days: number) => addDays(s4Today, -days);
const paid = (monthDay: string) => (`${s4Year}-${monthDay}` > s4Today ? s4Today : `${s4Year}-${monthDay}`); // early in the year, never ahead of today
const at = (date: string, time = '09:30:00') => `${date}T${time}.000Z`;
const went = (sessionId: string, memberIds: string[], date: string) =>
  memberIds.map((memberId) => ({ sessionId, memberId, checkedInAt: at(date), markedBy: null }));
const annual = (id: string, memberId: string, chapterId: string, amountCents: number) => ({
  id, memberId, chapterId, fy: s4Year, kind: 'annual' as const, description: null, amountCents, dueOn: s4Due,
  createdAt: at(`${s4Year}-08-01`), waivedAt: null,
});
const rate = (chapterId: string, status: MemberStatus, amountCents: number) => ({ chapterId, fy: s4Year, status, amountCents, dueOn: s4Due });

Object.assign(DEMO_DATA, {
  checkinSessions: [
    { id: 'cs-today', kind: 'meeting', chapterId: 'ch-west', rideId: null, title: 'West monthly meeting', heldOn: s4Today,
      openedBy: 'm-torque', closedAt: null, code: 'RN2026' },
    { id: 'cs-week', kind: 'meeting', chapterId: 'ch-west', rideId: null, title: 'West committee catch-up', heldOn: ago(2),
      openedBy: 'm-torque', closedAt: at(ago(2), '11:00:00'), code: 'WK8M4Q' },
    { id: 'cs-month', kind: 'meeting', chapterId: 'ch-west', rideId: null, title: 'West monthly meeting', heldOn: ago(28),
      openedBy: 'm-torque', closedAt: at(ago(28), '11:00:00'), code: 'MN3X7P' },
    { id: 'cs-north', kind: 'meeting', chapterId: 'ch-north', rideId: null, title: 'North monthly meeting', heldOn: ago(21),
      openedBy: 'm-smokey', closedAt: at(ago(21), '11:00:00'), code: 'NT5R2K' },
  ],
  attendance: [
    ...went('cs-today', ['m-torque', 'm-rusty'], s4Today),
    ...went('cs-week', ['m-torque', 'm-rusty', 'm-dylan', 'm-sparks'], ago(2)),
    ...went('cs-month', ['m-rusty', 'm-torque', 'm-diesel', 'm-sparks', 'm-gravel', 'm-spanner', 'm-chook', 'm-throttle'], ago(28)),
    ...went('cs-north', ['m-smokey', 'm-jet', 'm-crank', 'm-ace', 'm-lefty', 'm-ben'], ago(21)),
  ],
  decisions: [],
  feeRates: ['ch-west', 'ch-north'].flatMap((c) => [
    rate(c, 'full', 25000), rate(c, 'nomad', 25000), rate(c, 'fng', 15000), rate(c, 'supporter', 5000), rate(c, 'family', 5000),
  ]),
  agms: [],
  continuationFees: [{ chapterId: 'ch-west', fy: s4Year, amountCents: 5000 }],
  charges: [
    annual('ch-1', 'm-rusty', 'ch-west', 25000),
    annual('ch-2', 'm-torque', 'ch-west', 25000),
    annual('ch-3', 'm-spanner', 'ch-west', 25000),
    annual('ch-4', 'm-gravel', 'ch-west', 25000),
    annual('ch-5', 'm-throttle', 'ch-west', 15000),
    { ...annual('ch-6', 'm-patches', 'ch-west', 5000), waivedAt: at(`${s4Year}-08-02`) },
    annual('ch-7', 'm-jet', 'ch-north', 25000),
    annual('ch-8', 'm-crank', 'ch-north', 25000),
  ],
  payments: [
    { id: 'pay-1', chargeId: 'ch-1', amountCents: 25000, paidOn: paid('08-02'), method: 'payid', reference: 'RUSTY FEES',
      state: 'confirmed', claimedBy: 'm-rusty', receiptNo: receiptNo('west', s4Year, 1), decidedAt: at(paid('08-03')) },
    { id: 'pay-2', chargeId: 'ch-3', amountCents: 12500, paidOn: paid('08-10'), method: 'cash', reference: null,
      state: 'confirmed', claimedBy: null, receiptNo: receiptNo('west', s4Year, 2), decidedAt: at(paid('08-10')) },
    { id: 'pay-3', chargeId: 'ch-4', amountCents: 10000, paidOn: paid('09-01'), method: 'payid', reference: 'GRAVEL FEES',
      state: 'confirmed', claimedBy: 'm-gravel', receiptNo: receiptNo('west', s4Year, 3), decidedAt: at(paid('09-02')) },
    { id: 'pay-4', chargeId: 'ch-4', amountCents: 15000, paidOn: ago(1), method: 'payid', reference: 'GRAVEL FEES',
      state: 'claimed', claimedBy: 'm-gravel', receiptNo: null, decidedAt: null },
    { id: 'pay-5', chargeId: 'ch-7', amountCents: 25000, paidOn: paid('08-15'), method: 'payid', reference: 'JET FEES',
      state: 'confirmed', claimedBy: 'm-jet', receiptNo: receiptNo('north', s4Year, 1), decidedAt: at(paid('08-16')) },
  ],
  paymentDetails: [
    { chapterId: 'ch-west', payid: 'west@rustnuts.example', payidName: 'Rustnuts SMC West', bsb: null, accountNo: null },
  ],
} satisfies Partial<ClubData>);

// ---------------------------------------------------------------------------
// The Road Rules: a made-up sample text, dated from today so the sign-off states always hold.
// Torque is signed, Spanner is due soon, Rusty's sign-off has run out and Diesel never signed.
// ---------------------------------------------------------------------------

const RULES_SAMPLE = `# Sample Road Rules (demo only)

A made-up sample to show how the Road Rules look in the app. It is not the club’s text: the NEC publishes the real Road Rules.

# Who’s in charge on the road
The Road Captain (RC) leads the ride and makes the safety calls. When the RC can’t, the call passes in this order: Road Captain, Sergeant-at-Arms, Vice President, President, then the NEC (constitution 7.6).
- Follow a safety direction straight away. Talk it over at the next stop, not on the road.
- The RC may vary a procedure for one ride because of safety, traffic, weather, road conditions or operational need (7.10). They say so at the briefing.

# Before the ride
- Be at the meeting point fuelled up, with time to spare before KSU (kickstands up).
- Come to the briefing. Know the route, the stops and who the Tail Gunner is.

# On the road
- The RC leads. Nobody passes the RC.
- On open roads, ride in a staggered formation: two seconds behind the rider directly ahead of you, one second behind the rider beside you.
- Go to single file through towns, on bends, at roadworks and whenever the RC signals it.
- No overtaking within the group. Keep your place unless the RC moves you.
- The Tail Gunner (TG) rides at the back and stays there. If you stop, the TG stops with you.
- Ride your own ride. If the pace is too quick, drop back and tell the TG at the next stop.

Safety first, then the ride, then the coffee.`;

// Dated from the same today as Stage 4 (s4Today), at the same time of day (at(): 09:30 UTC, the
// evening of that date in Melbourne).
Object.assign(DEMO_DATA, {
  roadRules: [
    {
      number: 1,
      body: RULES_SAMPLE,
      changes: '',
      fresh: true,
      publishedAt: at(addMonths(s4Today, -16)),
      publishedBy: 'm-rusty',
    },
    {
      number: 2,
      body: RULES_SAMPLE.replace('Nobody passes the RC.', 'Nobody overtakes the RC.'),
      changes: 'A wording fix: “Nobody passes the RC” now reads “Nobody overtakes the RC”. Your sign-off carries over.',
      fresh: false,
      publishedAt: at(addDays(s4Today, -24)),
      publishedBy: 'm-rusty',
    },
  ],
  roadRulesSignoffs: [
    { memberId: 'm-torque', version: 2, signedAt: at(addDays(s4Today, -5)) },
    { memberId: 'm-spanner', version: 1, signedAt: at(addDays(addMonths(s4Today, -11), -20)) },
    { memberId: 'm-rusty', version: 1, signedAt: at(addMonths(s4Today, -13)) },
    // Everyone else who's asked has signed, so the crew picker has people to pick. Diesel (never)
    // and Rusty (ran out) are left to show the Going gate's prompt.
    ...(
      [
        ['m-sparks', 2, -3], ['m-gravel', 2, -10], ['m-chook', 2, -18], ['m-throttle', 1, -150],
        ['m-patches', 1, -200], ['m-kerry', 1, -200], ['m-smokey', 2, -7], ['m-jet', 2, -12],
        ['m-crank', 1, -90], ['m-ace', 1, -240], ['m-ratchet', 1, -60], ['m-lefty', 1, -80], ['m-ben', 2, -20],
      ] as const
    ).map(([memberId, version, days]) => ({ memberId, version, signedAt: at(addDays(s4Today, days)) })),
  ],
} satisfies Partial<ClubData>);

// ---------------------------------------------------------------------------
// The Rusty Bus: Booked for Ride for Kids on its own date, out today on a recovery that Diesel is
// driving, a Waiting request of Spanner's that clashes with the charity booking, and a no to
// Spanner from last week. Dated from the same today as Stage 4 (s4Today), with at()'s times in UTC.
// From the day before Ride for Kids, the charity booking moves to a month from today with no ride
// (the spec's fallback), so the demo always has a booking and a clashing request still to come,
// and neither ever shares a day with today's recovery (two Booked bookings never share a day).
// Also: a request of Spanner's from a fortnight ago that nobody answered, and a Booked charity ride
// whose ride the website moved half an hour (the sync cancels the old ride and adds a new one), so
// the booking hangs off a cancelled ride and the new ride shows "Rusty Bus booked those days".
// ---------------------------------------------------------------------------

const rideForKids = DEMO_DATA.rides.find((r) => r.id === 'r-6')!;
const kidsDayAhead = melbourneDate(rideForKids.startsAt) > addDays(s4Today, 1);
const charityDay = kidsDayAhead ? melbourneDate(rideForKids.startsAt) : addDays(s4Today, 30);
/** Today's recovery was booked earlier today: three hours ago, or just now in Melbourne's first hours. */
const recoveryBookedAt = (() => {
  const now = Date.now();
  const stamps = [3 * 3600_000, 60_000, 0].map((ms) => new Date(now - ms).toISOString());
  return stamps.find((t) => melbourneDate(t) === s4Today) ?? stamps[stamps.length - 1];
})();
const noBusDecision = { decidedBy: null, decidedAt: null, declineReason: '', cancelledBy: null, cancelledAt: null };
// The moved ride's day: past the fortnight (so it never shows Crew needed), clear of the charity
// booking and Spanner's request around it.
const movedDay = [16, 19].map((n) => addDays(s4Today, n)).find((d) => d < addDays(charityDay, -1) || d > charityDay)!;
const pinkRibbon = {
  title: 'West Pink Ribbon ride', endsAt: null, allDay: false, location: 'Caltex Laverton North',
  notes: 'Raising money for breast cancer research. Wear something pink.', category: 'west' as const,
};
DEMO_DATA.rides.push(
  // 22:30 and 23:00 UTC the day before: 9:30 and 10 am Melbourne in summer time, 8:30 and 9 in winter.
  { id: 'r-9', ...pinkRibbon, startsAt: at(addDays(movedDay, -1), '22:30:00'), cancelledAt: at(ago(2), '03:00:00') },
  { id: 'r-10', ...pinkRibbon, startsAt: at(addDays(movedDay, -1), '23:00:00'), cancelledAt: null },
);

Object.assign(DEMO_DATA, {
  busBookings: [
    {
      // Booked by the West Secretary, a bus manager, so it was Booked straight away.
      id: 'bus-1', firstDay: charityDay, lastDay: charityDay, purpose: 'charity_ride', rideId: kidsDayAhead ? 'r-6' : null,
      driverId: 'm-gravel',
      notes: `Support vehicle for ${kidsDayAhead ? 'Ride for Kids' : 'the charity ride'}: water, spares, and room in the back for a bike that gives up.`,
      status: 'approved', bookedBy: 'm-torque', bookedAt: at(ago(20), '08:00:00'),
      decidedBy: 'm-torque', decidedAt: at(ago(20), '08:00:00'), declineReason: '', cancelledBy: null, cancelledAt: null,
    },
    {
      // A recovery for today, so it was Booked straight away.
      id: 'bus-2', firstDay: s4Today, lastDay: s4Today, purpose: 'recovery', rideId: null, driverId: 'm-diesel',
      notes: 'Chook’s bike died near Bacchus Marsh on the way home last night. Bringing it back to the clubhouse.',
      status: 'approved', bookedBy: 'm-chook', bookedAt: recoveryBookedAt,
      decidedBy: 'm-chook', decidedAt: recoveryBookedAt, declineReason: '', cancelledBy: null, cancelledAt: null,
    },
    {
      id: 'bus-3', firstDay: addDays(charityDay, -1), lastDay: charityDay, purpose: 'club_event', rideId: null, driverId: 'm-spanner',
      notes: 'West family day at the clubhouse: the marquee, the barbecue and the eskies.',
      status: 'requested', bookedBy: 'm-spanner', bookedAt: at(ago(3)), ...noBusDecision,
    },
    {
      id: 'bus-4', firstDay: ago(6), lastDay: ago(5), purpose: 'other', rideId: null, driverId: 'm-spanner',
      notes: 'Moving house: a couch, a fridge and the CB750 project.',
      status: 'declined', bookedBy: 'm-spanner', bookedAt: at(ago(10)),
      decidedBy: 'm-rusty', decidedAt: at(ago(8)),
      declineReason: 'The bus is for club runs and recoveries, not moving house. Sorry, mate.',
      cancelledBy: null, cancelledAt: null,
    },
    {
      // Booked straight away by Torque for the Pink Ribbon ride, before the website moved it.
      id: 'bus-5', firstDay: movedDay, lastDay: movedDay, purpose: 'charity_ride', rideId: 'r-9', driverId: 'm-sparks',
      notes: 'Support vehicle for the Pink Ribbon ride: water, the first aid kit and a box of pink balloons.',
      status: 'approved', bookedBy: 'm-torque', bookedAt: at(ago(15), '07:00:00'),
      decidedBy: 'm-torque', decidedAt: at(ago(15), '07:00:00'), declineReason: '', cancelledBy: null, cancelledAt: null,
    },
    {
      // Asked for and never answered: its days went by a fortnight ago.
      id: 'bus-6', firstDay: ago(13), lastDay: ago(12), purpose: 'club_event', rideId: null, driverId: 'm-spanner',
      notes: 'The West stall at the Werribee swap meet: the gazebo and the merch tubs.',
      status: 'requested', bookedBy: 'm-spanner', bookedAt: at(ago(24)), ...noBusDecision,
    },
  ],
} satisfies Partial<ClubData>);

// ---------------------------------------------------------------------------
// Stage 5B: the treasurer's books. Openings on 1 July, a $400 float, a few months of entries dated
// back from today, a gazebo payment waiting on a second approval, last month presented to
// members, and West's budget still a draft. Fee payments pay-2, pay-3 and pay-5 aren't in yet.
// ---------------------------------------------------------------------------

const thisMonth = `${s4Today.slice(0, 7)}-01`;
const lastMonth = `${addDays(thisMonth, -1).slice(0, 7)}-01`;
const rustyPaid = paid('08-02'); // pay-1
const book = (id: string, chapterId: string | null, code: LedgerCode, description: string, amountCents: number, daysAgo: number,
  over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, chapterId, code, description, amountCents, receivedOn: isCredit(code) ? ago(daysAgo) : null, entryOn: ago(daysAgo),
  payeeMemberId: null, payeeName: null, paymentId: null, state: 'paid', recordedBy: 'm-sparks', recordedAt: at(ago(daysAgo)),
  updatedAt: at(ago(daysAgo)), voidReason: null, voidedBy: null, approvals: [], ...over,
});
const twoOk = (daysAgo: number) => [{ memberId: 'm-sparks', approvedAt: at(ago(daysAgo)) }, { memberId: 'm-torque', approvedAt: at(ago(daysAgo)) }];

Object.assign(DEMO_DATA, {
  fundOpenings: [
    { chapterId: null, fy: s4Fy, amountCents: 466031 },
    { chapterId: 'ch-west', fy: s4Fy, amountCents: 254000 },
    { chapterId: 'ch-north', fy: s4Fy, amountCents: 90000 },
  ],
  cashFloats: [{ fy: s4Fy, amountCents: 40000 }],
  ledger: [
    book('le-1', 'ch-west', 'CR-001', 'Member fees: Rusty', 25000, 70, { paymentId: 'pay-1', receivedOn: rustyPaid, entryOn: rustyPaid }),
    book('le-2', 'ch-north', 'CR-001', 'Member fees', 36000, 66),
    book('le-3', null, 'CR-005', 'Hoodie order', 82000, 60),
    book('le-4', null, 'DB-005', 'Hoodies from the printer', 61100, 58, { payeeName: 'Ink & Iron Printing', approvals: twoOk(59) }),
    book('le-5', null, 'DB-004', 'Account fee', 40, 54, { payeeName: 'Bank' }),
    book('le-6', 'ch-west', 'CR-006', 'Meeting sausage sizzle', 9500, 41, { receivedOn: ago(50) }), // banked late
    book('le-7', 'ch-west', 'DB-007', 'Clubhouse hire', 15000, 33, { payeeName: 'Laverton Community Hall', approvals: twoOk(34) }),
    book('le-8', null, 'DB-002', 'Ride for Kids donation', 50000, 26, { payeeName: 'Ride for Kids', approvals: twoOk(27) }),
    book('le-9', 'ch-west', 'DB-003', 'Cable ties, entered twice', 1200, 20, {
      state: 'void', voidReason: 'Entered twice', voidedBy: 'm-sparks', payeeMemberId: 'm-spanner', approvals: twoOk(21),
    }),
    book('le-10', 'ch-west', 'DB-006', 'Refund of a double payment', 12500, 9, {
      state: 'approved', entryOn: null, payeeMemberId: 'm-gravel', approvals: twoOk(8),
    }),
    book('le-11', 'ch-west', 'DB-001', 'Club gazebo', 59900, 2, {
      state: 'awaiting', entryOn: null, payeeName: 'Gazebo Warehouse', approvals: [{ memberId: 'm-sparks', approvedAt: at(ago(2)) }],
    }),
  ],
  budgets: [
    { chapterId: 'ch-west', fy: s4Fy, lines: { 'CR-001': 500000, 'CR-006': 30000, 'DB-001': 120000, 'DB-007': 60000, 'DB-002': 50000 },
      approvedVoteId: null, approvedAt: null, approvedBy: null, updatedAt: at(ago(60)) },
  ],
  treasurerReports: [{ month: lastMonth, presentedAt: at(thisMonth), presentedBy: 'm-sparks' }],
} satisfies Partial<ClubData>);

// ---------------------------------------------------------------------------
// Stage 5D: a vest direction on Chook with its review waiting for a hearing, a club tee on sale
// with orders at each step, a hoodie waiting for a second yes, an open national contribution,
// and a proposed Geelong chapter.
// ---------------------------------------------------------------------------

Object.assign(DEMO_DATA, {
  conduct: [
    {
      id: 'cr-1', memberId: 'm-chook', chapterId: 'ch-west', kind: 'vest',
      summary: 'Wore the vest into the pub after the Kinglake ride, against the SAA’s direction. Told to hand it to the SAA until the next meeting.',
      rule: '6.9 vest direction', decidedOn: ago(9), noticeOn: ago(8), suspendedUntil: null, recordedBy: 'm-gravel',
      recordedAt: at(ago(8)), holdUntil: null, holdReason: '',
      appeal: {
        lodgedOn: ago(5), lodgedBy: 'm-chook', grounds: 'I had the permission from Rusty that night. Happy to talk it through.',
        panelIds: [], hearingOn: null, outcome: null, outcomeNote: '', decidedOn: null, decidedBy: null, withdrawnOn: null,
      },
    },
    {
      id: 'cr-2', memberId: 'm-ace', chapterId: 'ch-north', kind: 'ride_safety', summary: 'Passed the Road Captain on the Black Spur.',
      rule: '7.9', decidedOn: ago(120), noticeOn: ago(120), suspendedUntil: null, recordedBy: 'm-smokey', recordedAt: at(ago(119)),
      holdUntil: null, holdReason: '', appeal: null,
    },
  ],
  merchItems: [
    {
      id: 'mi-tee', chapterId: null, name: 'Club tee', details: 'Black tee with the EST 2019 logo on the back.', sizes: ['S', 'M', 'L', 'XL', '2XL'],
      priceCents: 3500, patchedOnly: false, status: 'on_sale', proposedBy: 'm-rusty', proposedAt: at(ago(40)), decidedBy: 'm-smokey',
      decidedAt: at(ago(38)), declineReason: '',
    },
    {
      id: 'mi-hoodie', chapterId: 'ch-west', name: 'West hoodie', details: 'Heavy black hoodie with the patch on the back. Patched members only.',
      sizes: ['M', 'L', 'XL', '2XL', '3XL'], priceCents: 8500, patchedOnly: true, status: 'proposed', proposedBy: 'm-torque',
      proposedAt: at(ago(3)), decidedBy: null, decidedAt: null, declineReason: '',
    },
  ],
  merchOrders: [
    {
      id: 'mo-1', itemId: 'mi-tee', memberId: 'm-spanner', size: 'XL', qty: 2, unitCents: 3500, note: 'One for the missus.',
      status: 'waiting', orderedAt: at(ago(1)), decidedBy: null, decidedAt: null, declineReason: '', paidOn: null, ledgerEntryId: null, handedOverOn: null,
    },
    {
      id: 'mo-2', itemId: 'mi-tee', memberId: 'm-throttle', size: 'M', qty: 1, unitCents: 3500, note: '',
      status: 'approved', orderedAt: at(ago(6)), decidedBy: 'm-rusty', decidedAt: at(ago(5)), declineReason: '', paidOn: null, ledgerEntryId: null, handedOverOn: null,
    },
  ],
  contributions: [
    {
      id: 'nc-1', title: 'National run 2027', purpose: 'Deposit on the campground at Bright for the first national run, and the patches for it.',
      totalCents: 120000, status: 'proposed', proposedBy: 'm-rusty', proposedAt: at(ago(4)), settledAt: null,
      shares: [{ chapterId: 'ch-north', votingMembers: 5, cents: 50000 }, { chapterId: 'ch-west', votingMembers: 7, cents: 70000 }],
      decisions: [],
    },
  ],
  chapterProposals: [
    {
      id: 'cp-1', name: 'Geelong', area: 'Geelong and the Bellarine', state: 'VIC',
      plan: {
        location: 'Geelong, meeting at the Corio pub on the first Tuesday.',
        membership: 'Five patched members moving across from West, with three riders introduced and waiting.',
        leadership: 'Diesel as President and Gravel as Sergeant-at-Arms to start, with an election at the first AGM.',
        budget: '$300 start-up from the founders for patches and a flag. Fees as West until the board sets its own.',
        operations: 'Monthly ride on the third Sunday, out along the Great Ocean Road, joining West for club runs.',
      },
      founderIds: ['m-diesel', 'm-gravel', 'm-spanner', 'm-chook', 'm-sparks'], presidentId: 'm-diesel', saaId: 'm-gravel',
      status: 'proposed', proposedBy: 'm-diesel', proposedAt: at(ago(2)), voteId: null, decidedBy: null, decidedAt: null, chapterId: null,
    },
  ],
} satisfies Partial<ClubData>);
