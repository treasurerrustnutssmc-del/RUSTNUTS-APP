// The live database's charity ride sign-ups: reading the two tables into the app's records, and
// each action's arguments. A table the live database doesn't have yet loads as none, so the app
// still opens before the migration is pasted.

import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanJob, cleanJobs, type CharityInput, type SignupInput } from '../domain/charity';
import type { ClubData } from '../domain/types';
import type { Database } from './database.types';
import { allRows } from './planningLive';

const instant = (ts: string) => new Date(ts).toISOString();
/** PostgREST's and Postgres's "no such table" codes. */
const MISSING_TABLE = ['PGRST205', '42P01'];

type Charity = Required<Pick<ClubData, 'charityRides' | 'charitySignups'>>;

export async function loadCharity(db: SupabaseClient<Database>): Promise<Charity> {
  const [rides, signups] = await Promise.all([
    allRows((a, b) => db.from('charity_rides').select('*').order('ride_id').range(a, b)),
    allRows((a, b) => db.from('charity_signups').select('*').order('ride_id').order('member_id').range(a, b)),
  ]);
  for (const r of [rides, signups]) {
    if (r.error && !MISSING_TABLE.includes(r.error.code ?? '')) throw new Error(r.error.message ?? 'Couldn’t load the club data.');
  }
  // Blank texts are stored as null.
  return {
    charityRides: (rides.data ?? []).map((c) => ({
      rideId: c.ride_id, cause: c.cause, about: c.about ?? '', closesOn: c.closes_on, places: c.places, jobs: c.jobs ?? [],
      updatedBy: c.updated_by, updatedAt: instant(c.updated_at),
    })),
    charitySignups: (signups.data ?? []).map((s) => ({
      rideId: s.ride_id, memberId: s.member_id, riding: s.riding, pillion: s.pillion, guests: s.guests, guestNames: s.guest_names ?? '',
      job: s.job, notes: s.notes ?? '', signedAt: instant(s.signed_at), withdrawnAt: s.withdrawn_at ? instant(s.withdrawn_at) : null,
    })),
  };
}

const textOrNull = (s: string) => s.trim() || null;

export const saveCharityArgs = (rideId: string, input: CharityInput) => ({
  p_ride: rideId, p_cause: input.cause.trim(), p_about: textOrNull(input.about), p_closes_on: input.closesOn, p_places: input.places,
  p_jobs: cleanJobs(input.jobs),
});

export const signUpCharityArgs = (rideId: string, input: SignupInput) => ({
  p_ride: rideId, p_riding: input.riding, p_pillion: input.pillion, p_guests: input.guests, p_guest_names: textOrNull(input.guestNames),
  p_job: cleanJob(input.job), p_notes: textOrNull(input.notes),
});
