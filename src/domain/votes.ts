// Votes: who gets a ballot, what passes, and who can open, cast and close. The database's actions
// (supabase/migrations/20270101000000_meetings_votes.sql, then 20270101000100_constitution_v4.sql)
// apply the same rules with the same words.
// Section numbers refer to the club constitution (v4, Final Club Edition, 25 Oct 2026); rules marked (inferred) are
// ones it doesn't settle.

import { activePositions, isNecSeat, NEC_OFFICER_ROLES } from './access';
import { BOARD_ROLES, electoratesFor, TITLE_ROLES } from './labels';
import { reviewsScope, runsScope, scopeRefusal, signedInProblem } from './meetings';
import { melbourneDate } from './rides';
import type { ClubData, Electorate, Member, MemberStatus, NecSeatRole, Position, PositionRole, Tally, Threshold, Vote, VoteResult } from './types';

/** Who the NEC can vote to bring back to Full or Nomad (5.6). */
export const REINSTATABLE: MemberStatus[] = ['supporter', 'legacy', 'family', 'introduced'];
export const REINSTATE_VOTE = 'A reinstatement vote is an NEC majority vote on a member who isn’t Full, Nomad or an FNG (5.6).';
export const AUDITOR_VOTE = 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).';
export const SECRETARY_VOTE = 'A vote to appoint the National Secretary is an NEC two-thirds vote on a Full Member who isn’t already National Chairman, Secretary or Auditor (11.6).';
export const SEAT_VOTE_NEEDS_SEAT = 'Say which seat the vote is for: National Auditor or National Secretary (11.6, 11.8).';
export const SEAT_VOTE_IS_NATIONAL = 'A vote for a national seat is the NEC’s vote about a Full Member (11.6, 11.8).';
export const SEAT_VOTE_FULL_ONLY = 'Only a Full Member can be voted into a national seat (9.1).';
export const NEC_SEATS_ONLY = 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).';
export const NO_CASTING_ABOUT_MEMBER = 'No casting vote on a vote about a member (10.7): a tie is lost.';
// A removal vote (9.3): the chapter's vote about one of its role holders, in the shape the role takes.
export const REMOVAL_NEEDS_HOLDER = 'A removal vote is the chapter’s vote about one of its own role holders (9.3).';
export const REMOVAL_SUBJECT = 'A removal vote is about a Full Member or Nomad who holds that role in this chapter (9.3).';
export const REMOVAL_BOARD_SEAT = 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).';
export const REMOVAL_CHAPTER_ROLE = 'Removing someone from a chapter role is a majority vote of the chapter board (9.3).';

/**
 * The shape a removal vote takes (9.3): two-thirds of the chapter's Full Members for a board seat,
 * a majority of the chapter board for any other chapter role.
 */
export function removalShape(role: PositionRole): { electorate: Electorate; threshold: Threshold } {
  return BOARD_ROLES.includes(role)
    ? { electorate: 'chapter_patched', threshold: 'two_thirds' }
    : { electorate: 'chapter_board', threshold: 'majority' };
}

/** A chapter's vote that names a role: a removal vote (9.3). National seat votes name a role too, but belong to the NEC. */
export const isRemovalVote = (vote: Pick<Vote, 'chapterId' | 'subjectRole'>): boolean => vote.chapterId !== null && vote.subjectRole !== null;

/** Seats the National Auditor can't hold at the same time (11.2, 11.8). */
const AUDITOR_APART: PositionRole[] = ['president', 'treasurer', ...NEC_OFFICER_ROLES];
/** Seats that rule out a vote to make someone National Secretary: they're already on the NEC, or off it as Auditor (11.6, 11.8). */
const SECRETARY_APART: PositionRole[] = [...NEC_OFFICER_ROLES, 'nec_auditor'];

/** How long a vote can stay open (inferred). */
export const MAX_OPEN_DAYS = 60;

export interface VoteInput {
  chapterId: string | null;
  meetingId: string | null;
  subjectMemberId: string | null;
  /** The national seat an NEC vote would fill (11.6, 11.8), or the chapter role a removal vote is about (9.3); null otherwise. */
  subjectRole: PositionRole | null;
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
          // One ordinary vote per chapter, cast by its President, or by its Vice President when the
          // President chairs the NEC; the National Chairperson only breaks a tie (11.2).
          return data.chapters.some((c) => necVoterFor(c.id, data.positions) === m.id);
      }
    })
    .map((m) => m.id);
  return ids.sort();
}

/**
 * The quorum a vote starts with: a third of the voters, rounded up, for chapter and national
 * votes (10.6); 51% for the NEC (11.5); more than half a board, and at least three (8.5).
 */
const BOARD_QUORUM_FLOOR = 3;

export function defaultQuorum(electorate: Electorate, electors: number): number {
  switch (electorate) {
    case 'chapter_patched':
    case 'club_patched':
      return Math.max(1, Math.ceil(electors / 3));
    case 'nec':
      return Math.max(1, Math.ceil((electors * 51) / 100));
    case 'chapter_board':
      return Math.max(BOARD_QUORUM_FLOOR, Math.floor(electors / 2) + 1);
  }
}

/** The current holder of a seat: the newest, during a handover (9.8). */
function holderOf(role: string, chapterId: string | null, positions: Position[]): string | null {
  const seats = positions
    .filter((p) => p.endedOn === null && p.role === role && p.chapterId === chapterId)
    .sort((a, b) => b.startedOn.localeCompare(a.startedOn));
  return seats[0]?.memberId ?? null;
}

/** Who has the casting vote: the chapter's President, then its Vice President (10.9), or the National Chairperson (11.2). */
export function chairOf(chapterId: string | null, positions: Position[]): string | null {
  if (chapterId === null) return holderOf('nec_chair', null, positions);
  return holderOf('president', chapterId, positions) ?? holderOf('vice_president', chapterId, positions);
}

/** Who casts a chapter's NEC vote: its President, unless they chair the NEC; then its Vice President (11.2). */
function necVoterFor(chapterId: string, positions: Position[]): string | null {
  const president = holderOf('president', chapterId, positions);
  if (president !== null && president !== holderOf('nec_chair', null, positions)) return president;
  return holderOf('vice_president', chapterId, positions);
}

/** What the chair does with a tie: a casting vote, or let it fall (9.10). */
export type Casting = 'yes' | 'no' | 'decline';

/**
 * The result of a count. Abstentions count towards the quorum but not for or against (10.7).
 * Unanimous means every elector casts a yes (4.9). Only a majority vote can tie (as many for as
 * against, and some of each); the chair's casting vote settles it, and if they decline it's lost (9.10).
 */
export function decide(
  threshold: Threshold,
  quorum: number,
  tally: Tally,
  casting: Casting | null,
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

/** The date nine months after an FNG's start, the day clamped to the month's end as Postgres does. */
export function nineMonthsAfter(startIso: string): string {
  const [y, m, d] = startIso.split('-').map(Number);
  const total = m - 1 + 9;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Full Membership can't be granted before nine months (4.7); an unrecorded start doesn't block it. */
export function patchVoteTooEarly(fngStartedOn: string | null, today: string): boolean {
  return fngStartedOn !== null && nineMonthsAfter(fngStartedOn) > today;
}

export function openVoteProblem(me: Member | null, input: VoteInput, data: ClubData, now: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!runsScope(me, input.chapterId, data.positions)) return scopeRefusal(input.chapterId);
  if (!input.question.trim()) return 'Ask a question.';
  if (!electoratesFor(input.chapterId).includes(input.electorate)) return 'That electorate doesn’t fit here.';
  const electors = electorsFor(input.electorate, input.chapterId, data).length;
  if (electors === 0) return 'Nobody can vote in that electorate yet.';
  if (input.electorate === 'chapter_board' && electors < BOARD_QUORUM_FLOOR) {
    return 'A board vote needs at least three board members (8.5).';
  }
  const least = defaultQuorum(input.electorate, electors);
  if (!Number.isInteger(input.quorum) || input.quorum < least || input.quorum > electors) {
    return `Quorum must be between ${least} and ${electors}.`;
  }
  if (!input.closesAt || !(ms(input.closesAt) > ms(now))) return 'Pick a closing time in the future.';
  if (ms(input.closesAt) > ms(now) + MAX_OPEN_DAYS * 86_400_000) return 'Votes can stay open for 60 days at most.';
  // A vote that names a role: the NEC seats someone (11.6, 11.8), or a chapter removes someone (9.3).
  const role = input.subjectRole;
  if (role !== null && input.chapterId === null && !isNecSeat(role)) return NEC_SEATS_ONLY;
  if (role !== null && isNecSeat(role) && (input.subjectMemberId === null || input.chapterId !== null)) return SEAT_VOTE_IS_NATIONAL;
  if (role !== null && input.chapterId !== null && (input.subjectMemberId === null || TITLE_ROLES.includes(role) || role === 'nec_chair')) {
    return REMOVAL_NEEDS_HOLDER;
  }
  if (input.subjectMemberId !== null && input.chapterId === null) {
    const subject = data.members.find((x) => x.id === input.subjectMemberId);
    if (subject?.approval === 'approved' && subject.status === 'full') {
      // Seating a Full Member as National Auditor (11.8) or National Secretary (11.6): two-thirds of
      // the NEC, on someone who could hold the seat.
      if (input.subjectRole === null) return SEAT_VOTE_NEEDS_SEAT;
      const holds = (roles: PositionRole[]) => activePositions(subject.id, data.positions).some((p) => roles.includes(p.role));
      const notNecTwoThirds = input.electorate !== 'nec' || input.threshold !== 'two_thirds';
      if (input.subjectRole === 'nec_auditor' && (notNecTwoThirds || holds(AUDITOR_APART))) return AUDITOR_VOTE;
      if (input.subjectRole === 'nec_secretary' && (notNecTwoThirds || holds(SECRETARY_APART))) return SECRETARY_VOTE;
    } else if (input.subjectRole !== null) {
      return SEAT_VOTE_FULL_ONLY;
    } else if (!subject || subject.approval !== 'approved' || !REINSTATABLE.includes(subject.status) || input.electorate !== 'nec' || input.threshold !== 'majority') {
      // Bringing someone back to Full or Nomad is the NEC's decision (5.6).
      return REINSTATE_VOTE;
    }
  } else if (input.subjectMemberId !== null && role !== null) {
    // A removal vote (9.3): about a Full Member or Nomad who holds that role in this chapter. A board
    // seat goes by two-thirds of the chapter's Full Members; any other chapter role by a board majority.
    const subject = data.members.find((x) => x.id === input.subjectMemberId);
    const holds = activePositions(input.subjectMemberId, data.positions).some((p) => p.chapterId === input.chapterId && p.role === role);
    if (!subject || subject.approval !== 'approved' || !isVoting(subject) || !holds) return REMOVAL_SUBJECT;
    const shape = removalShape(role);
    if (input.electorate !== shape.electorate || input.threshold !== shape.threshold) {
      return BOARD_ROLES.includes(role) ? REMOVAL_BOARD_SEAT : REMOVAL_CHAPTER_ROLE;
    }
  } else if (input.subjectMemberId !== null) {
    const subject = data.members.find((x) => x.id === input.subjectMemberId);
    if (!subject || subject.chapterId !== input.chapterId || subject.approval !== 'approved' || subject.status !== 'fng') {
      return 'A patch vote is for an approved FNG of that chapter.';
    }
    if (input.electorate !== 'chapter_patched' || input.threshold !== 'unanimous' || !input.secret) {
      return 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.';
    }
    // Full Membership can't be granted before nine months (4.7).
    if (patchVoteTooEarly(subject.fngStartedOn, melbourneDate(now))) {
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

/** How much of the club has to turn out for a national vote: voters from at least 51% of the chapters (10.6). */
export const CHAPTERS_SHARE = 51;

/**
 * Whether a national vote has voters from at least 51% of the chapters (10.6). The chapters are the
 * ones with someone on the vote's electoral roll, since no one else could turn out.
 */
export function chaptersRepresented(vote: Pick<Vote, 'electorIds' | 'votedIds'>, members: Member[]): boolean {
  const chapterOf = new Map(members.map((m) => [m.id, m.chapterId]));
  const onRoll = new Set(vote.electorIds.map((id) => chapterOf.get(id)).filter((c): c is string => !!c));
  const voted = new Set(vote.votedIds.map((id) => chapterOf.get(id)).filter((c): c is string => !!c));
  return voted.size >= Math.max(1, Math.ceil((onRoll.size * CHAPTERS_SHARE) / 100));
}

/** Whether a national vote fails its quorum for want of chapters rather than ballots (10.6). */
export function lacksChapters(vote: Pick<Vote, 'electorate' | 'electorIds' | 'votedIds' | 'quorum' | 'tally'>, members: Member[]): boolean {
  return vote.electorate === 'club_patched' && vote.tally !== null
    && vote.tally.yes + vote.tally.no + vote.tally.abstain >= vote.quorum && !chaptersRepresented(vote, members);
}

/**
 * The result a count gives, with the two rules around decide(): a national vote without voters from
 * 51% of the chapters has no quorum (10.6), and a vote about a member gets no casting vote, so its
 * tie is lost (10.7). The database's close_vote does the same.
 */
export function outcome(vote: Vote, tally: Tally, casting: Casting | null, members: Member[]): { result: VoteResult; tied: boolean } {
  if (vote.electorate === 'club_patched' && !chaptersRepresented(vote, members)) return { result: 'no_quorum', tied: false };
  const aboutMember = vote.subjectMemberId !== null;
  return decide(vote.threshold, vote.quorum, tally, aboutMember ? null : casting, vote.electorIds.length);
}

/**
 * Why `me` can't close this vote. `tally` is the count when it's known (the demo, and the
 * database); the live app passes null and leaves the tie check to the database.
 */
const NO_CHAIR = 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';
export const TIE = 'It’s a tie. The chair gives a casting vote or lets it fall.';

export function closeProblem(
  me: Member | null,
  vote: Vote | undefined,
  tally: Tally | null,
  casting: Casting | null,
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
  const { tied } = outcome(vote, tally, null, data.members);
  const aboutMember = vote.subjectMemberId !== null;
  const chair = chairOf(vote.chapterId, data.positions);
  // No casting vote on a vote about a member: a tie is lost (10.7).
  if (tied && aboutMember && casting !== null) return NO_CASTING_ABOUT_MEMBER;
  // Otherwise the chair casts or declines, and a declined tie is lost (9.10).
  if (tied && !aboutMember && chair !== null && (casting === null || me!.id !== chair)) return TIE;
  if (!tied && casting !== null) return 'There’s no tie, so no casting vote.';
  if ((casting === 'yes' || casting === 'no') && chair === null) return NO_CHAIR;
  return null;
}

export function canSeeVote(me: Member | null, vote: Vote, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return vote.electorIds.includes(me.id) || reviewsScope(me, vote.chapterId, positions);
}

const THRESHOLD_LINE: Record<Threshold, string> = {
  majority: 'Majority of votes cast',
  two_thirds: 'Two-thirds of votes cast',
  unanimous: 'Unanimous',
};

/** "Two-thirds of votes cast · Quorum 5 of 9 · Secret ballot" */
export function ruleLine(vote: Pick<Vote, 'threshold' | 'quorum' | 'electorIds' | 'secret'>): string {
  const n = vote.electorIds.length;
  const parts =
    vote.threshold === 'unanimous'
      ? [`Unanimous: all ${n} must vote yes`]
      : [THRESHOLD_LINE[vote.threshold], `Quorum ${vote.quorum} of ${n}`];
  if (vote.secret) parts.push('Secret ballot');
  return parts.join(' · ');
}

/** The latest vote of one kind about a member: the open one if there is one, else the one that closed last. */
function subjectVoteFor(memberId: string, votes: Vote[], electorate: Electorate, threshold?: Threshold, role: PositionRole | null = null): Vote | null {
  const theirs = votes.filter(
    (v) => v.subjectMemberId === memberId && v.electorate === electorate && (!threshold || v.threshold === threshold) && (v.subjectRole ?? null) === role,
  );
  return latestOf(theirs);
}

function latestOf(votes: Vote[]): Vote | null {
  return votes.find((v) => v.closedAt === null) ?? votes.sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0] ?? null;
}

/** The chapter's removal vote about this term (9.3): the open one, or else the latest result. */
export function removalVoteFor(position: Position, votes: Vote[]): Vote | null {
  const shape = removalShape(position.role);
  return latestOf(
    votes.filter(
      (v) => v.subjectMemberId === position.memberId && v.subjectRole === position.role && v.chapterId === position.chapterId
        && v.electorate === shape.electorate && v.threshold === shape.threshold,
    ),
  );
}

/** The chapter's patch vote on an FNG (4.9). */
export const patchVoteFor = (memberId: string, votes: Vote[]) => subjectVoteFor(memberId, votes, 'chapter_patched');

/** The NEC's vote on bringing a member back to Full or Nomad (5.6). */
export const reinstateVoteFor = (memberId: string, votes: Vote[]) => subjectVoteFor(memberId, votes, 'nec', 'majority');

/** The NEC's two-thirds vote on seating a member as National Auditor (11.8) or Secretary (11.6). */
export const seatVoteFor = (memberId: string, votes: Vote[], seat: NecSeatRole) => subjectVoteFor(memberId, votes, 'nec', 'two_thirds', seat);
export const auditorVoteFor = (memberId: string, votes: Vote[]) => seatVoteFor(memberId, votes, 'nec_auditor');
