// Charity ride sign-ups: who's riding, pillions and guests, and who's helping on the day. No
// payments yet (donations come with payments). These are the rules the database's save_charity,
// sign_up_charity and withdraw_charity apply, in the same order with the same words.

import { managesRide } from './crew';
import { activePositions, isApprovedMember, seesBoardOf } from './access';
import { formatAuDate, weekday } from './dates';
import { answersClose, endOfFirstDay, melbourneDate } from './rides';
import { signedInProblem } from './routes';
import type { CharityRide, CharitySignup, ClubData, Member, Ride } from './types';

export const MAX_CAUSE = 120;
export const MAX_ABOUT = 1000;
export const MAX_JOBS = 8;
export const MAX_JOB = 40;
export const MAX_GUESTS = 10;
export const MAX_GUEST_NAMES = 200;
export const MAX_SIGNUP_NOTES = 200;

export const CHARITY_LOCKED = 'Sign-ups can’t change after the ride day.';
export const NOT_CHARITY_MANAGER = 'Only the board, ride committee, charity committee or NEC can run sign-ups.';
export const CAUSE_NEEDED = 'Say who the ride is raising money for.';
export const CHARITY_TEXT_TOO_LONG = 'That’s too long: 120 characters for the cause, 1000 for the rest.';
export const PLACES_LIMITS = 'Places: 1 to 2000, or leave it blank.';
export const JOBS_LIMITS = 'Up to 8 helper jobs, 40 characters each.';
export const JOBS_REPEATED = 'Each job once.';
export const JOB_IN_USE = (job: string) => `Someone’s helping with “${job}”, so keep that job.`;
export const BAD_CHARITY_CLOSING_DAY = 'Pick a closing day from today up to the ride day.';
export const NO_CHARITY = 'This ride doesn’t take sign-ups.';
export const SIGNUPS_CLOSED = 'Sign-ups have closed.';
export const NOTHING_PICKED = 'Say you’re riding, or pick a job to help with.';
export const PILLION_NEEDS_RIDER = 'A pillion needs a rider: say you’re riding too.';
export const GUESTS_LIMITS = 'Guests: 0 to 10.';
export const JOB_NOT_LISTED = 'That job isn’t on the list.';
export const SIGNUP_TOO_LONG = 'Keep it short: 200 characters for guests’ names, 200 for notes.';
export const RIDE_FULL = 'The ride’s full.';
export const NOT_SIGNED_UP = 'You’re not signed up.';
/** The later hook: donations wait on payments in the app. */
export const DONATIONS_LATER = 'Donations come later, once the app can take payments. Give on the day for now.';

export interface CharityInput {
  cause: string;
  about: string;
  closesOn: string | null;
  places: number | null;
  /** As typed: trimmed, and blank ones dropped, on save. */
  jobs: string[];
}

export interface SignupInput {
  riding: boolean;
  pillion: boolean;
  guests: number;
  guestNames: string;
  job: string | null;
  notes: string;
}

const length = (s: string): number => [...s.trim()].length;

/** The jobs as saved: trimmed, blanks dropped. */
export const cleanJobs = (jobs: string[]): string[] => jobs.map((j) => j.trim()).filter((j) => j !== '');

/** The job as saved: trimmed, blank is none. */
export const cleanJob = (job: string | null): string | null => (job === null || job.trim() === '' ? null : job.trim());

export const charityFor = (rideId: string, data: ClubData): CharityRide | undefined =>
  (data.charityRides ?? []).find((c) => c.rideId === rideId);

export const isCharityRide = (rideId: string, data: ClubData): boolean => !!charityFor(rideId, data);

/** A ride's sign-ups that haven't been withdrawn, by when they came in. */
export function signupsFor(rideId: string, data: ClubData): CharitySignup[] {
  return (data.charitySignups ?? [])
    .filter((s) => s.rideId === rideId && !s.withdrawnAt)
    .sort((a, b) => a.signedAt.localeCompare(b.signedAt));
}

export function mySignup(rideId: string, memberId: string, data: ClubData): CharitySignup | undefined {
  return signupsFor(rideId, data).find((s) => s.memberId === memberId);
}

/**
 * The sign-ups `me` sees: their own, all of them when they run the charity ride, and those of
 * members whose chapter board records they see. Mirrors the charity_signups read policy.
 */
export function visibleSignups(me: Member | null, rideId: string, data: ClubData): CharitySignup[] {
  if (!isApprovedMember(me)) return [];
  const ride = data.rides.find((r) => r.id === rideId);
  const all = !!ride && runsCharity(me, ride, data);
  return signupsFor(rideId, data).filter((s) => {
    if (all || s.memberId === me.id) return true;
    const who = data.members.find((m) => m.id === s.memberId);
    return !!who && seesBoardOf(me, who.chapterId, data.positions);
  });
}

/** The ride's counts as the database hands them out, when it has. */
const countsRow = (rideId: string, data: ClubData) => (data.signupCounts ?? []).find((c) => c.rideId === rideId);

/** The ride's crew managers, plus anyone on the Charity Committee. Mirrors private.runs_charity. */
export function runsCharity(me: Member | null, ride: Ride, data: ClubData): boolean {
  if (!isApprovedMember(me)) return false;
  return managesRide(me, ride, data) || activePositions(me.id, data.positions).some((p) => p.role === 'charity_committee');
}

/** Why `me` can't make this a charity ride or change its sign-ups, or null. Mirrors public.save_charity. */
export function saveCharityProblem(me: Member | null, ride: Ride | undefined, input: CharityInput, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (Date.parse(now) >= endOfFirstDay(ride)) return CHARITY_LOCKED;
  if (!runsCharity(me, ride, data)) return NOT_CHARITY_MANAGER;
  if (length(input.cause) === 0) return CAUSE_NEEDED;
  if (length(input.cause) > MAX_CAUSE || length(input.about) > MAX_ABOUT) return CHARITY_TEXT_TOO_LONG;
  if (input.places !== null && (!Number.isInteger(input.places) || input.places < 1 || input.places > 2000)) return PLACES_LIMITS;
  const jobs = cleanJobs(input.jobs);
  if (jobs.length > MAX_JOBS || jobs.some((j) => [...j].length > MAX_JOB)) return JOBS_LIMITS;
  if (new Set(jobs.map((j) => j.toLowerCase())).size !== jobs.length) return JOBS_REPEATED;
  // A job stays while someone's signed up for it (the first such job, in the old list's order).
  const held = new Set(signupsFor(ride.id, data).map((s) => s.job).filter((j): j is string => j !== null));
  const dropped = (charityFor(ride.id, data)?.jobs ?? []).find((j) => held.has(j) && !jobs.includes(j));
  if (dropped) return JOB_IN_USE(dropped);
  // A closing day already set can stay; a new one runs from today to the ride day.
  const kept = input.closesOn !== null && charityFor(ride.id, data)?.closesOn === input.closesOn;
  if (input.closesOn !== null && !kept && (input.closesOn < melbourneDate(now) || input.closesOn > melbourneDate(ride.startsAt))) {
    return BAD_CHARITY_CLOSING_DAY;
  }
  return null;
}

/** Whether sign-ups are closed: the ride has started, or its closing day (Melbourne `today`) has passed. */
export function signupsClosed(ride: Ride, charity: CharityRide, now: string, today: string): boolean {
  return Date.parse(now) >= answersClose(ride) || (charity.closesOn !== null && today > charity.closesOn);
}

/** People on bikes for one sign-up: the rider, their pillion and their guests. */
const onBikes = (s: Pick<CharitySignup, 'riding' | 'pillion' | 'guests'>): number => (s.riding ? 1 : 0) + (s.pillion ? 1 : 0) + s.guests;

/** People on bikes signed up by everyone but `exceptId`: from the counts when the rows aren't all here. */
function placesTaken(rideId: string, data: ClubData, exceptId: string | null): number {
  const counts = countsRow(rideId, data);
  if (counts) {
    const mine = exceptId === null ? undefined : mySignup(rideId, exceptId, data);
    return counts.charityPeople - (mine ? onBikes(mine) : 0);
  }
  return signupsFor(rideId, data).filter((s) => s.memberId !== exceptId).reduce((n, s) => n + onBikes(s), 0);
}

/** Places still free, or null when the ride has no limit. */
export function placesLeft(rideId: string, data: ClubData): number | null {
  const places = charityFor(rideId, data)?.places ?? null;
  return places === null ? null : Math.max(0, places - placesTaken(rideId, data, null));
}

/** Why `me` can't sign up (or change their sign-up), or null. Mirrors public.sign_up_charity. */
export function signupProblem(
  me: Member | null,
  ride: Ride | undefined,
  input: SignupInput,
  data: ClubData,
  now: string,
  today: string,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  const charity = charityFor(ride.id, data);
  if (!charity) return NO_CHARITY;
  if (signupsClosed(ride, charity, now, today)) return SIGNUPS_CLOSED;
  const job = cleanJob(input.job);
  if (!input.riding && job === null) return NOTHING_PICKED;
  if (!input.riding && input.pillion) return PILLION_NEEDS_RIDER;
  if (!Number.isInteger(input.guests) || input.guests < 0 || input.guests > MAX_GUESTS) return GUESTS_LIMITS;
  if (job !== null && !charity.jobs.includes(job)) return JOB_NOT_LISTED;
  if (length(input.guestNames) > MAX_GUEST_NAMES || length(input.notes) > MAX_SIGNUP_NOTES) return SIGNUP_TOO_LONG;
  // A helper bringing nobody always fits.
  if (charity.places !== null && onBikes(input) > 0 && placesTaken(ride.id, data, me!.id) + onBikes(input) > charity.places) return RIDE_FULL;
  return null;
}

/** Why `me` can't withdraw, or null. The closing day doesn't stop it. Mirrors public.withdraw_charity. */
export function withdrawCharityProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (!mySignup(ride.id, me!.id, data)) return NOT_SIGNED_UP;
  if (Date.parse(now) >= answersClose(ride)) return SIGNUPS_CLOSED;
  return null;
}

export interface CharityCounts {
  riding: number;
  pillions: number;
  guests: number;
  helping: number;
  /** Everyone on bikes: riders, pillions and guests. */
  people: number;
}

export function charityCounts(rideId: string, data: ClubData): CharityCounts {
  const c = countsRow(rideId, data);
  if (c) return { riding: c.charityRiding, pillions: c.charityPillions, guests: c.charityGuests, helping: c.charityHelping, people: c.charityPeople };
  const counts: CharityCounts = { riding: 0, pillions: 0, guests: 0, helping: 0, people: 0 };
  for (const s of signupsFor(rideId, data)) {
    if (s.riding) counts.riding += 1;
    if (s.pillion) counts.pillions += 1;
    counts.guests += s.guests;
    if (s.job !== null) counts.helping += 1;
    counts.people += onBikes(s);
  }
  return counts;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "8 riding · 2 pillions · 3 guests · 4 helping", leaving out the zeros past riding. */
export function countsLine(c: CharityCounts): string {
  return [`${c.riding} riding`, c.pillions ? plural(c.pillions, 'pillion') : null, c.guests ? plural(c.guests, 'guest') : null, c.helping ? `${c.helping} helping` : null]
    .filter(Boolean)
    .join(' · ');
}

/** One sign-up's extras: "+ pillion + 2 guests (Bec and Joe)". */
export function signupExtras(s: CharitySignup): string {
  const guests = s.guests ? ` + ${plural(s.guests, 'guest')}${s.guestNames ? ` (${s.guestNames})` : ''}` : '';
  return `${s.pillion ? ' + pillion' : ''}${guests}`;
}

/** The sign-ups `me` sees as plain text for the organisers: riders by name, then helpers by job. */
export function charityListText(me: Member | null, ride: Ride, data: ClubData): string {
  const day = melbourneDate(ride.startsAt);
  const charity = charityFor(ride.id, data);
  const counts = charityCounts(ride.id, data);
  const left = placesLeft(ride.id, data);
  const name = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? (m.roadName ? `${m.roadName} (${m.fullName})` : m.fullName) : 'Former member';
  };
  const byName = (a: CharitySignup, b: CharitySignup) => name(a.memberId).localeCompare(name(b.memberId));
  const notes = (s: CharitySignup) => (s.notes ? `: ${s.notes}` : '');
  const lines = [
    `${ride.title} · ${weekday(day)} ${formatAuDate(day)}`,
    `Raising money for ${charity?.cause ?? ''}`,
    `${plural(counts.riding, 'rider')}, ${plural(counts.pillions, 'pillion')}, ${plural(counts.guests, 'guest')}: ${counts.people} on bikes` +
      (left === null ? '' : ` (${left} place${left === 1 ? '' : 's'} left)`),
  ];
  const signups = visibleSignups(me, ride.id, data);
  const riders = signups.filter((s) => s.riding).sort(byName);
  if (riders.length > 0) {
    lines.push('', 'Riding');
    // A rider who's also helping says so; their note goes with their job.
    for (const s of riders) lines.push(`- ${name(s.memberId)}${signupExtras(s)}${s.job ? `, also ${s.job}` : notes(s)}`);
  }
  for (const job of charity?.jobs ?? []) {
    const helpers = signups.filter((s) => s.job === job).sort(byName);
    if (helpers.length === 0) continue;
    lines.push('', job);
    for (const s of helpers) lines.push(`- ${name(s.memberId)}${s.riding ? '' : signupExtras(s)}${notes(s)}`);
  }
  return lines.join('\n');
}

/** Signed up to ride, but not Going: the sheet nudges them to say Going too. */
export function ridingNotGoing(rideId: string, me: Member, data: ClubData): boolean {
  const s = mySignup(rideId, me.id, data);
  return !!s && s.riding && !data.rsvps.some((r) => r.rideId === rideId && r.memberId === me.id && r.answer === 'going');
}
