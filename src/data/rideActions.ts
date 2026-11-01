// What making, changing and calling off a ride does to the demo club, under the same rules as the
// database (src/domain/newRide.ts; checked by src/data/parity.test.ts). Kept beside demoActions.ts,
// which calls into these for the parity cases.

import { callOffProblem, cleanRideInput, putBackProblem, RIDE_GONE, saveRideProblem, type RideInput } from '../domain/newRide';
import { signedInProblem } from '../domain/routes';
import type { ClubData, Ride } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();
let counter = 0;
const newId = () => `r-app-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

/** Makes a ride (no id) or changes a ride made in the app. Mirrors public.save_ride. */
export function saveRide(ctx: DemoCtx, raw: RideInput, id?: string): { data: ClubData; id: string } {
  const now = nowOf(ctx);
  const existing = id === undefined ? undefined : ctx.data.rides.find((r) => r.id === id);
  refuse(signedInProblem(ctx.me));
  if (id !== undefined && !existing) throw new NotAllowedError(RIDE_GONE);
  refuse(saveRideProblem(ctx.me, existing, raw, ctx.data, now));
  const input = cleanRideInput(raw);
  const fields = {
    title: input.title, startsAt: new Date(input.startsAt).toISOString(),
    endsAt: input.endsAt ? new Date(input.endsAt).toISOString() : null, allDay: input.allDay,
    location: input.location, notes: input.notes === '' ? null : input.notes, category: input.category, website: input.website,
  };
  if (existing) {
    return { data: { ...ctx.data, rides: ctx.data.rides.map((r) => (r.id === existing.id ? { ...r, ...fields } : r)) }, id: existing.id };
  }
  const ride: Ride = { id: newId(), ...fields, cancelledAt: null, source: 'app' };
  return { data: { ...ctx.data, rides: [...ctx.data.rides, ride] }, id: ride.id };
}

/** Calls an app ride off (off true) or puts it back on. Mirrors public.set_ride_called_off. */
export function setRideCalledOff(ctx: DemoCtx, id: string, off: boolean): ClubData {
  const now = nowOf(ctx);
  const ride = ctx.data.rides.find((r) => r.id === id);
  refuse(off ? callOffProblem(ctx.me, ride, ctx.data, now) : putBackProblem(ctx.me, ride, ctx.data, now));
  return { ...ctx.data, rides: ctx.data.rides.map((r) => (r.id === id ? { ...r, cancelledAt: off ? now : null } : r)) };
}
