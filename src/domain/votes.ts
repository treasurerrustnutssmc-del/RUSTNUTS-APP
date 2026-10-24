// Votes: who gets a ballot, what passes, and who can open, cast and close. The database's actions
// (supabase/migrations/20270101000000_meetings_votes.sql) apply the same rules with the same words.
// Section numbers refer to the club constitution (29 Jul 2026 draft); rules marked (inferred) are
// ones it doesn't settle.

import { activePositions } from './access';
import { monthsBetween } from './dates';
import { BOARD_ROLES, electoratesFor } from './labels';
import { runsScope, scopeRefusal, signedInProblem } from './meetings';
import { melbourneDate } from './rides';
import type { ClubData, Electorate, Member, Position, Tally, Threshold, Vote, VoteResult } from './types';

/** How long a vote can stay open (inferred). */
export const MAX_OPEN_DAYS = 60;

export interface VoteInput {
  chapterId: string | null;
  meetingId: string | null;
  subjectMemberId: string | null;
  question: string;
  details: string | null;
  electorate: Electorate;
  threshold: Threshold;
  secret: boolean;
  quorum: number;
  closesAt: string;
}

// Voting Members: Full and Nomad. Nomads vote only on national matters, not chapter ones (10.7).
const isVoting = (m: Member) => m.status === 'full' || m.status === 'nomad';

/** Everyone who gets a ballot, by member id, sorted. Taken once, when the vote opens. */
export function electorsFor(electorate: Electorate, chapterId: string | null, data: ClubData): string[] {
  const ids = data.members
    .filter((m) => {
      if (m.approval !== 'approved' || m.status === 'legacy') return false;
      switch (electorate) {
        case 'chapter_board':
          return activePositions(m.id, data.positions).some((p) => p.chapterId === chapterId && BOARD_ROLES.includes(p.role));
        case 'chapter_patched':
          return m.chapterId === chapterId && m.status === 'full';
        case 'club_patched':
          return isVoting(m);
        case 'nec':
          // One ordinary vote per chapter, cast by its President; the National Chairperson only
          // breaks a tie (11.2).
          return activePositions(m.id, data.positions).some((p) => p.role === 'president' && p.chapterId !== null);
      }
    })
    .map((m) => m.id);
  return ids.sort();
}

/**
 * The quorum a vote starts with: a third of the voters, rounded up, for chapter and national
 * votes (10.6); 51% for the NEC (11.5); more than half for a board (inferred).
 */
export function defaultQuorum(electorate: Electorate, electors: number): number {
  switch (electorate) {
    case 'chapter_patched':
    case 'club_patched':
      return Math.max(1, Math.ceil(electors / 3));
    case 'nec':
      return Math.max(1, Math.ceil((electors * 51) / 100));
    case 'chapter_board':
      return Math.floor(electors / 2) + 1;
  }
}

/** Who has the casting vote: the chapter's President, then its Vice President (10.9), or the National Chairperson (11.2). */
export function chairOf(chapterId: string | null, positions: Position[]): string | null {
  const roles = chapterId === null ? ['nec_chair'] : ['president', 'vice_president'];
  for (const role of roles) {
    const seat = positions.find((p) => p.endedOn === null && p.role === role && p.chapterId === chapterId);
    if (seat) return seat.memberId;
  }
  return null;
}

/**
 * The result of a count. Abstentions count towards the quorum but not for or against (10.7).
 * Unanimous means every elector casts a yes (4.9). Only a majority vote can tie (as many for as
 * against, and some of each); the chair's casting vote settles it, and without one it's lost (9.10).
 */
export function decide(
  threshold: Threshold,
  quorum: number,
  tally: Tally,
  casting: 'yes' | 'no' | null,
  electors: number,
): { result: VoteResult; tied: boolean } {
  const cast = tally.yes + tally.no + tally.abstain;
  if (cast < quorum) return { result: 'no_quorum', tied: false };
  const tied = threshold === 'majority' && tally.yes === tally.no && tally.yes > 0;
  let carried: boolean;
  if (tied) carried = casting === 'yes';
  else if (threshold === 'majority') carried = tally.yes > tally.no;
  else if (threshold === 'two_thirds') carried = tally.yes > 0 && 3 * tally.yes >= 2 * (tally.yes + tally.no);
  else carried = tally.yes > 0 && tally.yes === electors;
  return { result: carried ? 'carried' : 'lost', tied };
}

const ms = (iso: string) => new Date(iso).getTime();

export function openVoteProblem(me: Member | null, input: VoteInput, data: ClubData, now: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!runsScope(me, input.chapterId, data.positions)) return scopeRefusal(input.chapterId);
  if (!input.question.trim()) return 'Ask a question.';
  if (!electoratesFor(input.chapterId).includes(input.electorate)) return 'That electorate doesn’t fit here.';
  const electors = electorsFor(input.electorate, input.chapterId, data).length;
  if (electors === 0) return 'Nobody can vote in that electorate yet.';
  if (!Number.isInteger(input.quorum) || input.quorum < 1 || input.quorum > electors) {
    return `Quorum must be between 1 and ${electors}.`;
  }
  if (!input.closesAt || !(ms(input.closesAt) > ms(now))) return 'Pick a closing time in the future.';
  if (ms(input.closesAt) > ms(now) + MAX_OPEN_DAYS * 86_400_000) return 'Votes can stay open for 60 days at most.';
  if (input.subjectMemberId !== null) {
    const subject = data.members.find((x) => x.id === input.subjectMemberId);
    if (!subject || input.chapterId === null || subject.chapterId !== input.chapterId || subject.approval !== 'approved' || subject.status !== 'fng') {
      return 'A patch vote is for an approved FNG of that chapter.';
    }
    if (input.electorate !== 'chapter_patched' || input.threshold !== 'unanimous' || !input.secret) {
      return 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.';
    }
    // Full Membership can't be granted before nine months (4.7).
    if (subject.fngStartedOn !== null && monthsBetween(subject.fngStartedOn, melbourneDate(now)) < 9) {
      return 'A patch vote can open only nine months into the FNG’s trial (4.7).';
    }
  }
  if (input.meetingId !== null) {
    const meeting = (data.meetings ?? []).find((x) => x.id === input.meetingId);
    if (!meeting || meeting.chapterId !== input.chapterId) return 'No such meeting.';
  }
  return null;
}

const isClosed = (vote: Vote, now: string) => vote.closedAt !== null || ms(now) >= ms(vote.closesAt);

/** Electors vote once each, while the vote is open. The electorate was fixed when it opened. */
export function castProblem(me: Member | null, vote: Vote | undefined, now: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!vote) return 'No such vote.';
  if (!vote.electorIds.includes(me!.id)) return 'You’re not on this vote.';
  if (vote.votedIds.includes(me!.id)) return 'You’ve already voted.';
  if (isClosed(vote, now)) return 'That vote has closed.';
  return null;
}

/**
 * Why `me` can't close this vote. `tally` is the count when it's known (the demo, and the
 * database); the live app passes null and leaves the tie check to the database.
 */
const NO_CHAIR = 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';

export function closeProblem(
  me: Member | null,
  vote: Vote | undefined,
  tally: Tally | null,
  casting: 'yes' | 'no' | null,
  data: ClubData,
  now: string,
): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!vote) return 'No such vote.';
  if (!runsScope(me, vote.chapterId, data.positions)) return scopeRefusal(vote.chapterId);
  if (vote.closedAt !== null) return 'That vote has already closed.';
  if (ms(now) < ms(vote.closesAt) && vote.votedIds.length < vote.electorIds.length) {
    return 'Wait until it closes, or until everyone has voted.';
  }
  if (!tally) return null;
  const { tied } = decide(vote.threshold, vote.quorum, tally, null, vote.electorIds.length);
  const chair = chairOf(vote.chapterId, data.positions);
  if (tied && chair !== null && (casting === null || me!.id !== chair)) {
    return 'It’s a tie. The chair closes it with the casting vote.';
  }
  if (!tied && casting !== null) return 'There’s no tie, so no casting vote.';
  if (casting !== null && chair === null) return NO_CHAIR;
  return null;
}

export function canSeeVote(me: Member | null, vote: Vote, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return vote.electorIds.includes(me.id) || runsScope(me, vote.chapterId, positions);
}

const THRESHOLD_LINE: Record<Threshold, string> = {
  majority: 'Majority of votes cast',
  two_thirds: 'Two-thirds of votes cast',
  unanimous: 'Unanimous',
};

/** "Two-thirds of votes cast · Quorum 5 of 9 · Secret ballot" */
export function ruleLine(vote: Pick<Vote, 'threshold' | 'quorum' | 'electorIds' | 'secret'>): string {
  const parts = [THRESHOLD_LINE[vote.threshold], `Quorum ${vote.quorum} of ${vote.electorIds.length}`];
  if (vote.secret) parts.push('Secret ballot');
  return parts.join(' · ');
}

/** The patch vote on a member: the open one if there is one, else the one that closed last. */
export function patchVoteFor(memberId: string, votes: Vote[]): Vote | null {
  const theirs = votes.filter((v) => v.subjectMemberId === memberId);
  return (
    theirs.find((v) => v.closedAt === null) ??
    theirs.sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0] ??
    null
  );
}
