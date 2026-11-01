// What each charity ride sign-up action does to the demo club, under the same rules as the
// database (src/domain/charity.ts; checked by src/data/parity.test.ts). Kept beside demoActions.ts,
// which calls into these for the parity cases.

import {
  cleanJob, cleanJobs, saveCharityProblem, signupProblem, withdrawCharityProblem, type CharityInput, type SignupInput,
} from '../domain/charity';
import { removeWebsiteSignupProblem } from '../domain/websiteSignups';
import type { ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

/** Makes a ride a charity ride, or changes its sign-ups. Mirrors public.save_charity. */
export function saveCharity(ctx: DemoCtx, rideId: string, input: CharityInput): ClubData {
  const now = nowOf(ctx);
  refuse(saveCharityProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), input, ctx.data, now));
  const others = (ctx.data.charityRides ?? []).filter((c) => c.rideId !== rideId);
  return {
    ...ctx.data,
    charityRides: [...others, {
      rideId, cause: input.cause.trim(), about: input.about.trim(), closesOn: input.closesOn, places: input.places,
      jobs: cleanJobs(input.jobs), website: input.website ?? false, updatedBy: ctx.me!.id, updatedAt: now,
    }],
  };
}

/** Removes a sign-up that came from the club website (the ride's organisers). Mirrors public.remove_website_signup. */
export function removeWebsiteSignup(ctx: DemoCtx, id: string): ClubData {
  refuse(removeWebsiteSignupProblem(ctx.me, (ctx.data.websiteSignups ?? []).find((w) => w.id === id), ctx.data, nowOf(ctx)));
  return { ...ctx.data, websiteSignups: (ctx.data.websiteSignups ?? []).filter((w) => w.id !== id) };
}

/** Signs you up, changes your sign-up, or brings back a withdrawn one. Mirrors public.sign_up_charity. */
export function signUpCharity(ctx: DemoCtx, rideId: string, input: SignupInput): ClubData {
  const now = nowOf(ctx);
  refuse(signupProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), input, ctx.data, now, ctx.today));
  const me = ctx.me!.id;
  const others = (ctx.data.charitySignups ?? []).filter((s) => !(s.rideId === rideId && s.memberId === me));
  return {
    ...ctx.data,
    charitySignups: [...others, {
      rideId, memberId: me, riding: input.riding, pillion: input.pillion, guests: input.guests, guestNames: input.guestNames.trim(),
      job: cleanJob(input.job), notes: input.notes.trim(), signedAt: now, withdrawnAt: null,
    }],
  };
}

/** Withdraws your sign-up, keeping its row. Mirrors public.withdraw_charity. */
export function withdrawCharity(ctx: DemoCtx, rideId: string): ClubData {
  const now = nowOf(ctx);
  refuse(withdrawCharityProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), ctx.data, now));
  const me = ctx.me!.id;
  return {
    ...ctx.data,
    charitySignups: (ctx.data.charitySignups ?? []).map((s) => (s.rideId === rideId && s.memberId === me ? { ...s, withdrawnAt: now } : s)),
  };
}
