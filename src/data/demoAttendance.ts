// Big 4 designations, meeting categories and exemptions in the demo. Like demoStage4, plain functions
// that take the club as it is and hand back the club as it should be, or throw with the same words as
// the database's actions (checked by src/data/parity.test.ts).

import { exemptionProblem, meetingTypeProblem } from '../domain/attendance';
import { designateBig4Problem, undesignateBig4Problem } from '../domain/big4';
import type { ClubData, MeetingType } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();
const deny = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

export function designateBig4(ctx: DemoCtx, rideId: string, chapterId: string | null): ClubData {
  deny(designateBig4Problem(ctx.me, rideId, chapterId, ctx.data, ctx.today));
  const others = (ctx.data.big4Rides ?? []).filter((b) => b.rideId !== rideId);
  return { ...ctx.data, big4Rides: [...others, { rideId, chapterId, designatedBy: ctx.me!.id, designatedAt: nowOf(ctx) }] };
}

export function undesignateBig4(ctx: DemoCtx, rideId: string): ClubData {
  deny(undesignateBig4Problem(ctx.me, rideId, ctx.data, ctx.today));
  return { ...ctx.data, big4Rides: (ctx.data.big4Rides ?? []).filter((b) => b.rideId !== rideId) };
}

export function setMeetingType(ctx: DemoCtx, sessionId: string, type: MeetingType): ClubData {
  deny(meetingTypeProblem(ctx.me, sessionId, type, ctx.data, ctx.today));
  return {
    ...ctx.data,
    checkinSessions: (ctx.data.checkinSessions ?? []).map((s) => (s.id === sessionId ? { ...s, meetingType: type } : s)),
  };
}

/** A reason excuses them; none (or blank) clears it. */
export function setExemption(ctx: DemoCtx, sessionId: string, memberId: string, reason: string | null): ClubData {
  deny(exemptionProblem(ctx.me, sessionId, memberId, reason, ctx.data));
  const why = reason?.trim().slice(0, 200) || null;
  const others = (ctx.data.exemptions ?? []).filter((e) => !(e.sessionId === sessionId && e.memberId === memberId));
  if (!why) return { ...ctx.data, exemptions: others };
  return { ...ctx.data, exemptions: [...others, { sessionId, memberId, reason: why, grantedBy: ctx.me!.id, grantedAt: nowOf(ctx) }] };
}
