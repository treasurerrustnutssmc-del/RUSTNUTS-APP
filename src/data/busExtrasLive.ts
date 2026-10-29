// The live database's Rusty Bus extras: reading the keys, odometer and running costs into the app's
// records, and each action's arguments. A table the live database doesn't have yet loads as none,
// so the app still opens before the migration is pasted. Row-level security already limits the
// costs to what this member may see.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusInput } from '../domain/bus';
import { roundLitres, type CostInput, type KmInput } from '../domain/busLog';
import type { ClubData } from '../domain/types';
import type { Database } from './database.types';
import { allRows } from './planningLive';

/** Postgres timestamps as the app's ISO instants. */
const instant = (ts: string) => new Date(ts).toISOString();
const instantOrNull = (ts: string | null) => (ts ? instant(ts) : null);
/** PostgREST's and Postgres's "no such table" codes. */
const MISSING_TABLE = ['PGRST205', '42P01'];

type BusExtras = Pick<ClubData, 'busKeys' | 'busKm' | 'busCosts'>;

export async function loadBusExtras(db: SupabaseClient<Database>): Promise<BusExtras> {
  const [keys, km, costs] = await Promise.all([
    allRows((a, b) => db.from('bus_key_handovers').select('*').order('id').range(a, b)),
    allRows((a, b) => db.from('bus_km').select('*').order('id').range(a, b)),
    allRows((a, b) => db.from('bus_costs').select('*').order('id').range(a, b)),
  ]);
  for (const r of [keys, km, costs]) {
    if (r.error && !MISSING_TABLE.includes(r.error.code ?? '')) throw new Error(r.error.message ?? 'Couldn’t load the club data.');
  }
  // Blank notes are stored as null; litres come back as numbers or numeric strings.
  return {
    busKeys: (keys.data ?? []).map((k) => ({ id: k.id, toId: k.to_id, note: k.note ?? '', loggedBy: k.logged_by, loggedAt: instant(k.logged_at) })),
    busKm: (km.data ?? []).map((r) => ({
      id: r.id, km: r.km, readOn: r.read_on, bookingId: r.booking_id, note: r.note ?? '', loggedBy: r.logged_by,
      loggedAt: instant(r.logged_at), struckBy: r.struck_by, struckAt: instantOrNull(r.struck_at),
    })),
    busCosts: (costs.data ?? []).map((c) => ({
      id: c.id, spentOn: c.spent_on, kind: c.kind, amountCents: c.amount_cents, litres: c.litres === null ? null : Number(c.litres),
      bookingId: c.booking_id, note: c.note ?? '', loggedBy: c.logged_by, loggedAt: instant(c.logged_at),
      struckBy: c.struck_by, struckAt: instantOrNull(c.struck_at),
    })),
  };
}

const textOrNull = (s: string) => s.trim() || null;

/** change_bus's arguments: the booking, the days (missing as none), and the notes trimmed (blank as none). */
export const changeBusArgs = (bookingId: string, input: BusInput) => ({
  p_booking: bookingId,
  p_first: input.firstDay || null,
  p_last: input.lastDay || null,
  p_purpose: input.purpose,
  p_ride: input.rideId,
  p_driver: input.driverId,
  p_notes: textOrNull(input.notes),
});

export const handBusKeysArgs = (toId: string | null, note: string) => ({ p_to: toId, p_note: textOrNull(note) });

export const logBusKmArgs = (input: KmInput) => ({
  p_km: input.km, p_on: input.readOn || null, p_booking: input.bookingId, p_note: textOrNull(input.note),
});

export const logBusCostArgs = (input: CostInput) => ({
  p_on: input.spentOn || null,
  p_kind: input.kind,
  p_cents: input.amountCents,
  p_litres: roundLitres(input.litres),
  p_booking: input.bookingId,
  p_note: textOrNull(input.note),
});

export const strikeArgs = (id: string) => ({ p_id: id });
