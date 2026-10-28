// The live database's ride planning extras: reading the six tables into the app's records, and
// each action's arguments. A table the live database doesn't have yet loads as none, so the app
// still opens before the migration is pasted.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HubInput, RegisterInput } from '../domain/hubs';
import { cleanStops } from '../domain/ridePlan';
import type { ClubData, PlanStop, RideCallState } from '../domain/types';
import type { Database } from './database.types';

/** Postgres timestamps as the app's ISO instants. */
const instant = (ts: string) => new Date(ts).toISOString();
/** PostgREST's and Postgres's "no such table" codes. */
const MISSING_TABLE = ['PGRST205', '42P01'];

type Planning = Pick<ClubData, 'ridePlans' | 'routeRatings' | 'rideCalls' | 'rideHubs' | 'hubRegistrations' | 'crewSwaps'>;

/** PostgREST hands back at most this many rows a request, so longer tables are read a page at a time. */
const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string; code?: string } | null };

/** Every row, a page at a time in a fixed order, so nothing is cut off as the tables grow. */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await page(from, from + PAGE - 1);
    if (r.error) return { data: null, error: r.error };
    rows.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGE) return { data: rows, error: null };
  }
}

export async function loadPlanning(db: SupabaseClient<Database>): Promise<Planning> {
  const [plans, ratings, calls, hubs, regs, swaps] = await Promise.all([
    allRows((a, b) => db.from('ride_plans').select('*').order('ride_id').range(a, b)),
    allRows((a, b) => db.from('route_ratings').select('*').order('route_id').order('member_id').range(a, b)),
    allRows((a, b) => db.from('ride_calls').select('*').order('ride_id').range(a, b)),
    allRows((a, b) => db.from('ride_hubs').select('*').order('ride_id').range(a, b)),
    allRows((a, b) => db.from('hub_registrations').select('*').order('ride_id').order('member_id').range(a, b)),
    allRows((a, b) => db.from('crew_swaps').select('*').order('id').range(a, b)),
  ]);
  for (const r of [plans, ratings, calls, hubs, regs, swaps]) {
    if (r.error && !MISSING_TABLE.includes(r.error.code ?? '')) throw new Error(r.error.message ?? 'Couldn’t load the club data.');
  }
  // Blank texts are stored as null.
  return {
    ridePlans: (plans.data ?? []).map((p) => ({ rideId: p.ride_id, stops: p.stops ?? [], updatedAt: instant(p.updated_at), updatedBy: p.updated_by })),
    routeRatings: (ratings.data ?? []).map((r) => ({
      routeId: r.route_id, memberId: r.member_id, stars: r.stars, comment: r.comment ?? '', ratedAt: instant(r.rated_at),
    })),
    rideCalls: (calls.data ?? []).map((c) => ({
      rideId: c.ride_id, state: c.state, reason: c.reason ?? '', newDay: c.new_day, calledBy: c.called_by, calledAt: instant(c.called_at),
    })),
    rideHubs: (hubs.data ?? []).map((h) => ({
      rideId: h.ride_id, membersOnly: h.members_only, closesOn: h.closes_on, beds: h.beds, accommodation: h.accommodation ?? '',
      notes: h.notes ?? '', updatedBy: h.updated_by, updatedAt: instant(h.updated_at),
    })),
    hubRegistrations: (regs.data ?? []).map((r) => ({
      rideId: r.ride_id, memberId: r.member_id, staying: r.staying, pillion: r.pillion, shareWith: r.share_with ?? '', notes: r.notes ?? '',
      registeredAt: instant(r.registered_at), withdrawnAt: r.withdrawn_at ? instant(r.withdrawn_at) : null,
    })),
    crewSwaps: (swaps.data ?? []).map((s) => ({
      id: s.id, rideId: s.ride_id, askedBy: s.asked_by, role: s.role, askedTo: s.asked_to, theirRole: s.their_role, note: s.note ?? '',
      state: s.state, askedAt: instant(s.asked_at), answeredAt: s.answered_at ? instant(s.answered_at) : null,
    })),
  };
}

const textOrNull = (s: string) => s.trim() || null;

export const setBikeRangeArgs = (bikeId: string, rangeKm: number | null) => ({ p_bike: bikeId, p_range: rangeKm });

/** save_ride_plan's arguments: the stops cleaned, and the version the editor opened on. */
export const saveRidePlanArgs = (rideId: string, stops: PlanStop[], seen: string | null) => ({ p_ride: rideId, p_stops: cleanStops(stops), p_seen: seen });

export const rateRouteArgs = (routeId: string, stars: number, comment: string) => ({ p_route: routeId, p_stars: stars, p_comment: textOrNull(comment) });

export const callRideArgs = (rideId: string, state: RideCallState, reason: string, newDay: string | null) => ({
  p_ride: rideId, p_state: state, p_reason: state === 'on' ? null : textOrNull(reason), p_new_day: newDay,
});

export const saveHubArgs = (rideId: string, input: HubInput) => ({
  p_ride: rideId, p_members_only: input.membersOnly, p_closes_on: input.closesOn, p_beds: input.beds,
  p_accommodation: textOrNull(input.accommodation), p_notes: textOrNull(input.notes),
});

export const registerHubArgs = (rideId: string, input: RegisterInput) => ({
  p_ride: rideId, p_staying: input.staying, p_pillion: input.pillion, p_share_with: textOrNull(input.shareWith), p_notes: textOrNull(input.notes),
});

export const askSwapArgs = (rideId: string, toId: string, note: string) => ({ p_ride: rideId, p_to: toId, p_note: textOrNull(note) });
