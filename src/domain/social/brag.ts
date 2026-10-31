// Bragging rights: the club's yearly awards. The board opens an award, members nominate a ride, a
// photo or a story, then vote. The database's open_award, archive_award, nominate,
// withdraw_nomination and cast_brag_vote apply the same checks with the same words, in the same
// order.

import { isRealIsoDate } from '../dates';
import { postingRulesProblem } from '../postingRules';
import { melbourneDate } from '../rides';
import { signedInProblem } from '../routes';
import type { Member, Position, Ride } from '../types';
import { isAnyBoard } from './help';
import type { ListingPhoto } from './swap';

export const MAX_AWARD_NAME = 60;
export const MAX_BRAG_TITLE = 80;
export const MAX_BRAG_STORY = 1000;
export const MAX_BRAG_REASON = 300;
export const MAX_NOMINATIONS = 3;
export const FIRST_AWARD_YEAR = 2019;

export const NOT_AWARD_RUNNER = 'Only the board can run awards.';
export const BAD_AWARD_KIND = 'Pick what the award is for.';
export const NO_AWARD_NAME = 'Give the award a name.';
export const BAD_AWARD_YEAR = 'Pick a year from 2019 on.';
export const BAD_AWARD_DATES = 'Nominations close first, then voting, both from today on.';
export const AWARD_GONE = 'No such award.';
export const AWARD_OFF = 'That award has been taken off.';
export const AWARD_OFF_ALREADY = 'That award has already been taken off.';
export const NOMINATIONS_CLOSED = 'Nominations are closed.';
export const TOO_MANY_NOMINATIONS = 'Three nominations each per award.';
export const NO_RIDE = 'Pick a ride.';
export const RIDE_NOT_IN_YEAR = 'Pick a ride from that year that’s been ridden.';
export const RIDE_NOMINATED = 'That ride is already nominated.';
export const NO_BRAG_TITLE = 'Give it a title.';
export const NO_BRAG_PHOTO = 'Add a photo.';
export const BAD_BRAG_PHOTO = 'That photo didn’t upload properly. Try again.';
export const NO_STORY = 'Tell the story.';
export const NOMINATION_GONE = 'No such nomination.';
export const NOT_NOMINATOR = 'Only whoever nominated it or the board can withdraw it.';
export const ALREADY_WITHDRAWN = 'That nomination has already been withdrawn.';
export const NOT_VOTING = 'Voting isn’t open.';
export const OWN_NOMINATION = 'You can’t vote for your own nomination.';

/** What an award is for: a club ride, a photo, or a story (best breakdown and the like). */
export type BragKind = 'ride' | 'photo' | 'story';
export const BRAG_KINDS: BragKind[] = ['ride', 'photo', 'story'];
export const BRAG_KIND_LABEL: Record<BragKind, string> = { ride: 'A ride', photo: 'A photo', story: 'A story' };

/** A photo in the nominator's own folder of the brag-media bucket. */
export type BragPhoto = ListingPhoto;

export interface Award {
  id: string;
  kind: BragKind;
  title: string;
  /** The year it covers. A ride award takes rides from this year. */
  year: number;
  /** ISO dates: nominations are open until the end of nominationsClose, voting until votingClose. */
  nominationsClose: string;
  votingClose: string;
  openedBy: string;
  archivedAt: string | null;
}

export interface AwardInput {
  kind: BragKind;
  title: string;
  year: number;
  nominationsClose: string;
  votingClose: string;
}

export interface Nomination {
  id: string;
  awardId: string;
  nominatedBy: string;
  rideId: string | null;
  title: string | null;
  photo: BragPhoto | null;
  story: string | null;
  reason: string | null;
  nominatedAt: string;
  withdrawnAt: string | null;
}

export interface NominationInput {
  awardId: string;
  rideId: string | null;
  title: string;
  photo: BragPhoto | null;
  story: string;
  reason: string;
}

export interface Vote {
  awardId: string;
  memberId: string;
  nominationId: string;
}

/** Votes for a nomination, given only once its award has closed. */
export interface Tally {
  nominationId: string;
  votes: number;
}

export type AwardPhase = 'nominating' | 'voting' | 'closed';

const chars = (s: string) => [...s].length;

export function awardPhase(a: Pick<Award, 'nominationsClose' | 'votingClose'>, today: string): AwardPhase {
  if (today <= a.nominationsClose) return 'nominating';
  if (today <= a.votingClose) return 'voting';
  return 'closed';
}

function runnerProblem(me: Member | null, positions: Position[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  return isAnyBoard(me, positions) ? null : NOT_AWARD_RUNNER;
}

export function canRunAwards(me: Member | null, positions: Position[]): boolean {
  return isAnyBoard(me, positions);
}

export function cleanAward(input: AwardInput): AwardInput {
  return { ...input, title: input.title.trim() };
}

export function openAwardProblem(me: Member | null, input: AwardInput, positions: Position[], today: string): string | null {
  const notRunner = runnerProblem(me, positions);
  if (notRunner) return notRunner;
  const c = cleanAward(input);
  if (!BRAG_KINDS.includes(c.kind)) return BAD_AWARD_KIND;
  if (!c.title) return NO_AWARD_NAME;
  if (chars(c.title) > MAX_AWARD_NAME) return `Keep the name to ${MAX_AWARD_NAME} characters at most.`;
  if (!Number.isInteger(c.year) || c.year < FIRST_AWARD_YEAR || c.year > Number(today.slice(0, 4))) return BAD_AWARD_YEAR;
  if (
    !isRealIsoDate(c.nominationsClose) ||
    !isRealIsoDate(c.votingClose) ||
    c.nominationsClose < today ||
    c.votingClose <= c.nominationsClose
  ) {
    return BAD_AWARD_DATES;
  }
  return null;
}

export function archiveAwardProblem(me: Member | null, id: string, awards: Award[], positions: Position[]): string | null {
  const notRunner = runnerProblem(me, positions);
  if (notRunner) return notRunner;
  const a = awards.find((x) => x.id === id);
  if (!a) return AWARD_GONE;
  if (a.archivedAt) return AWARD_OFF_ALREADY;
  return null;
}

/** What a nomination keeps: only the parts its award's kind uses, trimmed, blanks as none. */
export function cleanNomination(input: NominationInput, kind: BragKind): Omit<NominationInput, 'awardId' | 'title' | 'story' | 'reason'> & {
  title: string | null;
  story: string | null;
  reason: string | null;
} {
  return {
    rideId: kind === 'ride' ? input.rideId : null,
    title: kind === 'ride' ? null : input.title.trim() || null,
    photo: kind === 'photo' ? input.photo : null,
    story: kind === 'story' ? input.story.trim() || null : null,
    reason: input.reason.trim() || null,
  };
}

/** A ride from the award's year that has been ridden (today counts) and wasn't cancelled. */
export function rideFitsAward(r: Ride | undefined, year: number, today: string): r is Ride {
  if (!r || r.cancelledAt) return false;
  const on = melbourneDate(r.startsAt);
  return on <= today && Number(on.slice(0, 4)) === year;
}

export function nominationProblem(
  me: Member | null,
  input: NominationInput,
  awards: Award[],
  nominations: Nomination[],
  rides: Ride[],
  today: string,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const a = awards.find((x) => x.id === input.awardId);
  if (!a) return AWARD_GONE;
  if (a.archivedAt) return AWARD_OFF;
  if (awardPhase(a, today) !== 'nominating') return NOMINATIONS_CLOSED;
  const live = nominations.filter((n) => n.awardId === a.id && !n.withdrawnAt);
  if (live.filter((n) => n.nominatedBy === (me as Member).id).length >= MAX_NOMINATIONS) return TOO_MANY_NOMINATIONS;
  const c = cleanNomination(input, a.kind);
  if (a.kind === 'ride') {
    if (!c.rideId) return NO_RIDE;
    if (!rideFitsAward(rides.find((r) => r.id === c.rideId), a.year, today)) return RIDE_NOT_IN_YEAR;
    if (live.some((n) => n.rideId === c.rideId)) return RIDE_NOMINATED;
  } else {
    if (!c.title) return NO_BRAG_TITLE;
    if (chars(c.title) > MAX_BRAG_TITLE) return `Keep the title to ${MAX_BRAG_TITLE} characters at most.`;
    if (a.kind === 'photo') {
      if (!c.photo) return NO_BRAG_PHOTO;
      if (!c.photo.path.startsWith(`${(me as Member).id}/`)) return BAD_BRAG_PHOTO;
    } else {
      if (!c.story) return NO_STORY;
      if (chars(c.story) > MAX_BRAG_STORY) return 'Keep the story to 1,000 characters at most.';
    }
  }
  if (c.reason && chars(c.reason) > MAX_BRAG_REASON) return `Keep the reason to ${MAX_BRAG_REASON} characters at most.`;
  // Last, as the row goes in (a database trigger): agreed to the club rules for chats and posts?
  return postingRulesProblem(me);
}

export function withdrawProblem(
  me: Member | null,
  id: string,
  nominations: Nomination[],
  awards: Award[],
  positions: Position[],
  today: string,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const n = nominations.find((x) => x.id === id);
  const a = n && awards.find((x) => x.id === n.awardId);
  if (!n || !a) return NOMINATION_GONE;
  if (a.archivedAt) return AWARD_OFF;
  if (!canWithdraw(me, n, positions)) return NOT_NOMINATOR;
  if (awardPhase(a, today) !== 'nominating') return NOMINATIONS_CLOSED;
  if (n.withdrawnAt) return ALREADY_WITHDRAWN;
  return null;
}

export function canWithdraw(me: Member | null, n: Nomination, positions: Position[]): boolean {
  return !!me && (n.nominatedBy === me.id || isAnyBoard(me, positions));
}

export function voteProblem(me: Member | null, nominationId: string, nominations: Nomination[], awards: Award[], today: string): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const n = nominations.find((x) => x.id === nominationId && !x.withdrawnAt);
  const a = n && awards.find((x) => x.id === n.awardId && !x.archivedAt);
  if (!n || !a) return NOMINATION_GONE;
  if (awardPhase(a, today) !== 'voting') return NOT_VOTING;
  if (n.nominatedBy === (me as Member).id) return OWN_NOMINATION;
  return null;
}

export interface Result {
  nomination: Nomination;
  votes: number;
  /** The most votes, more than none. Ties share it. */
  winner: boolean;
}

/** A closed award's nominations with their votes, the most first. */
export function results(nominations: Nomination[], tallies: Tally[]): Result[] {
  const count = new Map(tallies.map((t) => [t.nominationId, t.votes]));
  const list = nominations
    .filter((n) => !n.withdrawnAt)
    .map((n) => ({ nomination: n, votes: count.get(n.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);
  const top = list[0]?.votes ?? 0;
  return list.map((r) => ({ ...r, winner: top > 0 && r.votes === top }));
}

/** Open awards (nominating or voting) by the next day something closes, then past ones newest first. */
export function awardsFor(awards: Award[], today: string): { open: Award[]; past: Award[] } {
  const shown = awards.filter((a) => !a.archivedAt);
  const next = (a: Award) => (awardPhase(a, today) === 'nominating' ? a.nominationsClose : a.votingClose);
  return {
    open: shown.filter((a) => awardPhase(a, today) !== 'closed').sort((a, b) => next(a).localeCompare(next(b))),
    past: shown.filter((a) => awardPhase(a, today) === 'closed').sort((a, b) => b.votingClose.localeCompare(a.votingClose)),
  };
}
