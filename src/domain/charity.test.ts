import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_CHARITY_CLOSING_DAY, CAUSE_NEEDED, CHARITY_LOCKED, CHARITY_TEXT_TOO_LONG, charityCounts, charityFor, charityListText, isCharityRide,
  JOB_IN_USE, JOB_NOT_LISTED, JOBS_LIMITS, JOBS_REPEATED, GUESTS_LIMITS, NO_CHARITY, NOT_CHARITY_MANAGER, NOT_SIGNED_UP, NOTHING_PICKED,
  PILLION_NEEDS_RIDER, PLACES_LIMITS, placesLeft, RIDE_FULL, ridingNotGoing, runsCharity, saveCharityProblem, SIGNUP_TOO_LONG,
  SIGNUPS_CLOSED, signupProblem, signupsClosed, signupsFor, visibleSignups, withdrawCharityProblem, type CharityInput, type SignupInput,
} from './charity';
import { AFTER_DAY, BEFORE, member, planningClub, who } from './planning.testkit';
import type { CharityRide, CharitySignup, ClubData } from './types';

const input: CharityInput = { cause: 'Royal Children’s Hospital', about: '', closesOn: null, places: null, jobs: [] };
const charity = (over: Partial<CharityRide> = {}): CharityRide => ({
  rideId: 'r-club', cause: 'Royal Children’s Hospital', about: '', closesOn: null, places: null, jobs: ['BBQ', 'Marshal'],
  updatedBy: 'sec', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
});
const signup = (memberId: string, over: Partial<CharitySignup> = {}): CharitySignup => ({
  rideId: 'r-club', memberId, riding: true, pillion: false, guests: 0, guestNames: '', job: null, notes: '',
  signedAt: '2026-10-02T00:00:00.000Z', withdrawnAt: null, ...over,
});
const mine = (over: Partial<SignupInput> = {}): SignupInput => ({ riding: true, pillion: false, guests: 0, guestNames: '', job: null, notes: '', ...over });

/** The planning club plus cc, on the West Charity Committee. */
function charityClub(over: Partial<ClubData> = {}): ClubData {
  const base = planningClub();
  return {
    ...base,
    members: [...base.members, member('cc')],
    positions: [...base.positions, { id: 'p-cc', memberId: 'cc', chapterId: 'west', role: 'charity_committee', startedOn: '2025-01-01', endedOn: null }],
    ...over,
  };
}

test('who runs sign-ups: the ride’s crew managers and the Charity Committee', () => {
  const data = charityClub();
  const west = data.rides.find((r) => r.id === 'r-west')!;
  const club = data.rides.find((r) => r.id === 'r-club')!;
  assert.equal(runsCharity(who(data, 'sec'), west, data), true, 'West board');
  assert.equal(runsCharity(who(data, 'chair'), west, data), true, 'NEC');
  assert.equal(runsCharity(who(data, 'cc'), west, data), true, 'Charity Committee');
  assert.equal(runsCharity(who(data, 'cc'), club, data), true, 'Charity Committee, a whole-club ride');
  assert.equal(runsCharity(who(data, 'northsec'), west, data), false, 'another chapter’s board');
  assert.equal(runsCharity(who(data, 'rider'), club, data), false);
  const ended = { ...data, positions: data.positions.map((p) => (p.id === 'p-cc' ? { ...p, endedOn: '2026-01-01' } : p)) };
  assert.equal(runsCharity(who(ended, 'cc'), west, ended), false, 'a seat that ended');
  assert.equal(runsCharity({ ...who(data, 'cc'), approval: 'pending' }, west, data), false);
});

test('running sign-ups: in the database’s order', () => {
  const data = charityClub();
  const club = data.rides.find((r) => r.id === 'r-club');
  const sec = who(data, 'sec');
  assert.equal(saveCharityProblem(null, club, input, data, BEFORE), 'Sign in first.');
  assert.equal(saveCharityProblem(sec, undefined, input, data, BEFORE), 'No such ride.');
  assert.equal(saveCharityProblem(sec, data.rides.find((r) => r.id === 'r-off'), input, data, BEFORE), 'That ride was cancelled.');
  assert.equal(saveCharityProblem(sec, club, input, data, AFTER_DAY), CHARITY_LOCKED);
  assert.equal(saveCharityProblem(who(data, 'rider'), club, input, data, BEFORE), NOT_CHARITY_MANAGER);
  assert.equal(saveCharityProblem(sec, club, { ...input, cause: '   ' }, data, BEFORE), CAUSE_NEEDED);
  assert.equal(saveCharityProblem(sec, club, { ...input, cause: 'x'.repeat(121) }, data, BEFORE), CHARITY_TEXT_TOO_LONG);
  assert.equal(saveCharityProblem(sec, club, { ...input, cause: ` ${'x'.repeat(120)} ` }, data, BEFORE), null, 'trimmed first');
  assert.equal(saveCharityProblem(sec, club, { ...input, about: 'x'.repeat(1001) }, data, BEFORE), CHARITY_TEXT_TOO_LONG);
  assert.equal(saveCharityProblem(sec, club, { ...input, places: 0 }, data, BEFORE), PLACES_LIMITS);
  assert.equal(saveCharityProblem(sec, club, { ...input, places: 2001 }, data, BEFORE), PLACES_LIMITS);
  assert.equal(saveCharityProblem(sec, club, { ...input, places: 2.5 }, data, BEFORE), PLACES_LIMITS);
  assert.equal(saveCharityProblem(sec, club, { ...input, places: 2000 }, data, BEFORE), null);
  const nine = Array.from({ length: 9 }, (_, i) => `Job ${i}`);
  assert.equal(saveCharityProblem(sec, club, { ...input, jobs: nine }, data, BEFORE), JOBS_LIMITS);
  assert.equal(saveCharityProblem(sec, club, { ...input, jobs: [...nine.slice(0, 8), '  '] }, data, BEFORE), null, 'blank jobs drop out');
  assert.equal(saveCharityProblem(sec, club, { ...input, jobs: ['x'.repeat(41)] }, data, BEFORE), JOBS_LIMITS);
  assert.equal(saveCharityProblem(sec, club, { ...input, jobs: ['BBQ', ' bbq '] }, data, BEFORE), JOBS_REPEATED);
  assert.equal(saveCharityProblem(sec, club, { ...input, closesOn: '2026-10-31' }, data, BEFORE), BAD_CHARITY_CLOSING_DAY);
  assert.equal(saveCharityProblem(sec, club, { ...input, closesOn: '2026-11-09' }, data, BEFORE), BAD_CHARITY_CLOSING_DAY);
  assert.equal(saveCharityProblem(sec, club, { ...input, closesOn: '2026-11-01' }, data, BEFORE), null);
  assert.equal(saveCharityProblem(sec, club, { ...input, closesOn: '2026-11-08' }, data, BEFORE), null);
  assert.equal(saveCharityProblem(who(data, 'cc'), club, input, data, BEFORE), null, 'the Charity Committee');
});

test('a job someone’s on stays on the list; a passed closing day can stay', () => {
  const data = charityClub({ charityRides: [charity({ closesOn: '2026-10-20' })], charitySignups: [signup('rc', { job: 'Marshal' }), signup('tg', { job: 'BBQ', withdrawnAt: '2026-10-03T00:00:00.000Z' })] });
  const club = data.rides.find((r) => r.id === 'r-club');
  const sec = who(data, 'sec');
  const keep = { ...input, closesOn: '2026-10-20' };
  assert.equal(saveCharityProblem(sec, club, { ...keep, jobs: ['BBQ'] }, data, BEFORE), 'Someone’s helping with “Marshal”, so keep that job.');
  assert.equal(JOB_IN_USE('Marshal'), 'Someone’s helping with “Marshal”, so keep that job.');
  assert.equal(saveCharityProblem(sec, club, { ...keep, jobs: [' Marshal '] }, data, BEFORE), null, 'a withdrawn helper doesn’t hold BBQ');
  assert.equal(saveCharityProblem(sec, club, { ...keep, jobs: ['Marshal', 'Buckets'] }, data, BEFORE), null);
});

test('signing up: in the database’s order', () => {
  const today = '2026-11-01';
  const open = () => charityClub({ charityRides: [charity()] });
  const check = (me: string, s: SignupInput, data = open(), now = BEFORE, day = today) =>
    signupProblem(who(data, me), data.rides.find((r) => r.id === 'r-club'), s, data, now, day);
  const base = charityClub();
  assert.equal(signupProblem(null, base.rides[0], mine(), base, BEFORE, today), 'Sign in first.');
  assert.equal(signupProblem(who(base, 'rider'), undefined, mine(), base, BEFORE, today), 'No such ride.');
  assert.equal(check('rider', mine(), base), NO_CHARITY);
  assert.equal(check('rider', mine(), undefined, '2026-11-07T21:30:00.000Z'), SIGNUPS_CLOSED);
  assert.equal(check('rider', mine(), charityClub({ charityRides: [charity({ closesOn: '2026-10-31' })] })), SIGNUPS_CLOSED);
  assert.equal(check('rider', mine(), charityClub({ charityRides: [charity({ closesOn: '2026-11-01' })] })), null, 'open all the closing day');
  assert.equal(check('rider', mine({ riding: false })), NOTHING_PICKED);
  assert.equal(check('rider', mine({ riding: false, pillion: true, job: 'BBQ' })), PILLION_NEEDS_RIDER);
  assert.equal(check('rider', mine({ guests: -1 })), GUESTS_LIMITS);
  assert.equal(check('rider', mine({ guests: 11 })), GUESTS_LIMITS);
  assert.equal(check('rider', mine({ guests: 1.5 })), GUESTS_LIMITS);
  assert.equal(check('rider', mine({ job: 'Buckets' })), JOB_NOT_LISTED);
  assert.equal(check('rider', mine({ guestNames: 'x'.repeat(201) })), SIGNUP_TOO_LONG);
  assert.equal(check('rider', mine({ notes: 'x'.repeat(201) })), SIGNUP_TOO_LONG);
  assert.equal(check('rider', mine({ riding: false, job: 'BBQ' })), null, 'helping only');
  assert.equal(check('rider', mine({ guests: 10, guestNames: 'The Smiths' })), null);
  // Open to every approved member: Supporters too.
  assert.equal(check('sup', mine()), null);
  assert.equal(check('legacy', mine()), null);
  assert.equal(check('applicant', mine()), 'Only approved members can do that.');
});

test('places count riders, pillions and guests, leaving out your own sign-up and withdrawn ones', () => {
  const data = charityClub({
    charityRides: [charity({ places: 5 })],
    charitySignups: [
      signup('rc', { pillion: true, guests: 1 }), // 3
      signup('tg', { riding: false, job: 'BBQ' }), // 0
      signup('off', { guests: 4, withdrawnAt: '2026-10-05T00:00:00.000Z' }), // withdrawn
    ],
  });
  const club = data.rides.find((r) => r.id === 'r-club')!;
  const check = (me: string, s: SignupInput) => signupProblem(who(data, me), club, s, data, BEFORE, '2026-11-01');
  assert.equal(placesLeft(club.id, data), 2);
  assert.equal(check('rider', mine({ pillion: true, guests: 1 })), RIDE_FULL);
  assert.equal(check('rider', mine({ pillion: true })), null);
  assert.equal(check('rider', mine({ riding: false, job: 'BBQ', guests: 2 })), null, 'a helper’s guests count too, and fit');
  assert.equal(check('rider', mine({ riding: false, job: 'BBQ', guests: 3 })), RIDE_FULL);
  assert.equal(check('rc', mine({ pillion: true, guests: 3 })), null, 'your own sign-up isn’t counted twice');
  assert.equal(check('tg', mine({ riding: false, job: 'Marshal' })), null, 'a helper fits a full ride');
  assert.equal(placesLeft(club.id, charityClub({ charityRides: [charity()] })), null, 'no limit');
});

test('withdrawing: until the start, whatever the closing day', () => {
  const data = charityClub({ charityRides: [charity({ closesOn: '2026-10-01' })], charitySignups: [signup('rc'), signup('tg', { withdrawnAt: '2026-10-05T00:00:00.000Z' })] });
  const club = data.rides.find((r) => r.id === 'r-club');
  assert.equal(withdrawCharityProblem(null, club, data, BEFORE), 'Sign in first.');
  assert.equal(withdrawCharityProblem(who(data, 'rc'), undefined, data, BEFORE), 'No such ride.');
  assert.equal(withdrawCharityProblem(who(data, 'tg'), club, data, BEFORE), NOT_SIGNED_UP);
  assert.equal(withdrawCharityProblem(who(data, 'rc'), club, data, BEFORE), null);
  assert.equal(withdrawCharityProblem(who(data, 'rc'), club, data, '2026-11-07T21:30:00.000Z'), SIGNUPS_CLOSED);
});

test('closing: at the start, or after the closing day', () => {
  const data = charityClub({ charityRides: [charity({ closesOn: '2026-11-03' })] });
  const club = data.rides.find((r) => r.id === 'r-club')!;
  const c = charityFor(club.id, data)!;
  assert.equal(signupsClosed(club, c, BEFORE, '2026-11-03'), false);
  assert.equal(signupsClosed(club, c, BEFORE, '2026-11-04'), true);
  assert.equal(signupsClosed(club, { ...c, closesOn: null }, '2026-11-07T21:29:00.000Z', '2026-11-08'), false);
  assert.equal(signupsClosed(club, { ...c, closesOn: null }, '2026-11-07T21:30:00.000Z', '2026-11-08'), true);
  assert.equal(isCharityRide(club.id, data), true);
  assert.equal(isCharityRide('r-west', data), false);
});

test('the counts, the list in order, and the Going nudge', () => {
  const data = charityClub({
    members: [...charityClub().members.map((m) => (m.id === 'rc' ? { ...m, roadName: 'Captain' } : m))],
    charityRides: [charity({ places: 20, about: 'Bring a gold coin.' })],
    charitySignups: [
      signup('rc', { pillion: true, guests: 2, guestNames: 'Bec and Joe', signedAt: '2026-10-03T00:00:00.000Z' }),
      signup('rider', { job: 'Marshal', signedAt: '2026-10-02T00:00:00.000Z' }),
      signup('tg', { riding: false, job: 'BBQ', notes: 'Bringing tongs', signedAt: '2026-10-01T00:00:00.000Z' }),
      signup('off', { withdrawnAt: '2026-10-05T00:00:00.000Z' }),
    ],
  });
  assert.deepEqual(signupsFor('r-club', data).map((s) => s.memberId), ['tg', 'rider', 'rc']);
  assert.deepEqual(charityCounts('r-club', data), { riding: 2, pillions: 1, guests: 2, helping: 2, people: 5 });
  const ride = data.rides.find((r) => r.id === 'r-club')!;
  assert.equal(
    charityListText(who(data, 'sec'), ride, data),
    [
      'Coffee run · Sun 08/11/2026',
      'Raising money for Royal Children’s Hospital',
      '2 riders, 1 pillion, 2 guests: 5 on bikes (15 places left)',
      '',
      'Riding',
      '- Captain (rc Rider) + pillion + 2 guests (Bec and Joe)',
      '- rider Rider, also Marshal',
      '',
      'BBQ',
      '- tg Rider: Bringing tongs',
      '',
      'Marshal',
      '- rider Rider',
    ].join('\n'),
  );
  // rc is Going on the West ride, not this one.
  assert.equal(ridingNotGoing('r-club', who(data, 'rc'), data), true);
  assert.equal(ridingNotGoing('r-club', who(data, 'tg'), data), false, 'helping only');
  const going = { ...data, rsvps: [...data.rsvps, { rideId: 'r-club', memberId: 'rc', answer: 'going' as const, updatedAt: '2026-10-01T00:00:00.000Z' }] };
  assert.equal(ridingNotGoing('r-club', who(going, 'rc'), going), false);
});

test('who sees the sign-ups: your own, all of them for the organisers, and your chapter’s members for its board', () => {
  const base = charityClub();
  const data = charityClub({
    members: [...base.members, member('ninth', { chapterId: 'north' })],
    charityRides: [charity(), charity({ rideId: 'r-west' })],
    charitySignups: [
      signup('rc'), signup('rider', { job: 'Marshal' }), signup('ninth', { signedAt: '2026-10-03T00:00:00.000Z' }),
      signup('rc', { rideId: 'r-west' }), signup('ninth', { rideId: 'r-west', signedAt: '2026-10-03T00:00:00.000Z' }),
    ],
  });
  const ids = (me: string, rideId: string) => visibleSignups(who(data, me), rideId, data).map((s) => s.memberId);
  assert.deepEqual(ids('rc', 'r-club'), ['rc'], 'your own');
  assert.deepEqual(ids('tg', 'r-club'), [], 'nobody else’s');
  assert.deepEqual(ids('cc', 'r-club'), ['rc', 'rider', 'ninth'], 'the Charity Committee');
  assert.deepEqual(ids('sec', 'r-club'), ['rc', 'rider', 'ninth'], 'the ride’s managers');
  assert.deepEqual(ids('northsec', 'r-club'), ['rc', 'rider', 'ninth'], 'any board runs a whole-club ride');
  assert.deepEqual(ids('auditor', 'r-club'), [], 'the Auditor runs no rides');
  assert.deepEqual(ids('northsec', 'r-west'), ['ninth'], 'North’s board sees its own member on a West ride');
  assert.deepEqual(ids('chair', 'r-west'), ['rc', 'ninth'], 'the national roles run every ride');
  assert.deepEqual(visibleSignups(null, 'r-club', data), []);
  const ride = data.rides.find((r) => r.id === 'r-club')!;
  assert.match(charityListText(who(data, 'rc'), ride, data), /rc Rider/);
  assert.doesNotMatch(charityListText(who(data, 'rc'), ride, data), /ninth Rider/);
});

test('the numbers come from the database’s counts when they’re here; your own places aren’t counted against you', () => {
  const counts = {
    rideId: 'r-club', hubRiders: 0, hubPillions: 0, hubGroup: 0, hubOwn: 0, hubCamping: 0, hubDay: 0, hubGroupBeds: 0,
    charityRiding: 3, charityPillions: 1, charityGuests: 2, charityHelping: 1, charityPeople: 6,
    websiteRiding: 0, websitePillions: 0, websiteGuests: 0, websiteHelping: 0, websitePeople: 0,
  };
  const data = charityClub({ charityRides: [charity({ places: 8 })], charitySignups: [signup('rider', { pillion: true })], signupCounts: [counts] });
  assert.deepEqual(charityCounts('r-club', data), { riding: 3, pillions: 1, guests: 2, helping: 1, people: 6 });
  assert.equal(placesLeft('r-club', data), 2);
  const club = data.rides.find((r) => r.id === 'r-club')!;
  const check = (me: string, s: SignupInput) => signupProblem(who(data, me), club, s, data, BEFORE, '2026-11-01');
  assert.equal(check('rider', mine({ pillion: true, guests: 2 })), null, 'four held by others, four wanted, eight places');
  assert.equal(check('rider', mine({ pillion: true, guests: 3 })), RIDE_FULL);
  assert.equal(check('tg', mine({ pillion: true })), null, 'six held, two wanted');
  assert.equal(check('tg', mine({ pillion: true, guests: 1 })), RIDE_FULL);
});
