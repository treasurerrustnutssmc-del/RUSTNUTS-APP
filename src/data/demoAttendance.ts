// Big 4 designations, meeting categories and exemptions in the demo. Like demoStage4, plain functions
// that take the club as it is and hand back the club as it should be, or throw with the same words as
// the database's actions (checked by src/data/parity.test.ts).

import { exemptionProblem, meetingTypeProblem } from '../domain/attendance';
import { big4WaiverProblem, designateBig4Problem, undesignateBig4Problem } from '../domain/big4';
import { closeNoticeProblem, giveNoticeProblem, respondProblem, type NoticeInput } from '../domain/notices';
import type { Big4Ground, ClubData, MeetingType, NoticeAbout, NoticeOutcome } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();
let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
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

// Big 4 RSVP rules and the 5.5 notice -------------------------------------------------------------

/** A ground excuses them from 5.4 for this Big 4; null clears it. */
export function setBig4Waiver(ctx: DemoCtx, rideId: string, memberId: string, ground: Big4Ground | null): ClubData {
  deny(big4WaiverProblem(ctx.me, rideId, memberId, ground, ctx.data, nowOf(ctx)));
  const others = (ctx.data.big4Waivers ?? []).filter((w) => !(w.rideId === rideId && w.memberId === memberId));
  if (ground === null) return { ...ctx.data, big4Waivers: others };
  return { ...ctx.data, big4Waivers: [...others, { rideId, memberId, ground, grantedBy: ctx.me!.id, grantedAt: nowOf(ctx) }] };
}

export function giveStatusNotice(ctx: DemoCtx, memberId: string, input: NoticeInput): { data: ClubData; id: string } {
  deny(giveNoticeProblem(ctx.me, memberId, input, ctx.data, ctx.today));
  const target = ctx.data.members.find((m) => m.id === memberId)!;
  const id = newId('sn');
  const notice = {
    id, memberId, chapterId: target.chapterId, about: input.about as NoticeAbout, record: input.record.trim(), proposal: input.proposal.trim(),
    givenOn: ctx.today, respondBy: input.respondBy, givenBy: ctx.me!.id, response: '', respondedAt: null,
    outcome: null, outcomeNote: '', closedOn: null, closedBy: null,
  };
  return { data: { ...ctx.data, statusNotices: [...(ctx.data.statusNotices ?? []), notice] }, id };
}

export function respondToNotice(ctx: DemoCtx, noticeId: string, response: string): ClubData {
  deny(respondProblem(ctx.me, noticeId, response, ctx.data));
  return {
    ...ctx.data,
    statusNotices: (ctx.data.statusNotices ?? []).map((n) => (n.id === noticeId ? { ...n, response: response.trim(), respondedAt: nowOf(ctx) } : n)),
  };
}

export function closeStatusNotice(ctx: DemoCtx, noticeId: string, outcome: NoticeOutcome, note: string): ClubData {
  deny(closeNoticeProblem(ctx.me, noticeId, outcome, note, ctx.data, ctx.today));
  return {
    ...ctx.data,
    statusNotices: (ctx.data.statusNotices ?? []).map((n) =>
      n.id === noticeId ? { ...n, outcome, outcomeNote: note.trim(), closedOn: ctx.today, closedBy: ctx.me!.id } : n,
    ),
  };
}
