/**
 * Charity ride sign-ups from the club website. An organiser ticks "Take sign-ups from the website"
 * on a charity ride (`CharityInput.website`); the website then lists it and people who aren't in the
 * app sign up through the `site-api` Edge Function, which checks the form with these words and
 * stores it with `public.website_signup`. The database mirrors these rules in the same order
 * (supabase/migrations/*_website_charity_signups.sql); change both together.
 *
 * Website sign-ups share the ride's places with members' sign-ups (charity.ts) and are read only
 * by the people who run that ride; everyone approved sees the numbers.
 */
import { signedInProblem } from './routes';
import {
  GUESTS_LIMITS, JOB_NOT_LISTED, MAX_GUESTS, MAX_GUEST_NAMES, MAX_SIGNUP_NOTES, NOTHING_PICKED, PILLION_NEEDS_RIDER,
  RIDE_FULL, SIGNUP_TOO_LONG, SIGNUPS_CLOSED, cleanJob, runsCharity, signupsClosed,
} from './charity';
import { endOfFirstDay } from './rides';
import type { CharityRide, ClubData, Member, Ride, WebsiteSignup } from './types';

export type { WebsiteSignup };

export const NOT_ON_WEBSITE = 'This ride isn’t taking sign-ups from the website.';
export const NO_SIGNUP_NAME = 'Tell us your name.';
export const LONG_SIGNUP_NAME = 'Keep your name to 80 characters.';
export const BAD_SIGNUP_EMAIL = 'That email address does not look right.';
export const LONG_SIGNUP_PHONE = 'Keep the phone number to 30 characters.';
export const TOO_MANY_SIGNUPS = 'Too many sign-ups just now. Try again later, or email the club.';
export const WEBSITE_SIGNUP_GONE = 'No such sign-up.';
export const WEBSITE_SIGNUP_LOCKED = 'Sign-ups can’t change after the ride day.';

export const SIGNUP_NAME_MAX = 80;
export const SIGNUP_EMAIL_MAX = 200;
export const SIGNUP_PHONE_MAX = 30;

/** What the website form sends. */
export interface WebsiteSignupInput {
  name: string;
  email: string;
  phone: string;
  riding: boolean;
  pillion: boolean;
  guests: number;
  guestNames: string;
  job: string | null;
  notes: string;
}

/** What the website shows for one ride taking sign-ups (public_charity_rides). */
export interface PublicCharityRide {
  ride_id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  location: string | null;
  cause: string;
  about: string | null;
  closes_on: string | null;
  jobs: string[];
  places: number | null;
  places_left: number | null;
  open: boolean;
}

/** A plausible address: something@something.tld, no spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const websiteSignupsFor = (rideId: string, data: ClubData): WebsiteSignup[] =>
  (data.websiteSignups ?? []).filter((w) => w.rideId === rideId);

/** People on bikes in one website sign-up. */
export const websiteOnBikes = (w: Pick<WebsiteSignup, 'riding' | 'pillion' | 'guests'>): number =>
  (w.riding ? 1 : 0) + (w.pillion ? 1 : 0) + w.guests;

/**
 * Why the form can't be kept, or null. The ride and its sheet are what the website has already
 * been told (so the Edge Function and the database decide the rest); the form checks here are the
 * ones the website and the function run, in the database's order and words.
 */
export function websiteFormProblem(input: WebsiteSignupInput, jobs: string[]): string | null {
  const name = input.name.trim();
  if (!name) return NO_SIGNUP_NAME;
  if (name.length > SIGNUP_NAME_MAX) return LONG_SIGNUP_NAME;
  const email = input.email.trim();
  if (email.length > SIGNUP_EMAIL_MAX || !EMAIL.test(email)) return BAD_SIGNUP_EMAIL;
  if (input.phone.trim().length > SIGNUP_PHONE_MAX) return LONG_SIGNUP_PHONE;
  const job = cleanJob(input.job);
  if (!input.riding && job === null) return NOTHING_PICKED;
  if (!input.riding && input.pillion) return PILLION_NEEDS_RIDER;
  if (!Number.isInteger(input.guests) || input.guests < 0 || input.guests > MAX_GUESTS) return GUESTS_LIMITS;
  if (job !== null && !jobs.includes(job)) return JOB_NOT_LISTED;
  if (input.guestNames.trim().length > MAX_GUEST_NAMES || input.notes.trim().length > MAX_SIGNUP_NOTES) return SIGNUP_TOO_LONG;
  return null;
}

/**
 * Why a website sign-up for this ride can't be kept, or null: the whole of the database's
 * `website_signup` apart from the spam limits. Used by the demo and by tests of the rule order.
 */
export function websiteSignupProblem(
  ride: Ride | undefined,
  charity: CharityRide | undefined,
  input: WebsiteSignupInput,
  data: ClubData,
  now: string,
  today: string,
): string | null {
  if (!ride || !charity || !charity.website || ride.cancelledAt) return NOT_ON_WEBSITE;
  if (signupsClosed(ride, charity, now, today)) return SIGNUPS_CLOSED;
  const form = websiteFormProblem(input, charity.jobs);
  if (form) return form;
  const mine = websiteOnBikes(input);
  if (charity.places !== null && mine > 0) {
    const email = input.email.trim().toLowerCase();
    const members = (data.charitySignups ?? []).filter((s) => s.rideId === ride.id && s.withdrawnAt === null)
      .reduce((n, s) => n + websiteOnBikes(s), 0);
    const site = websiteSignupsFor(ride.id, data).filter((w) => w.email !== email).reduce((n, w) => n + websiteOnBikes(w), 0);
    if (members + site + mine > charity.places) return RIDE_FULL;
  }
  return null;
}

/** The form as stored: trimmed, email lower-cased, blanks kept as empty. */
export function cleanWebsiteSignup(input: WebsiteSignupInput): WebsiteSignupInput {
  return {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    riding: input.riding,
    pillion: input.riding && input.pillion,
    guests: input.guests,
    guestNames: input.guestNames.trim(),
    job: cleanJob(input.job),
    notes: input.notes.trim(),
  };
}

/** Why `me` can't remove this website sign-up, or null. Mirrors public.remove_website_signup. */
export function removeWebsiteSignupProblem(me: Member | null, signup: WebsiteSignup | undefined, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  const ride = signup ? data.rides.find((r) => r.id === signup.rideId) : undefined;
  if (!signup || !ride || !runsCharity(me, ride, data)) return WEBSITE_SIGNUP_GONE;
  if (Date.parse(now) >= endOfFirstDay(ride)) return WEBSITE_SIGNUP_LOCKED;
  return null;
}

/** "Sam Rider · 0400 000 000" or the email when there's no phone. */
export function websiteContact(w: WebsiteSignup): string {
  return w.phone || w.email;
}
