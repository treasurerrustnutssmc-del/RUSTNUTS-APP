// What each ride planning extras action does to the demo club, under the same rules as the
// database (src/domain/fuel.ts, ridePlan.ts, ratings.ts, rideCalls.ts, hubs.ts, swaps.ts; checked by
// src/data/parity.test.ts). Kept beside demoActions.ts, which calls into these for the parity cases.

import { rangeProblem } from '../domain/fuel';
import { registerProblem, saveHubProblem, withdrawHubProblem, type HubInput, type RegisterInput } from '../domain/hubs';
import { rateProblem } from '../domain/ratings';
import { callProblem } from '../domain/rideCalls';
import { cleanStops, savePlanProblem } from '../domain/ridePlan';
import { answerSwapProblem, askSwapProblem, withdrawSwapProblem } from '../domain/swaps';
import type { ClubData, CrewSwap, PlanStop, RideCallState } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

/** Sets (or with null clears) the range of one of your own bikes. Mirrors public.set_bike_range. */
export function setBikeRange(ctx: DemoCtx, bikeId: string, rangeKm: number | null): ClubData {
  refuse(rangeProblem(ctx.me, ctx.data.bikes.find((b) => b.id === bikeId), rangeKm));
  return { ...ctx.data, bikes: ctx.data.bikes.map((b) => (b.id === bikeId ? { ...b, rangeKm } : b)) };
}

/** Writes or replaces a ride's plan, trimmed and in km order. Mirrors public.save_ride_plan. */
export function saveRidePlan(ctx: DemoCtx, rideId: string, stops: PlanStop[], seen: string | null): ClubData {
  const now = nowOf(ctx);
  refuse(savePlanProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), stops, seen, ctx.data, now));
  const others = (ctx.data.ridePlans ?? []).filter((p) => p.rideId !== rideId);
  return { ...ctx.data, ridePlans: [...others, { rideId, stops: cleanStops(stops), updatedAt: now, updatedBy: ctx.me!.id }] };
}

/** Rates a route, or changes your rating. Mirrors public.rate_route. */
export function rateRoute(ctx: DemoCtx, routeId: string, stars: number, comment: string): ClubData {
  refuse(rateProblem(ctx.me, (ctx.data.routes ?? []).find((r) => r.id === routeId), stars, comment));
  const me = ctx.me!.id;
  const others = (ctx.data.routeRatings ?? []).filter((r) => !(r.routeId === routeId && r.memberId === me));
  return { ...ctx.data, routeRatings: [...others, { routeId, memberId: me, stars, comment: comment.trim(), ratedAt: nowOf(ctx) }] };
}

/** Calls a ride Off, Postponed or Back on. Mirrors public.call_ride (the demo has no ride chat line). */
export function callRide(ctx: DemoCtx, rideId: string, state: RideCallState, reason: string, newDay: string | null): ClubData {
  const now = nowOf(ctx);
  refuse(callProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), state, reason, newDay, ctx.data, now));
  const others = (ctx.data.rideCalls ?? []).filter((c) => c.rideId !== rideId);
  return {
    ...ctx.data,
    rideCalls: [...others, { rideId, state, reason: state === 'on' ? '' : reason.trim(), newDay: state === 'on' ? null : newDay, calledBy: ctx.me!.id, calledAt: now }],
  };
}

/** Opens a ride's hub, or changes it. Mirrors public.save_hub. */
export function saveHub(ctx: DemoCtx, rideId: string, input: HubInput): ClubData {
  const now = nowOf(ctx);
  refuse(saveHubProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), input, ctx.data, now));
  const others = (ctx.data.rideHubs ?? []).filter((h) => h.rideId !== rideId);
  return {
    ...ctx.data,
    rideHubs: [...others, {
      rideId, membersOnly: input.membersOnly, closesOn: input.closesOn, beds: input.beds,
      accommodation: input.accommodation.trim(), notes: input.notes.trim(), updatedBy: ctx.me!.id, updatedAt: now,
    }],
  };
}

/** Registers you, changes your registration, or brings back a withdrawn one. Mirrors public.register_hub. */
export function registerHub(ctx: DemoCtx, rideId: string, input: RegisterInput): ClubData {
  const now = nowOf(ctx);
  refuse(registerProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), input, ctx.data, now, ctx.today));
  const me = ctx.me!.id;
  const others = (ctx.data.hubRegistrations ?? []).filter((r) => !(r.rideId === rideId && r.memberId === me));
  return {
    ...ctx.data,
    hubRegistrations: [...others, {
      rideId, memberId: me, staying: input.staying, pillion: input.pillion, shareWith: input.shareWith.trim(), notes: input.notes.trim(),
      registeredAt: now, withdrawnAt: null,
    }],
  };
}

/** Withdraws your registration, keeping its row. Mirrors public.withdraw_hub. */
export function withdrawHub(ctx: DemoCtx, rideId: string): ClubData {
  const now = nowOf(ctx);
  refuse(withdrawHubProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), ctx.data, now));
  const me = ctx.me!.id;
  return {
    ...ctx.data,
    hubRegistrations: (ctx.data.hubRegistrations ?? []).map((r) => (r.rideId === rideId && r.memberId === me ? { ...r, withdrawnAt: now } : r)),
  };
}

const withSwap = (data: ClubData, id: string, change: (s: CrewSwap) => CrewSwap): ClubData => ({
  ...data,
  crewSwaps: (data.crewSwaps ?? []).map((s) => (s.id === id ? change(s) : s)),
});

/** Asks someone to take your spot (or trade); returns the ask's id. Mirrors public.ask_swap. */
export function askSwap(ctx: DemoCtx, rideId: string, toId: string, note: string): { data: ClubData; id: string } {
  const now = nowOf(ctx);
  refuse(askSwapProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), toId, note, ctx.data, now));
  const me = ctx.me!.id;
  const spot = (memberId: string) => (ctx.data.crew ?? []).find((s) => s.rideId === rideId && s.memberId === memberId)?.role ?? null;
  const swap: CrewSwap = {
    id: newId('swap'), rideId, askedBy: me, role: spot(me)!, askedTo: toId, theirRole: spot(toId), note: note.trim(),
    state: 'asked', askedAt: now, answeredAt: null,
  };
  return { data: { ...ctx.data, crewSwaps: [...(ctx.data.crewSwaps ?? []), swap] }, id: swap.id };
}

/** Says yes (moving the spots and making you Going) or no. Mirrors public.answer_swap. */
export function answerSwap(ctx: DemoCtx, swapId: string, yes: boolean): ClubData {
  const now = nowOf(ctx);
  const swap = (ctx.data.crewSwaps ?? []).find((s) => s.id === swapId);
  refuse(answerSwapProblem(ctx.me, swap, yes, ctx.data, now));
  const s = swap!;
  const answered = withSwap(ctx.data, swapId, (x) => ({ ...x, state: yes ? 'accepted' : 'declined', answeredAt: now }));
  if (!yes) return answered;
  const me = ctx.me!.id;
  const crew = (ctx.data.crew ?? []).map((c) => {
    if (c.rideId !== s.rideId) return c;
    if (c.memberId === s.askedBy) {
      return s.theirRole ? { ...c, role: s.theirRole, assignedBy: me, assignedAt: now } : { ...c, memberId: me, assignedBy: me, assignedAt: now };
    }
    if (c.memberId === me && s.theirRole) return { ...c, role: s.role, assignedBy: me, assignedAt: now };
    return c;
  });
  const rsvps = ctx.data.rsvps.filter((r) => !(r.rideId === s.rideId && r.memberId === me));
  return { ...answered, crew, rsvps: [...rsvps, { rideId: s.rideId, memberId: me, answer: 'going', updatedAt: now }] };
}

/** Takes back your own open ask. Mirrors public.withdraw_swap. */
export function withdrawSwap(ctx: DemoCtx, swapId: string): ClubData {
  refuse(withdrawSwapProblem(ctx.me, (ctx.data.crewSwaps ?? []).find((s) => s.id === swapId)));
  return withSwap(ctx.data, swapId, (s) => ({ ...s, state: 'withdrawn', answeredAt: nowOf(ctx) }));
}
