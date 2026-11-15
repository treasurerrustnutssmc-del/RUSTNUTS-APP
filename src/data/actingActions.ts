// What each acting action does to the demo club, under the same rules as the database's RPCs
// (supabase/migrations/20270870000000_acting_roles.sql §4; the checks live in src/domain/access.ts,
// and src/data/parity.test.ts checks them against the database). Each writer settles first, as each
// RPC runs the lazy close, so it never trips over a stint that lapsed last night, and hands back the
// settled club.

import {
  appointActingProblem, carriedActingVote, confirmActingProblem, NO_REQUEST, requestActingProblem, requestCoverProblem,
  requestNeedsVote, setActingUntilProblem, withdrawRequestProblem,
} from '../domain/access';
import { settleActing } from '../domain/acting';
import type { ActingRequest, ClubData, Member, Position, PositionRole } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

function findMember(data: ClubData, id: string): Member {
  const m = data.members.find((x) => x.id === id);
  if (!m) throw new Error('That member no longer exists.');
  return m;
}

function findPosition(data: ClubData, id: string): Position {
  const p = data.positions.find((x) => x.id === id);
  if (!p) throw new Error('That position no longer exists.');
  return p;
}

/** A request, settled as it stands now; a missing one isn't open. */
function findRequest(data: ClubData, id: string): ActingRequest {
  const r = (data.actingRequests ?? []).find((x) => x.id === id);
  if (!r) throw new NotAllowedError(NO_REQUEST);
  return r;
}

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
  refuse(appointActingProblem(ctx.me, findMember(data, memberId), chapterId, role, until, why, data, ctx.today));
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
  refuse(requestCoverProblem(ctx.me, seat, findMember(data, memberId), until, why, data, ctx.today));
  return openRequest(ctx, data, { chapterId: seat!.chapterId!, role: seat!.role, memberId, covers: positionId, until, why });
}

/** Route 3: a board member proposes acting that needs a board vote; `coversId` null for an empty seat (public.request_acting). */
export function requestActing(
  ctx: DemoCtx, memberId: string, chapterId: string, role: PositionRole, coversId: string | null, until: string, why: string,
): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  const covers = coversId === null ? null : findPosition(data, coversId);
  refuse(requestActingProblem(ctx.me, findMember(data, memberId), chapterId, role, covers, until, why, data, ctx.today));
  return openRequest(ctx, data, { chapterId, role, memberId, covers: coversId, until, why });
}

/** The stand-in, the holder or (before a vote on it) the person who asked closes a request (public.withdraw_acting_request). */
export function withdrawActingRequest(ctx: DemoCtx, requestId: string): ClubData {
  const data = settleActing(ctx.data, ctx.today);
  refuse(withdrawRequestProblem(ctx.me, findRequest(data, requestId), data, ctx.today));
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
  const request = findRequest(data, requestId);
  refuse(confirmActingProblem(ctx.me, request, data, ctx.today));
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
  const stint = findPosition(data, positionId);
  refuse(setActingUntilProblem(ctx.me, stint, until, data, ctx.today));
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

// The shared demo/database cases (supabase/tests/parity.json) ------------------------------------

export const ACTING_ACTIONS = new Set<string>([
  'appointActing', 'requestCover', 'requestActing', 'withdrawActingRequest', 'confirmActing', 'setActingUntil',
]);

/** The acting actions as parity.json names them, with their …Days dates resolved. */
export type ActingAction =
  | { action: 'appointActing'; member: string; chapter: string; role: PositionRole; until: string; why: string }
  | { action: 'requestCover'; seat: string; member: string; until: string; why: string }
  | { action: 'requestActing'; member: string; chapter: string; role: PositionRole; covers?: string | null; until: string; why: string }
  | { action: 'withdrawActingRequest'; request: string }
  | { action: 'confirmActing'; request: string }
  | { action: 'setActingUntil'; position: string; until: string };

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
  }
}
