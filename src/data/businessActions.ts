// What each meetings-and-votes action does to the demo club, under the same rules as the database
// (src/domain/meetings.ts and votes.ts; checked by src/data/parity.test.ts). Kept beside
// demoActions.ts, which calls into these for the shared parity cases.

import {
  actionItemProblem,
  approveMinutesProblem,
  cancelMeetingProblem,
  saveMeetingProblem,
  saveMinutesProblem,
  setDoneProblem,
  type ActionItemInput,
  type MeetingInput,
} from '../domain/meetings';
import { melbourneDate } from '../domain/rides';
import type { BallotChoice, ClubData, Meeting, Tally, Vote } from '../domain/types';
import { castProblem, closeProblem, decide, electorsFor, openVoteProblem, type VoteInput } from '../domain/votes';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();
const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

const meetingsOf = (data: ClubData) => data.meetings ?? [];
const votesOf = (data: ClubData) => data.votes ?? [];

export function saveMeeting(ctx: DemoCtx, input: MeetingInput): { data: ClubData; id: string } {
  const existing = input.id === null ? null : meetingsOf(ctx.data).find((x) => x.id === input.id);
  refuse(saveMeetingProblem(ctx.me, input, existing, ctx.data));
  const fields = {
    chapterId: input.chapterId,
    kind: input.kind,
    title: input.title.trim(),
    startsAt: input.startsAt,
    location: blankToNull(input.location),
    agenda: input.agenda.map((a) => ({ title: a.title.trim(), notes: blankToNull(a.notes) })),
  };
  if (existing) {
    return {
      data: { ...ctx.data, meetings: meetingsOf(ctx.data).map((x) => (x.id === existing.id ? { ...x, ...fields } : x)) },
      id: existing.id,
    };
  }
  const meeting: Meeting = {
    id: newId('mt'),
    ...fields,
    minutes: null,
    minutesApprovedAt: null,
    minutesApprovedBy: null,
    cancelledAt: null,
    createdBy: ctx.me!.id,
  };
  return { data: { ...ctx.data, meetings: [...meetingsOf(ctx.data), meeting] }, id: meeting.id };
}

function patchMeeting(data: ClubData, id: string, patch: Partial<Meeting>): ClubData {
  return { ...data, meetings: meetingsOf(data).map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export function cancelMeeting(ctx: DemoCtx, id: string): ClubData {
  refuse(cancelMeetingProblem(ctx.me, meetingsOf(ctx.data).find((x) => x.id === id), ctx.data, nowOf(ctx)));
  return patchMeeting(ctx.data, id, { cancelledAt: nowOf(ctx) });
}

export function saveMinutes(ctx: DemoCtx, id: string, text: string): ClubData {
  refuse(saveMinutesProblem(ctx.me, meetingsOf(ctx.data).find((x) => x.id === id), ctx.data));
  return patchMeeting(ctx.data, id, { minutes: blankToNull(text) });
}

export function approveMinutes(ctx: DemoCtx, id: string): ClubData {
  refuse(approveMinutesProblem(ctx.me, meetingsOf(ctx.data).find((x) => x.id === id), ctx.data, nowOf(ctx)));
  return patchMeeting(ctx.data, id, { minutesApprovedAt: nowOf(ctx), minutesApprovedBy: ctx.me!.id });
}

export function saveActionItem(ctx: DemoCtx, input: ActionItemInput): { data: ClubData; id: string } {
  refuse(actionItemProblem(ctx.me, input, ctx.data));
  const items = ctx.data.actionItems ?? [];
  const fields = { title: input.title.trim(), ownerId: input.ownerId, dueOn: input.dueOn };
  if (input.id !== null) {
    return { data: { ...ctx.data, actionItems: items.map((a) => (a.id === input.id ? { ...a, ...fields } : a)) }, id: input.id };
  }
  const id = newId('ai');
  return {
    data: { ...ctx.data, actionItems: [...items, { id, meetingId: input.meetingId, chapterId: input.chapterId, doneOn: null, ...fields }] },
    id,
  };
}

export function setActionDone(ctx: DemoCtx, id: string, done: boolean): ClubData {
  const items = ctx.data.actionItems ?? [];
  refuse(setDoneProblem(ctx.me, items.find((a) => a.id === id), ctx.data));
  const doneOn = done ? melbourneDate(nowOf(ctx)) : null;
  return { ...ctx.data, actionItems: items.map((a) => (a.id === id ? { ...a, doneOn } : a)) };
}

export function openVote(ctx: DemoCtx, input: VoteInput): { data: ClubData; id: string } {
  refuse(openVoteProblem(ctx.me, input, ctx.data, nowOf(ctx)));
  const vote: Vote = {
    id: newId('v'),
    chapterId: input.chapterId,
    meetingId: input.meetingId,
    subjectMemberId: input.subjectMemberId,
    question: input.question.trim(),
    details: blankToNull(input.details),
    electorate: input.electorate,
    threshold: input.threshold,
    secret: input.secret,
    quorum: input.quorum,
    openedAt: nowOf(ctx),
    closesAt: input.closesAt,
    closedAt: null,
    result: null,
    castingVote: null,
    tally: null,
    electorIds: electorsFor(input.electorate, input.chapterId, ctx.data),
    votedIds: [],
    ballots: [],
    createdBy: ctx.me!.id,
  };
  return { data: { ...ctx.data, votes: [...votesOf(ctx.data), vote] }, id: vote.id };
}

function patchVote(data: ClubData, id: string, patch: Partial<Vote>): ClubData {
  return { ...data, votes: votesOf(data).map((v) => (v.id === id ? { ...v, ...patch } : v)) };
}

/** The demo keeps every ballot on the vote (a secret one without its voter); screens show them only once closed. */
export function castBallot(ctx: DemoCtx, voteId: string, choice: BallotChoice): ClubData {
  const vote = votesOf(ctx.data).find((v) => v.id === voteId);
  refuse(castProblem(ctx.me, vote, nowOf(ctx)));
  const me = ctx.me!.id;
  return patchVote(ctx.data, voteId, {
    votedIds: [...vote!.votedIds, me].sort(),
    ballots: [...vote!.ballots, { memberId: vote!.secret ? null : me, choice }],
  });
}

export function tallyOf(ballots: Vote['ballots']): Tally {
  const t: Tally = { yes: 0, no: 0, abstain: 0 };
  for (const b of ballots) t[b.choice] += 1;
  return t;
}

export function closeVote(ctx: DemoCtx, voteId: string, casting: 'yes' | 'no' | null): ClubData {
  const vote = votesOf(ctx.data).find((v) => v.id === voteId);
  const tally = vote ? tallyOf(vote.ballots) : null;
  refuse(closeProblem(ctx.me, vote, tally, casting, ctx.data, nowOf(ctx)));
  const { result } = decide(vote!.threshold, vote!.quorum, tally!, casting, vote!.electorIds.length);
  return patchVote(ctx.data, voteId, { closedAt: nowOf(ctx), result, castingVote: casting, tally });
}
