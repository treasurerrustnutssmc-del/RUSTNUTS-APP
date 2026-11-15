// Votes: who gets a ballot, what passes, and who can open, cast and close. The database's actions
// (supabase/migrations/20270101000000_meetings_votes.sql, then 20270101000100_constitution_v4.sql)
// apply the same rules with the same words.
// Section numbers refer to the club constitution (v4, Final Club Edition, 25 Oct 2026); rules marked (inferred) are
// ones it doesn't settle.

import {
  actingElectors, AUDITOR_STAYS_OUT, auditorStaysOut, BOARD_RECORDS_ACTING, isBoardOf, isNecSeat, NEC_OFFICER_ROLES, NO_REQUEST, NOT_YOURSELF,
  requestNeedsVote, SMALL_BOARD,
} from './access';
import { dutyRows, heldPositions, heldRows, isActing, necVoterBefore, necVoterFor, necVoterRow, removalShape, settleActing } from './acting';
import { formatAuDate } from './dates';
import { BOARD_ROLES, electoratesFor, ROLE_LABEL, TITLE_ROLES } from './labels';
import { reviewsScope, runsScope, scopeRefusal, signedInProblem } from './meetings';
import { displayName, FORMER_MEMBER } from './profile';
import { melbourneDate } from './rides';
import type { ActingRequest, ClubData, Electorate, Member, MemberStatus, NecSeatRole, Position, PositionRole, Tally, Threshold, Vote, VoteResult } from './types';

export { necVoterBefore, removalShape };

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

// Acting roles (docs/superpowers/specs/2026-11-15-acting-roles-design.md, "Votes and ballots"): the
// database's words (supabase/migrations/20270870000000_acting_roles.sql §6, §8).
export const ACTING_END_SHAPE = 'Ending someone’s acting is a majority vote of the chapter board (9.3).';
export const ACTING_VOTE_OPEN = 'A vote about acting stays open for at least 48 hours, so everyone affected can answer.';
export const NO_VOTE_NEEDED = 'This request doesn’t need a vote. A third board member confirms it.';
export const CAST_BOARD_ENDED = 'Your board seat has ended, so this ballot isn’t yours now.';
export const castNecNotYours = (chapter: string): string => `You don’t cast ${chapter}’s NEC vote now, so this ballot isn’t yours.`;
export const castNecCast = (chapter: string): string => `${chapter}’s NEC ballot has already been cast.`;
/** A vote about acting stays open at least this long, so the holder can answer and nobody closes it early (inferred). */
export const ACTING_VOTE_HOURS = 48;
const ACTING_VOTE_MS = ACTING_VOTE_HOURS * 3_600_000;

/**
 * A chapter's vote that names a role and isn't an acting vote: a removal vote (9.3), or one to end
 * someone's acting. A vote that seats acting names a role too, and so do national seat votes, which
 * belong to the NEC.
 */
export const isRemovalVote = (vote: Pick<Vote, 'chapterId' | 'subjectRole' | 'actingRequestId'>): boolean =>
  vote.chapterId !== null && vote.subjectRole !== null && (vote.actingRequestId ?? null) === null;

/**
 * The subject's held acting row in that chapter and role, if they have one: a vote naming it is one
 * to end their acting (9.3). Mirrors open_vote's stint.
 */
export function stintAbout(chapterId: string | null, memberId: string | null, role: PositionRole | null, positions: Position[]): Position | null {
  if (chapterId === null || memberId === null || role === null) return null;
  return heldPositions(memberId, positions).find((p) => p.chapterId === chapterId && p.role === role && isActing(p)) ?? null;
}

/**
 * A vote about acting: one on a request (seating it), or one naming a role its subject holds as
 * acting there (ending it). Judged when it closes, as close_vote does.
 */
export function aboutActing(vote: Pick<Vote, 'chapterId' | 'subjectMemberId' | 'subjectRole' | 'actingRequestId'>, positions: Position[]): boolean {
  return (vote.actingRequestId ?? null) !== null || stintAbout(vote.chapterId, vote.subjectMemberId, vote.subjectRole, positions) !== null;
}

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

/**
 * Everyone who gets a ballot, by member id, sorted. Taken once, when the vote opens. A vote about
 * someone (`about`) who holds that role as acting there ends their acting, and is decided without
 * them, the holder they cover and, for a President or Treasurer seat, the Auditor (8.5, 9.3, 11.8).
 */
export function electorsFor(
  electorate: Electorate, chapterId: string | null, data: ClubData, about?: { memberId: string | null; role: PositionRole | null },
): string[] {
  const stint = about ? stintAbout(chapterId, about.memberId, about.role, data.positions) : null;
  if (stint) return actingElectors(stint.chapterId!, stint.role, stint.memberId, stint.covers ?? null, data);
  const ids = data.members
    .filter((m) => {
      if (m.approval !== 'approved' || m.status === 'legacy') return false;
      switch (electorate) {
        case 'chapter_board':
          // Board members: a held board row, covered or not, one ballot each (8.1, 9.5).
          return heldPositions(m.id, data.positions).some((p) => p.chapterId === chapterId && BOARD_ROLES.includes(p.role));
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
export const BOARD_QUORUM_FLOOR = 3;

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

/** Who has a seat's duties: the newest, during a handover (9.8); a stand-in rather than the holder they cover. */
function dutyHolderOf(role: PositionRole, chapterId: string | null, positions: Position[]): string | null {
  const seats = dutyRows(positions)
    .filter((p) => p.role === role && p.chapterId === chapterId)
    .sort((a, b) => b.startedOn.localeCompare(a.startedOn));
  return seats[0]?.memberId ?? null;
}

/**
 * Who has the casting vote: whoever has the chapter President's duties (an Acting President, or the
 * President's stand-in), then whoever has the Vice President's (10.9), or the National Chairperson
 * (11.2). Mirrors private.chair_of.
 */
export function chairOf(chapterId: string | null, positions: Position[]): string | null {
  if (chapterId === null) return dutyHolderOf('nec_chair', null, positions);
  return dutyHolderOf('president', chapterId, positions) ?? dutyHolderOf('vice_president', chapterId, positions);
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

/**
 * Why `me` can't open this vote, or null. Mirrors public.open_vote, which settles first: a stint
 * that lapsed last night gives no ballot. A vote naming a role its subject holds as acting is one to
 * end their acting: a chapter board majority, decided without them, the holder they cover and, for a
 * President or Treasurer seat, the Auditor, by at least three of the rest (8.6), and open at least
 * 48 hours. The subject checks read held rows, so a covered holder still faces a 9.3 vote.
 */
export function openVoteProblem(me: Member | null, input: VoteInput, raw: ClubData, now: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const data = settleActing(raw, melbourneDate(now));
  if (!runsScope(me, input.chapterId, data.positions)) return scopeRefusal(input.chapterId);
  if (!input.question.trim()) return 'Ask a question.';
  if (!electoratesFor(input.chapterId).includes(input.electorate)) return 'That electorate doesn’t fit here.';
  const stint = stintAbout(input.chapterId, input.subjectMemberId, input.subjectRole, data.positions);
  let electors: number;
  if (stint) {
    const shape = removalShape(stint.role, true);
    if (input.electorate !== shape.electorate || input.threshold !== shape.threshold) return ACTING_END_SHAPE;
    electors = electorsFor(input.electorate, input.chapterId, data, { memberId: stint.memberId, role: stint.role }).length;
    if (electors < BOARD_QUORUM_FLOOR) return SMALL_BOARD;
    if (ms(input.closesAt) < ms(now) + ACTING_VOTE_MS) return ACTING_VOTE_OPEN;
  } else {
    electors = electorsFor(input.electorate, input.chapterId, data).length;
    if (electors === 0) return 'Nobody can vote in that electorate yet.';
    if (input.electorate === 'chapter_board' && electors < BOARD_QUORUM_FLOOR) {
      return 'A board vote needs at least three board members (8.5).';
    }
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
      const holds = (roles: PositionRole[]) => heldPositions(subject.id, data.positions).some((p) => roles.includes(p.role));
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
    // Ending someone's acting took its shape above.
    const subject = data.members.find((x) => x.id === input.subjectMemberId);
    const holds = heldPositions(input.subjectMemberId, data.positions).some((p) => p.chapterId === input.chapterId && p.role === role);
    if (!subject || subject.approval !== 'approved' || !isVoting(subject) || !holds) return REMOVAL_SUBJECT;
    const shape = removalShape(role);
    if (!stint && (input.electorate !== shape.electorate || input.threshold !== shape.threshold)) {
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

/**
 * Whose ballot `me` would cast on this vote (their own, or a chapter's NEC ballot they take over),
 * or why they can't. An NEC ballot belongs to its chapter (11.2, 11.6): the person named at opening
 * casts it while they cast that chapter's NEC vote now, or did before the day it opened; anyone
 * else casts it only as the chapter's voter before that day, and only while it's uncast, so a seat
 * that starts on or after the opening day neither takes a ballot nor takes it away. A ballot with no
 * chapter keeps the old rule. Expects settled rows. Mirrors public.cast_ballot.
 */
function ballotRow(meId: string, vote: Vote, data: ClubData): { elector: string | null; refusal: string | null } {
  const chapters = vote.electorChapters ?? {};
  const named = vote.electorIds.includes(meId);
  if (Object.keys(chapters).length === 0) return { elector: named ? meId : null, refusal: null };
  const day = melbourneDate(vote.openedAt);
  const P = data.positions;
  const chapterName = (id: string) => data.chapters.find((c) => c.id === id)?.name ?? id;
  if (named) {
    const mine = chapters[meId];
    const notMine = mine !== undefined && meId !== necVoterFor(mine, P) && meId !== necVoterBefore(mine, day, P);
    return { elector: meId, refusal: notMine ? castNecNotYours(chapterName(mine)) : null };
  }
  // The chapter whose voter before the opening day is me: its ballot, an uncast one first.
  const takes = Object.entries(chapters)
    .filter(([, chapter]) => necVoterBefore(chapter, day, P) === meId)
    .sort(([a, x], [b, y]) => Number(vote.votedIds.includes(a)) - Number(vote.votedIds.includes(b)) || x.localeCompare(y));
  if (takes.length === 0) return { elector: null, refusal: null };
  const [elector, chapter] = takes[0];
  return { elector, refusal: vote.votedIds.includes(elector) ? castNecCast(chapterName(chapter)) : null };
}

/**
 * Electors vote once each, while the vote is open. The electorate was fixed when it opened, but a
 * board ballot needs a seat on that chapter's board when it's cast (8.5), and an NEC ballot goes
 * with its chapter (ballotRow). Settled first: a stint that lapsed last night gives no ballot.
 */
export function castProblem(me: Member | null, vote: Vote | undefined, now: string, raw: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!vote) return 'No such vote.';
  const data = settleActing(raw, melbourneDate(now));
  const { elector, refusal } = ballotRow(me!.id, vote, data);
  if (refusal) return refusal;
  if (elector === null) return 'You’re not on this vote.';
  if (vote.votedIds.includes(elector)) return 'You’ve already voted.';
  if (isClosed(vote, now)) return 'That vote has closed.';
  if (vote.electorate === 'chapter_board' && vote.chapterId !== null && !isBoardOf(me, vote.chapterId, data.positions)) return CAST_BOARD_ENDED;
  return null;
}

/** The elector row `me`'s ballot lands on: their own, or the chapter's NEC ballot they take over. Ask castProblem first. */
export function ballotRowFor(me: Member, vote: Vote, now: string, raw: ClubData): string | null {
  return ballotRow(me.id, vote, settleActing(raw, melbourneDate(now))).elector;
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
  raw: ClubData,
  now: string,
): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!vote) return 'No such vote.';
  const data = settleActing(raw, melbourneDate(now));
  if (!runsScope(me, vote.chapterId, data.positions)) return scopeRefusal(vote.chapterId);
  if (vote.closedAt !== null) return 'That vote has already closed.';
  // A vote about acting can't close within 48 hours of opening, even once everyone has voted, so the
  // holder can answer and nobody voids it by closing early.
  if (ms(now) < ms(vote.openedAt) + ACTING_VOTE_MS && aboutActing(vote, data.positions)) return ACTING_VOTE_OPEN;
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

/**
 * Who sees a vote: its electors and whoever reviews its scope, and, while an NEC vote is open,
 * whoever would take a chapter's uncast ballot on it (its voter before the day it opened), as
 * club_business lists it.
 */
export function canSeeVote(me: Member | null, vote: Vote, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (vote.electorIds.includes(me.id) || reviewsScope(me, vote.chapterId, positions)) return true;
  if (vote.electorate !== 'nec' || vote.closedAt !== null) return false;
  const day = melbourneDate(vote.openedAt);
  return Object.entries(vote.electorChapters ?? {}).some(
    ([elector, chapter]) => !vote.votedIds.includes(elector) && necVoterBefore(chapter, day, positions) === me.id,
  );
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

/**
 * The chapter's removal vote about this term (9.3), or, for a stint, its vote to end the acting: the
 * open one, or else the latest result. The vote that seated a stint isn't one.
 */
export function removalVoteFor(position: Position, votes: Vote[]): Vote | null {
  const shape = removalShape(position.role, isActing(position));
  return latestOf(
    votes.filter(
      (v) => v.subjectMemberId === position.memberId && v.subjectRole === position.role && v.chapterId === position.chapterId
        && v.electorate === shape.electorate && v.threshold === shape.threshold && (v.actingRequestId ?? null) === null,
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

// ---------------------------------------------------------------------------
// Acting votes (docs/superpowers/specs/2026-11-15-acting-roles-design.md, "Votes and ballots")
// ---------------------------------------------------------------------------

const nameOf = (memberId: string | null, data: ClubData): string => {
  const member = memberId === null ? undefined : data.members.find((m) => m.id === memberId);
  return member ? displayName(member) : FORMER_MEMBER;
};
const chapterNameOf = (chapterId: string | null, data: ClubData): string | null =>
  data.chapters.find((c) => c.id === chapterId)?.name ?? null;

/**
 * The board vote's question on a request: "Jet acts as President (North) for Smokey until
 * 13/12/2026: Smokey can’t be reached", without "for …" in an empty seat or once the covered row has
 * ended. Expects settled rows. Mirrors public.open_acting_vote.
 */
export function actingVoteQuestion(request: ActingRequest, data: ClubData): string {
  const holder = request.covers === null ? null : heldRows(data.positions).find((p) => p.id === request.covers)?.memberId ?? null;
  const chapter = chapterNameOf(request.chapterId, data);
  return `${nameOf(request.memberId, data)} acts as ${ROLE_LABEL[request.role]}${chapter ? ` (${chapter})` : ''}`
    + `${holder ? ` for ${nameOf(holder, data)}` : ''} until ${formatAuDate(request.until)}: ${request.why}`;
}

/** The question a vote to end someone's acting starts with: "End Jet’s acting as President (North)?" */
export function endActingQuestion(position: Position, data: ClubData): string {
  const chapter = chapterNameOf(position.chapterId, data);
  return `End ${nameOf(position.memberId, data)}’s acting as ${ROLE_LABEL[position.role]}${chapter ? ` (${chapter})` : ''}?`;
}

/**
 * Why `me` can't open the board's vote on a request, or null: a chapter board majority, decided
 * without the stand-in, the holder they'd cover and, for a President or Treasurer seat, the Auditor,
 * by at least three of the rest (8.6), open at least 48 hours. Settles first, so a request past its
 * until date has lapsed. The database's order and words: public.open_acting_vote.
 */
export function openActingVoteProblem(
  me: Member | null, request: ActingRequest | undefined, quorum: number, closesAt: string, meetingId: string | null, raw: ClubData, now: string,
): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn || !me) return signedIn;
  if (!request) return NO_REQUEST;
  const today = melbourneDate(now);
  const known = (raw.actingRequests ?? []).some((r) => r.id === request.id);
  const data = settleActing(known ? raw : { ...raw, actingRequests: [...(raw.actingRequests ?? []), request] }, today);
  const req = data.actingRequests!.find((r) => r.id === request.id)!;
  if (req.closedAt !== null) return NO_REQUEST;
  if (!requestNeedsVote(req, data, today)) return NO_VOTE_NEEDED;
  if (!isBoardOf(me, req.chapterId, data.positions)) return BOARD_RECORDS_ACTING;
  if (me.id === req.memberId) return NOT_YOURSELF;
  if (auditorStaysOut(me, req.role, data.positions)) return AUDITOR_STAYS_OUT;
  const electors = actingElectors(req.chapterId, req.role, req.memberId, req.covers, data).length;
  if (electors < BOARD_QUORUM_FLOOR) return SMALL_BOARD;
  if (ms(closesAt) < ms(now) + ACTING_VOTE_MS) return ACTING_VOTE_OPEN;
  const least = defaultQuorum('chapter_board', electors);
  if (!Number.isInteger(quorum) || quorum < least || quorum > electors) return `Quorum must be between ${least} and ${electors}.`;
  if (!closesAt || !(ms(closesAt) > ms(now))) return 'Pick a closing time in the future.';
  if (ms(closesAt) > ms(now) + MAX_OPEN_DAYS * 86_400_000) return 'Votes can stay open for 60 days at most.';
  if (meetingId !== null) {
    const meeting = (data.meetings ?? []).find((x) => x.id === meetingId);
    if (!meeting || meeting.chapterId !== req.chapterId) return 'No such meeting.';
  }
  return null;
}

/** "13/12" */
const dayMonth = (iso: string) => formatAuDate(iso).slice(0, 5);

/**
 * What opening this vote warns about: an elector whose ballot rests on a stint that ends before it
 * closes. On an NEC vote, a chapter's voter acting as President hands the ballot on when the stint
 * ends ("Jet’s acting ends 13/12. Close before then, or Smokey votes for North instead."), or no one
 * can cast it. On a board vote, someone on the board only through acting loses their ballot then. A
 * stint that ends on the closing day itself is fine, and a cover takes no one's ballot away.
 */
export function stintVoteWarnings(input: VoteInput, raw: ClubData, today: string): string[] {
  if (!input.closesAt || Number.isNaN(ms(input.closesAt))) return [];
  const data = settleActing(raw, today);
  const closes = melbourneDate(input.closesAt);
  const ends = (until: string | null | undefined): until is string => !!until && until < closes;
  if (input.electorate === 'nec' && input.chapterId === null) {
    return data.chapters.flatMap((c) => {
      const row = necVoterRow(c.id, data.positions);
      if (!row || !isActing(row) || !ends(row.actingUntil)) return [];
      const next = necVoterBefore(c.id, today, data.positions.filter((p) => p.id !== row.id));
      if (next === row.memberId) return [];
      const after = next === null ? `${nameOf(row.memberId, data)} can’t vote` : `${nameOf(next, data)} votes for ${c.name} instead`;
      return [`${nameOf(row.memberId, data)}’s acting ends ${dayMonth(row.actingUntil)}. Close before then, or ${after}.`];
    });
  }
  if (input.electorate === 'chapter_board' && input.chapterId !== null) {
    const about = { memberId: input.subjectMemberId, role: input.subjectRole };
    return electorsFor('chapter_board', input.chapterId, data, about).flatMap((id) => {
      const seats = heldPositions(id, data.positions).filter((p) => p.chapterId === input.chapterId && BOARD_ROLES.includes(p.role));
      if (seats.length === 0 || seats.some((p) => !isActing(p))) return [];
      const last = seats.map((p) => p.actingUntil!).sort().at(-1)!;
      if (!ends(last)) return [];
      return [`${nameOf(id, data)}’s acting ends ${dayMonth(last)}. Close before then, or ${nameOf(id, data)} can’t vote.`];
    });
  }
  return [];
}
