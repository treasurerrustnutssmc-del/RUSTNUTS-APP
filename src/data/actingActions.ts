// What each acting action does to the demo club, under the same rules as the database's RPCs
// (supabase/migrations/20270870000000_acting_roles.sql §4; the checks live in src/domain/access.ts,
// and src/data/parity.test.ts checks them against the database). Each writer settles first, as each
// RPC runs the lazy close, so it never trips over a stint that lapsed last night, and hands back the
// settled club.

import {
  actingElectors, appointActingProblem, carriedActingVote, confirmActingProblem, requestActingProblem, requestCoverProblem,
  requestNeedsVote, setActingUntilProblem, withdrawRequestProblem,
} from '../domain/access';
import { settleActing } from '../domain/acting';
import type { ActingRequest, ClubData, Member, Position, PositionRole, Vote } from '../domain/types';
import { actingVoteQuestion, openActingVoteProblem } from '../domain/votes';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

// A missing member, row or request goes to the check as undefined, so it refuses in the RPC's
// order and words: signing in first, then "They’re not a member of that chapter.", "That position no
// longer exists." or "That request isn’t open.".
const memberOf = (data: ClubData, id: string): Member | undefined => data.members.find((x) => x.id === id);
const positionOf = (data: ClubData, id: string): Position | undefined => data.positions.find((x) => x.id === id);
const requestOf = (data: ClubData, id: string): ActingRequest | undefined => (data.actingRequests ?? []).find((x) => x.id === id);

/** The new request, left open for a third board member's confirm, or a board vote. */
function openRequest(
  ctx: DemoCtx, data: ClubData, fields: Pick<ActingRequest, 'chapterId' | 'role' | 'memberId' | 'covers' | 'until' | 'why'>,
): ClubData {
  const request: ActingRequest = {
    id: newId('ar'), ...fields, why: fields.why.trim(), requestedBy: ctx.me!.id, createdAt: nowOf(ctx), closedAt: null, outcome: null,
  };
  return { ...data, actingRequests: [...(data.actingRequests ?? []), request] };
}

/** Route 1: a board member records someone acting in an empty seat, from today (public.appoint_acting). */
export function appointActing(
  ctx: DemoCtx, memberId: string, chapterId: string, role: PositionRole, until: string, why: string,
): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  refuse(appointActingProblem(ctx.me, memberOf(data, memberId), chapterId, role, until, why, data, ctx.today));
  const stint: Position = {
    id: newId('p'), memberId, chapterId, role, startedOn: ctx.today, endedOn: null, actingUntil: until, covers: null,
    actingWhy: why.trim(), actingVote: null, actingRequestId: null, appointedBy: ctx.me!.id, endedReason: null,
  };
  return { ...data, positions: [...data.positions, stint] };
}

/** Route 2: the holder asks, from their own board seat, for a cover until a date (public.request_cover). */
export function requestCover(ctx: DemoCtx, positionId: string, memberId: string, until: string, why: string): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  const seat = data.positions.find((p) => p.id === positionId);
  refuse(requestCoverProblem(ctx.me, seat, memberOf(data, memberId), until, why, data, ctx.today));
  return openRequest(ctx, data, { chapterId: seat!.chapterId!, role: seat!.role, memberId, covers: positionId, until, why });
}

/** Route 3: a board member proposes acting that needs a board vote; `coversId` null for an empty seat (public.request_acting). */
export function requestActing(
  ctx: DemoCtx, memberId: string, chapterId: string, role: PositionRole, coversId: string | null, until: string, why: string,
): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  // A covered row nobody can find has ended (SEAT_ENDED), as request_acting finds no held row for it.
  const covers = coversId === null ? null : positionOf(data, coversId) ?? { id: coversId };
  refuse(requestActingProblem(ctx.me, memberOf(data, memberId), chapterId, role, covers, until, why, data, ctx.today));
  return openRequest(ctx, data, { chapterId, role, memberId, covers: coversId, until, why });
}

/** The stand-in, the holder or (before a vote on it) the person who asked closes a request (public.withdraw_acting_request). */
export function withdrawActingRequest(ctx: DemoCtx, requestId: string): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  refuse(withdrawRequestProblem(ctx.me, requestOf(data, requestId), data, ctx.today));
  return {
    ...data,
    actingRequests: data.actingRequests!.map((r) => (r.id === requestId ? { ...r, closedAt: nowOf(ctx), outcome: 'withdrawn' } : r)),
  };
}

/**
 * A board member who is neither the stand-in nor the holder confirms a request: the stint starts
 * today, naming the request and, when it needed one, the carried vote behind it (public.confirm_acting).
 */
export function confirmActing(ctx: DemoCtx, requestId: string): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  const found = requestOf(data, requestId);
  refuse(confirmActingProblem(ctx.me, found, data, ctx.today));
  const request = found!;
  const vote = requestNeedsVote(request, data, ctx.today) ? carriedActingVote(request, data, ctx.today)?.id ?? null : null;
  const stint: Position = {
    id: newId('p'), memberId: request.memberId, chapterId: request.chapterId, role: request.role, startedOn: ctx.today, endedOn: null,
    actingUntil: request.until, covers: request.covers, actingWhy: request.why, actingVote: vote, actingRequestId: request.id,
    appointedBy: ctx.me!.id, endedReason: null,
  };
  return {
    ...data,
    positions: [...data.positions, stint],
    actingRequests: data.actingRequests!.map((r) => (r.id === requestId ? { ...r, closedAt: nowOf(ctx), outcome: 'confirmed' } : r)),
  };
}

/** Moves a stint's last day, keeping its start, and logs the change; the same date changes nothing (public.set_acting_until). */
export function setActingUntil(ctx: DemoCtx, positionId: string, until: string): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  const found = positionOf(data, positionId);
  refuse(setActingUntilProblem(ctx.me, found, until, data, ctx.today));
  const stint = found!;
  if (until === stint.actingUntil) return data;
  return {
    ...data,
    positions: data.positions.map((p) => (p.id === positionId ? { ...p, actingUntil: until } : p)),
    actingChanges: [
      ...(data.actingChanges ?? []),
      {
        id: newId('ac'), positionId, chapterId: stint.chapterId!, oldUntil: stint.actingUntil ?? null, newUntil: until,
        changedBy: ctx.me!.id, changedAt: nowOf(ctx), note: null,
      },
    ],
  };
}

/**
 * Route 3's board vote on a request: a chapter board majority, not secret, about the stand-in in that
 * role, its electors the board without the stand-in, the holder and, for a President or Treasurer
 * seat, the Auditor (public.open_acting_vote).
 */
export function openActingVote(
  ctx: DemoCtx, requestId: string, quorum: number, closesAt: string, meetingId: string | null,
): { data: ClubData; id: string } {
  const data = settleActing(ctx.data, ctx.today);
  const now = nowOf(ctx);
  const request = requestOf(data, requestId);
  refuse(openActingVoteProblem(ctx.me, request, quorum, closesAt, meetingId, data, now));
  const r = request!;
  const vote: Vote = {
    id: newId('v'), chapterId: r.chapterId, meetingId, subjectMemberId: r.memberId, subjectRole: r.role,
    question: actingVoteQuestion(r, data), details: null, electorate: 'chapter_board', threshold: 'majority', secret: false, quorum,
    openedAt: now, closesAt, closedAt: null, result: null, castingVote: null, tally: null,
    electorIds: actingElectors(r.chapterId, r.role, r.memberId, r.covers, data), votedIds: [], ballots: [], createdBy: ctx.me!.id,
    actingRequestId: r.id, electorChapters: {},
  };
  return { data: { ...data, votes: [...(data.votes ?? []), vote] }, id: vote.id };
}

// The shared demo/database cases (supabase/tests/parity.json) ------------------------------------

export const ACTING_ACTIONS = new Set<string>([
  'appointActing', 'requestCover', 'requestActing', 'withdrawActingRequest', 'confirmActing', 'setActingUntil', 'openActingVote',
]);

/** The acting actions as parity.json names them, with their …Days dates resolved. */
export type ActingAction =
  | { action: 'appointActing'; member: string; chapter: string; role: PositionRole; until: string; why: string }
  | { action: 'requestCover'; seat: string; member: string; until: string; why: string }
  | { action: 'requestActing'; member: string; chapter: string; role: PositionRole; covers?: string | null; until: string; why: string }
  | { action: 'withdrawActingRequest'; request: string }
  | { action: 'confirmActing'; request: string }
  | { action: 'setActingUntil'; position: string; until: string }
  /** Closing `days` from now, as the database's case closes it. */
  | { action: 'openActingVote'; request: string; quorum: number; days: number };

export function runActingAction(ctx: DemoCtx, a: ActingAction): ClubData {
  switch (a.action) {
    case 'appointActing':
      return appointActing(ctx, a.member, a.chapter, a.role, a.until, a.why);
    case 'requestCover':
      return requestCover(ctx, a.seat, a.member, a.until, a.why);
    case 'requestActing':
      return requestActing(ctx, a.member, a.chapter, a.role, a.covers ?? null, a.until, a.why);
    case 'withdrawActingRequest':
      return withdrawActingRequest(ctx, a.request);
    case 'confirmActing':
      return confirmActing(ctx, a.request);
    case 'setActingUntil':
      return setActingUntil(ctx, a.position, a.until);
    case 'openActingVote': {
      const closesAt = new Date(Date.parse(nowOf(ctx)) + a.days * 86_400_000).toISOString();
      return openActingVote(ctx, a.request, a.quorum, closesAt, null).data;
    }
  }
}
