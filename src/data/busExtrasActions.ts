// What each Rusty Bus extras action does to the demo club, under the same rules as the database
// (src/domain/bus.ts's changeProblem and src/domain/busLog.ts; checked by src/data/parity.test.ts).
// Kept beside demoActions.ts, which has the booking, yes or no, and cancelling.

import { changeProblem, type BusInput } from '../domain/bus';
import {
  handKeysProblem, logCostProblem, logKmProblem, roundLitres, strikeCostProblem, strikeKmProblem, type CostInput, type KmInput,
} from '../domain/busLog';
import type { BusCostKind, BusPurpose, ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

/** Changes a booking's days and details, keeping its status. Mirrors public.change_bus. */
export function changeBus(ctx: DemoCtx, bookingId: string, input: BusInput): ClubData {
  const booking = (ctx.data.busBookings ?? []).find((b) => b.id === bookingId);
  refuse(changeProblem(ctx.me, booking, input, ctx.data, ctx.today));
  const changed = {
    firstDay: input.firstDay, lastDay: input.lastDay, purpose: input.purpose!, rideId: input.rideId, driverId: input.driverId,
    notes: input.notes.trim(), changedBy: ctx.me!.id, changedAt: nowOf(ctx),
  };
  return { ...ctx.data, busBookings: (ctx.data.busBookings ?? []).map((b) => (b.id === bookingId ? { ...b, ...changed } : b)) };
}

/** Logs the keys passing to someone, returning the handover's id. Mirrors public.hand_bus_keys. */
export function handBusKeys(ctx: DemoCtx, toId: string | null, note: string): { data: ClubData; id: string } {
  refuse(handKeysProblem(ctx.me, toId, note, ctx.data));
  const handover = { id: newId('keys'), toId, note: note.trim(), loggedBy: ctx.me!.id, loggedAt: nowOf(ctx) };
  return { data: { ...ctx.data, busKeys: [...(ctx.data.busKeys ?? []), handover] }, id: handover.id };
}

/** Logs an odometer reading. Mirrors public.log_bus_km. */
export function logBusKm(ctx: DemoCtx, input: KmInput): { data: ClubData; id: string } {
  refuse(logKmProblem(ctx.me, input, ctx.data, ctx.today));
  const reading = {
    id: newId('km'), km: input.km, readOn: input.readOn, bookingId: input.bookingId, note: input.note.trim(),
    loggedBy: ctx.me!.id, loggedAt: nowOf(ctx), struckBy: null, struckAt: null,
  };
  return { data: { ...ctx.data, busKm: [...(ctx.data.busKm ?? []), reading] }, id: reading.id };
}

/** Logs a running cost, litres to two decimals. Mirrors public.log_bus_cost. */
export function logBusCost(ctx: DemoCtx, input: CostInput): { data: ClubData; id: string } {
  const clean = { ...input, litres: roundLitres(input.litres) };
  refuse(logCostProblem(ctx.me, clean, ctx.data, ctx.today));
  const cost = {
    id: newId('cost'), spentOn: clean.spentOn, kind: clean.kind!, amountCents: clean.amountCents, litres: clean.litres,
    bookingId: clean.bookingId, note: clean.note.trim(), loggedBy: ctx.me!.id, loggedAt: nowOf(ctx), struckBy: null, struckAt: null,
  };
  return { data: { ...ctx.data, busCosts: [...(ctx.data.busCosts ?? []), cost] }, id: cost.id };
}

/** Strikes out a reading logged by mistake. Mirrors public.strike_bus_km. */
export function strikeBusKm(ctx: DemoCtx, id: string): ClubData {
  refuse(strikeKmProblem(ctx.me, (ctx.data.busKm ?? []).find((r) => r.id === id), ctx.data));
  const struck = { struckBy: ctx.me!.id, struckAt: nowOf(ctx) };
  return { ...ctx.data, busKm: (ctx.data.busKm ?? []).map((r) => (r.id === id ? { ...r, ...struck } : r)) };
}

/** Strikes out a cost logged by mistake. Mirrors public.strike_bus_cost. */
export function strikeBusCost(ctx: DemoCtx, id: string): ClubData {
  refuse(strikeCostProblem(ctx.me, (ctx.data.busCosts ?? []).find((c) => c.id === id), ctx.data));
  const struck = { struckBy: ctx.me!.id, struckAt: nowOf(ctx) };
  return { ...ctx.data, busCosts: (ctx.data.busCosts ?? []).map((c) => (c.id === id ? { ...c, ...struck } : c)) };
}

/** The actions the shared parity cases use. Days are ISO dates (cases give them as `…Days` from today). */
export type BusExtrasAction =
  | {
      action: 'changeBus'; booking: string; first: string | null; last: string | null; purpose: BusPurpose | null; ride: string | null;
      driver: string | null; notes: string; repeat?: number;
    }
  | { action: 'handBusKeys'; to: string | null; note: string; repeat?: number }
  | { action: 'logBusKm'; km: number; on: string | null; booking: string | null; note: string }
  | { action: 'logBusCost'; on: string | null; kind: BusCostKind | null; cents: number; litres: number | null; booking: string | null; note: string }
  | { action: 'strikeBusKm'; entry: string }
  | { action: 'strikeBusCost'; entry: string };

export const BUS_EXTRAS_ACTIONS = new Set(['changeBus', 'handBusKeys', 'logBusKm', 'logBusCost', 'strikeBusKm', 'strikeBusCost']);

export function runBusExtrasAction(ctx: DemoCtx, a: BusExtrasAction): ClubData {
  switch (a.action) {
    case 'changeBus':
      return changeBus(ctx, a.booking, {
        firstDay: a.first ?? '', lastDay: a.last ?? '', purpose: a.purpose, rideId: a.ride, driverId: a.driver,
        notes: a.notes.repeat(a.repeat ?? 1),
      });
    case 'handBusKeys':
      return handBusKeys(ctx, a.to, a.note.repeat(a.repeat ?? 1)).data;
    case 'logBusKm':
      return logBusKm(ctx, { km: a.km, readOn: a.on ?? '', bookingId: a.booking, note: a.note }).data;
    case 'logBusCost':
      return logBusCost(ctx, { spentOn: a.on ?? '', kind: a.kind, amountCents: a.cents, litres: a.litres, bookingId: a.booking, note: a.note }).data;
    case 'strikeBusKm':
      return strikeBusKm(ctx, a.entry);
    case 'strikeBusCost':
      return strikeBusCost(ctx, a.entry);
  }
}
