// Rusty Bus extras: who has the keys, the odometer, and what the bus costs to run. These are the
// rules the database's hand_bus_keys, log_bus_km, log_bus_cost, strike_bus_km and strike_bus_cost
// actions apply, in the same order with the same words. Nothing is ever deleted: a mistake is
// struck out, stays on the list, and counts for nothing.

import { canBookBus, isIsoDate, managesBus } from './bus';
import { charCount } from './chat';
import { fyOf } from './fees';
import { signedInProblem } from './routes';
import type { BusCost, BusCostKind, BusKeyHandover, BusKm, ClubData, Member } from './types';

/** The longest a note can be, in characters (code points). */
export const MAX_LOG_NOTE = 200;
/** The highest odometer reading taken, in km. */
export const MAX_KM = 2_000_000;
/** The most one cost can be, in cents ($100,000). */
export const MAX_COST_CENTS = 10_000_000;
/** The most litres one fill can be. */
export const MAX_LITRES = 1000;
/** How many handovers the keys screen lists. */
export const KEY_HISTORY = 20;

export const NOT_BUS_HAND = 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
export const KEYS_BAD_MEMBER = 'Pick someone who’s an approved member.';
export const ALREADY_HAS_KEYS = 'They already have the keys.';
export const LOG_NOTE_TOO_LONG = 'Keep the note to 200 characters at most.';
export const LOG_BAD_DAY = 'Pick the day, today or earlier.';
export const BAD_KM = 'The odometer is in whole km, up to 2,000,000.';
export const KM_OUT_OF_ORDER = 'That reading is out of order with the ones before and after it.';
export const LOG_NOT_BOOKED = 'Pick a Booked booking.';
export const NO_COST_KIND = 'Pick what it was for.';
export const BAD_AMOUNT = 'Enter an amount from $0.01 to $100,000.';
export const LITRES_NOT_FUEL = 'Only fuel takes litres.';
export const BAD_LITRES = 'Litres: more than 0, up to 1000.';
export const NO_ENTRY = 'No such entry.';
export const NOT_STRIKER = 'Only whoever logged it or the board can strike it out.';
export const ALREADY_STRUCK = 'That’s already struck out.';

/** An odometer reading as typed. */
export interface KmInput {
  km: number;
  /** ISO date, or '' when missing. */
  readOn: string;
  bookingId: string | null;
  note: string;
}

/** A running cost as typed. */
export interface CostInput {
  /** ISO date, or '' when missing. */
  spentOn: string;
  kind: BusCostKind | null;
  amountCents: number;
  litres: number | null;
  bookingId: string | null;
  note: string;
}

/** The kinds, in the order the form's chips show them. */
export const BUS_COST_KINDS: readonly BusCostKind[] = ['fuel', 'service', 'repairs', 'tyres', 'rego', 'insurance', 'tolls', 'cleaning', 'other'];

const KIND_LABELS: Record<BusCostKind, string> = {
  fuel: 'Fuel',
  service: 'Service',
  repairs: 'Repairs',
  tyres: 'Tyres',
  rego: 'Rego',
  insurance: 'Insurance',
  tolls: 'Tolls',
  cleaning: 'Cleaning',
  other: 'Other',
};

export const busCostKindLabel = (kind: BusCostKind): string => KIND_LABELS[kind];

/** Orders ISO dates and timestamps (they sort as plain strings), with no locale involved. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isStruck = (e: { struckAt: string | null }): boolean => e.struckAt !== null;

/** Handovers, newest first. */
export function keyHistory(data: ClubData): BusKeyHandover[] {
  return [...(data.busKeys ?? [])].sort((a, b) => cmp(b.loggedAt, a.loggedAt) || cmp(b.id, a.id));
}

/** The newest handover, naming who has the keys now, or undefined before the first is logged. */
export const keyHolder = (data: ClubData): BusKeyHandover | undefined => keyHistory(data)[0];

/**
 * Who can log keys, km and costs: anyone who can book the bus (Full, Nomad, bus managers), and
 * whoever has the keys right now. Mirrors private.bus_hand.
 */
export function isBusHand(me: Member | null, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return canBookBus(me, data) || keyHolder(data)?.toId === me.id;
}

const noteProblem = (note: string): string | null => (charCount(note.trim()) > MAX_LOG_NOTE ? LOG_NOTE_TOO_LONG : null);
const dayProblem = (day: string, today: string): string | null => (!isIsoDate(day) || day > today ? LOG_BAD_DAY : null);
const bookingProblem = (bookingId: string | null, data: ClubData): string | null =>
  bookingId === null || (data.busBookings ?? []).some((b) => b.id === bookingId && b.status === 'approved') ? null : LOG_NOT_BOOKED;

/** Why `me` can't log the keys passing to `toId`, or null. Mirrors public.hand_bus_keys. */
export function handKeysProblem(me: Member | null, toId: string | null, note: string, data: ClubData): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!isBusHand(me, data)) return NOT_BUS_HAND;
  const to = toId === null ? undefined : data.members.find((m) => m.id === toId);
  if (!to || to.approval !== 'approved') return KEYS_BAD_MEMBER;
  if (keyHolder(data)?.toId === toId) return ALREADY_HAS_KEYS;
  return noteProblem(note);
}

/** Readings that count: not struck out. */
const liveReadings = (data: ClubData): BusKm[] => (data.busKm ?? []).filter((r) => !isStruck(r));

/** Why `me` can't log this odometer reading, or null. Mirrors public.log_bus_km. */
export function logKmProblem(me: Member | null, input: KmInput, data: ClubData, today: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!isBusHand(me, data)) return NOT_BUS_HAND;
  const day = dayProblem(input.readOn, today);
  if (day) return day;
  if (!Number.isInteger(input.km) || input.km < 1 || input.km > MAX_KM) return BAD_KM;
  // Never lower than a reading on that day or before, nor higher than one on a later day.
  const outOfOrder = liveReadings(data).some((r) => (r.readOn <= input.readOn ? r.km > input.km : r.km < input.km));
  if (outOfOrder) return KM_OUT_OF_ORDER;
  return bookingProblem(input.bookingId, data) ?? noteProblem(input.note);
}

/** Litres to two decimals, as the database stores them. */
export const roundLitres = (litres: number | null): number | null => (litres === null ? null : Math.round(litres * 100) / 100);

/** Why `me` can't log this running cost, or null. Mirrors public.log_bus_cost (litres already rounded). */
export function logCostProblem(me: Member | null, input: CostInput, data: ClubData, today: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!isBusHand(me, data)) return NOT_BUS_HAND;
  const day = dayProblem(input.spentOn, today);
  if (day) return day;
  if (!input.kind) return NO_COST_KIND;
  const cents = input.amountCents;
  if (!Number.isInteger(cents) || cents < 1 || cents > MAX_COST_CENTS) return BAD_AMOUNT;
  if (input.litres !== null) {
    if (input.kind !== 'fuel') return LITRES_NOT_FUEL;
    if (!(input.litres > 0 && input.litres <= MAX_LITRES)) return BAD_LITRES;
  }
  return bookingProblem(input.bookingId, data) ?? noteProblem(input.note);
}

/** Why `me` can't strike out this entry, or null. Mirrors public.strike_bus_km and strike_bus_cost. */
function strikeProblem(me: Member | null, entry: BusKm | BusCost | undefined, data: ClubData): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!entry) return NO_ENTRY;
  if (entry.loggedBy !== me!.id && !managesBus(me, data)) return NOT_STRIKER;
  if (isStruck(entry)) return ALREADY_STRUCK;
  return null;
}

export const strikeKmProblem = (me: Member | null, entry: BusKm | undefined, data: ClubData) => strikeProblem(me, entry, data);
export const strikeCostProblem = (me: Member | null, entry: BusCost | undefined, data: ClubData) => strikeProblem(me, entry, data);

/** Readings newest first: by day, then km, then when logged. Struck ones stay on the list. */
export function kmHistory(data: ClubData): BusKm[] {
  return [...(data.busKm ?? [])].sort((a, b) => cmp(b.readOn, a.readOn) || b.km - a.km || cmp(b.loggedAt, a.loggedAt));
}

/** The latest reading that counts, or undefined. */
export const latestReading = (data: ClubData): BusKm | undefined => kmHistory(data).find((r) => !isStruck(r));

/** Km run on a booking: its highest reading less its lowest, once it has two. */
export function bookingKm(bookingId: string, data: ClubData): number | null {
  const kms = liveReadings(data).filter((r) => r.bookingId === bookingId).map((r) => r.km);
  return kms.length < 2 ? null : Math.max(...kms) - Math.min(...kms);
}

/**
 * The costs `me` may see: all of them for a bus manager, otherwise their own. The database's
 * row-level security already does this in live; the demo holds every cost, so the screens use it.
 */
export function visibleCosts(me: Member | null, data: ClubData): BusCost[] {
  if (!me || me.approval !== 'approved') return [];
  const all = data.busCosts ?? [];
  return managesBus(me, data) ? all : all.filter((c) => c.loggedBy === me.id);
}

/** Costs newest first: by day, then when logged. */
export const costHistory = (costs: BusCost[]): BusCost[] =>
  [...costs].sort((a, b) => cmp(b.spentOn, a.spentOn) || cmp(b.loggedAt, a.loggedAt));

/** The financial years to offer, newest first: this one, plus every year with a cost. */
export function costYears(data: ClubData, today: string): number[] {
  const years = new Set([fyOf(today), ...(data.busCosts ?? []).map((c) => fyOf(c.spentOn))]);
  return [...years].sort((a, b) => b - a);
}

export interface BusYear {
  totalCents: number;
  /** Each kind spent on, largest first (then in the chips' order). */
  byKind: { kind: BusCostKind; cents: number }[];
  litres: number;
  /** How many costs count. */
  count: number;
  /** Null when there's no reading in the year. */
  kmRun: number | null;
  /** Rounded to the cent; null without km run or spending. */
  centsPerKm: number | null;
}

/**
 * A financial year (July to June) of `costs`: totals by kind, litres of fuel, km run (the year's
 * last reading less the last one before the year, or less the year's first when there's none
 * before) and cost per km. Struck-out entries count for nothing.
 */
export function yearSummary(data: ClubData, fy: number, costs: BusCost[] = data.busCosts ?? []): BusYear {
  const inYear = costs.filter((c) => !isStruck(c) && fyOf(c.spentOn) === fy);
  const byKind = BUS_COST_KINDS.map((kind) => ({ kind, cents: inYear.filter((c) => c.kind === kind).reduce((n, c) => n + c.amountCents, 0) }))
    .filter((k) => k.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const totalCents = inYear.reduce((n, c) => n + c.amountCents, 0);
  // Summed in hundredths so 50 + 55.5 is exactly 105.5.
  const litres = inYear.reduce((n, c) => n + Math.round((c.litres ?? 0) * 100), 0) / 100;
  const start = `${fy}-07-01`;
  const readings = liveReadings(data);
  const yearKms = readings.filter((r) => fyOf(r.readOn) === fy).map((r) => r.km);
  const beforeKms = readings.filter((r) => r.readOn < start).map((r) => r.km);
  const kmRun = yearKms.length === 0 ? null : Math.max(...yearKms) - (beforeKms.length ? Math.max(...beforeKms) : Math.min(...yearKms));
  const centsPerKm = kmRun && totalCents > 0 ? Math.round(totalCents / kmRun) : null;
  return { totalCents, byKind, litres, count: inYear.length, kmRun, centsPerKm };
}

/** "123,456 km". */
export const formatKm = (km: number): string => `${km.toLocaleString('en-AU')} km`;
