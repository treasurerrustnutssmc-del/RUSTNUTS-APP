import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import type { ActingRequest, ClubData, CrewSpot, LicenceClass, Meeting, MeetingKind, Member, MemberPrivate, Position, PositionRole, Ride, Vote } from './types';
import {
  ACTING_CHAPTER_ONLY,
  ACTING_COMBINED,
  ACTING_END_NEEDS_VOTE,
  ACTING_FAMILY,
  ACTING_LICENCE_VACANCY,
  actingCap,
  actingDefaultUntil,
  actingElectors,
  actingNeedsVote,
  actingProblem,
  actingRideWarning,
  actingWarnings,
  appointActingProblem,
  ASKED_RECENTLY,
  AUDITOR_STAYS_OUT,
  auditorStaysOut,
  BOARD_RECORDS_ACTING,
  BOARD_TWO_YEARS,
  BOOKS_NOT_CHAIR,
  CHAIR_NOT_BOOKS,
  CONFIRM_NOT_HOLDER,
  CONFIRM_NOT_STANDIN,
  confirmActingProblem,
  COVER_BOARD_SEATS,
  COVER_FROM_BOARD,
  EARLIER_WHO,
  ENDED_BY_VOTE,
  HIATUS_NO_LEAD,
  LATER_WHO_EMPTY,
  laterWhoCover,
  LICENCE_ENDS,
  necBallotsWait,
  NEEDS_ACTING_VOTE,
  NO_REQUEST,
  NOT_ACTING,
  NOT_YOURSELF,
  ONE_STINT,
  OWN_SEAT_COVERED,
  OWN_SEAT_ONLY,
  PRESIDENT_NEEDS_BOARD_VOTE,
  RECORD_INSTEAD,
  REPLACE_NEEDS_END,
  requestActingProblem,
  requestCoverProblem,
  requestNeedsVote,
  RUN_OVER,
  SEAT_ENDED,
  SEAT_HAS_ACTING,
  SEAT_HAS_HOLDER,
  SERVED_TERM_FIRST,
  setActingUntilProblem,
  SMALL_BOARD,
  UNTIL_NOT_PAST,
  untilRange,
  VOTED_NEEDS_NEW_VOTE,
  WHY_NEEDED,
  WITHDRAW_WHO,
  withdrawRequestProblem,
  accessLevel,
  appointProblem,
  appointWarnings,
  AUDITOR_NEEDS_VOTE,
  BOARD_SEAT_NEEDS_VOTE,
  canApprove,
  canManageMember,
  statusChangeProblem,
  canSeeMember,
  canSeePhone,
  canSeePrivate,
  decidedNoticeFor,
  endTermProblem,
  hasCarriedRemovalVote,
  isBoardOf,
  isNational,
  isNecOfficer,
  PRESIDENT_ENDED_BY,
  PRESIDENT_NEEDS_VOTE,
  ROLE_NEEDS_VOTE,
  seesBoardOf,
  seesEveryChapter,
  pendingFor,
  SECRETARY_NEEDS_VOTE,
  DOWNWARD_NEEDS_NOTICE,
  visibleMembers,
  withHolders,
} from './access';
import { isChapterless } from './labels';
import { settleActing } from './acting';
import { canRunCheckin } from './attendance';
import { managesBus } from './bus';
import { isFeedbackKeeper } from './feedback';
import { isRideLeader } from './liveRide';
import { holdsShopSeat } from './shop';
import { isAnyBoard } from './social/help';
import { electorsFor } from './votes';

const d = DEMO_DATA;
const TODAY = '2026-10-29';
const m = (id: string) => {
  const found = d.members.find((x) => x.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};
const P = d.positions;

test('access levels follow positions and approval', () => {
  assert.equal(accessLevel(null, P), 'public');
  assert.equal(accessLevel(m('m-dylan'), P), 'pending');
  assert.equal(accessLevel(m('m-spanner'), P), 'member'); // Tail Gunner is not a board seat
  assert.equal(accessLevel(m('m-chook'), P), 'member'); // Officer is not a board seat
  assert.equal(accessLevel(m('m-torque'), P), 'board');
  assert.equal(accessLevel(m('m-crank'), P), 'board');
  assert.equal(accessLevel(m('m-rusty'), P), 'national'); // NEC chair
  assert.equal(accessLevel(m('m-smokey'), P), 'national'); // sitting presidents sit on the NEC
});

test('ended positions stop counting', () => {
  const ended = P.map((p) => (p.memberId === 'm-torque' ? { ...p, endedOn: '2026-08-01' } : p));
  assert.equal(accessLevel(m('m-torque'), ended), 'member');
});

test('board power is limited to their own chapter', () => {
  assert.equal(isBoardOf(m('m-torque'), 'ch-west', P), true);
  assert.equal(isBoardOf(m('m-torque'), 'ch-north', P), false);
  assert.equal(isBoardOf(m('m-rusty'), 'ch-north', P), false); // national doesn't act as another chapter's board
  assert.equal(isBoardOf(m('m-rusty'), 'ch-west', P), true); // his own seat
  assert.equal(isBoardOf(m('m-spanner'), 'ch-west', P), false);
});

test('pending applicants are only seen by their chapter board', () => {
  const dylan = m('m-dylan'); // West applicant
  assert.equal(canSeeMember(m('m-spanner'), dylan, P), false);
  assert.equal(canSeeMember(m('m-crank'), dylan, P), false); // North board
  assert.equal(canSeeMember(m('m-torque'), dylan, P), true); // West board
  assert.equal(canSeeMember(m('m-smokey'), dylan, P), true); // NEC
  assert.equal(canSeeMember(dylan, dylan, P), true);
  assert.equal(canSeeMember(null, m('m-spanner'), P), false); // public sees no directory
});

test('applicants see nobody else', () => {
  assert.deepEqual(
    visibleMembers(m('m-dylan'), d).map((x) => x.id),
    ['m-dylan'],
  );
});

test('phone numbers respect the share setting', () => {
  assert.equal(canSeePhone(m('m-chook'), m('m-spanner'), P), true); // Spanner shares
  assert.equal(canSeePhone(m('m-chook'), m('m-gravel'), P), false); // Gravel doesn't
  assert.equal(canSeePhone(m('m-torque'), m('m-gravel'), P), true); // West board sees it anyway
  assert.equal(canSeePhone(m('m-crank'), m('m-gravel'), P), false); // North board does not
});

test('private details are self and chapter board only', () => {
  assert.equal(canSeePrivate(m('m-spanner'), m('m-spanner'), P), true);
  assert.equal(canSeePrivate(m('m-chook'), m('m-spanner'), P), false);
  assert.equal(canSeePrivate(m('m-torque'), m('m-spanner'), P), true);
  assert.equal(canSeePrivate(m('m-jet'), m('m-spanner'), P), false);
});

test('approvals and member changes', () => {
  assert.equal(canApprove(m('m-torque'), m('m-dylan'), P), true);
  assert.equal(canApprove(m('m-torque'), m('m-josh'), P), false); // North applicant
  assert.equal(canApprove(m('m-torque'), m('m-spanner'), P), false); // already approved
  assert.deepEqual(pendingFor(m('m-torque'), d).map((x) => x.id), ['m-dylan']);
  assert.deepEqual(pendingFor(m('m-rusty'), d).map((x) => x.id), ['m-dylan'], 'only the chapter he sits on');
  assert.equal(canManageMember(m('m-torque'), m('m-spanner'), P), true);
  assert.equal(canManageMember(m('m-torque'), m('m-torque'), P), false); // no self-promotion
  assert.equal(canManageMember(m('m-spanner'), m('m-chook'), P), false);
});


test('a board cannot manage an applicant who has not been approved yet', () => {
  assert.equal(canManageMember(m('m-torque'), m('m-dylan'), P), false);
});

test('only National Chairman, Secretary or Auditor count as NEC officers', () => {
  assert.equal(isNecOfficer('m-rusty', P), true); // NEC chair
  assert.equal(isNecOfficer('m-smokey', P), false); // a President sits on the NEC but is not an officer
  assert.equal(isNecOfficer('m-torque', P), false);
});

const allowed = (problem: string | null) => problem === null;

test('a chapter board appoints its own members to non-President roles', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'officer', d, TODAY)), true);
});

test('nobody appoints themselves', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-torque'), 'ch-west', 'officer', d, TODAY)), false);
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-rusty'), null, 'nec_auditor', d, TODAY)), false);
});

test('a chapter seat only goes to a member of that chapter', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-jet'), 'ch-west', 'officer', d, TODAY)), false);
  // not even when national does the appointing
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-jet'), 'ch-west', 'officer', d, TODAY)), false);
});

test('applicants cannot be appointed', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-dylan'), 'ch-west', 'officer', d, TODAY)), false);
});

test('a member cannot hold the same open role twice', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-chook'), 'ch-west', 'officer', d, TODAY)), false);
});

test('only the National Chairman hands out the other national roles, and the Secretary after the NEC’s two-thirds vote (11.6)', () => {
  const today = '2026-10-29';
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), null, 'nec_secretary', d, today)), false);
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-spanner'), null, 'nec_secretary', d, today)), false); // a President
  assert.equal(appointProblem(m('m-rusty'), m('m-spanner'), null, 'nec_secretary', d, today), SECRETARY_NEEDS_VOTE); // the Chairman, once the NEC has voted
  const secretaryVote: Vote = {
    id: 'v-sec', chapterId: null, meetingId: null, subjectMemberId: 'm-spanner', subjectRole: 'nec_secretary', question: 'Appoint Spanner as National Secretary?',
    details: null, electorate: 'nec', threshold: 'two_thirds', secret: false, quorum: 1, openedAt: '2026-10-10T00:00:00.000Z',
    closesAt: '2026-10-20T00:00:00.000Z', closedAt: '2026-10-20T00:00:00.000Z', result: 'carried', castingVote: null, tally: null,
    electorIds: ['m-smokey'], votedIds: ['m-smokey'], ballots: [], createdBy: 'm-rusty',
  };
  const voted = { ...d, votes: [...(d.votes ?? []), secretaryVote] };
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-spanner'), null, 'nec_secretary', voted, today)), true);
  const freeAuditor = { ...voted, positions: voted.positions.filter((p) => p.role !== 'nec_auditor') };
  assert.equal(appointProblem(m('m-rusty'), m('m-spanner'), null, 'nec_auditor', freeAuditor, today), AUDITOR_NEEDS_VOTE, 'a Secretary vote is not an Auditor vote');
  const auditorVoted = { ...d, votes: [{ ...secretaryVote, subjectRole: 'nec_auditor' as const }] };
  assert.equal(appointProblem(m('m-rusty'), m('m-spanner'), null, 'nec_secretary', auditorVoted, today), SECRETARY_NEEDS_VOTE);
});

test('nobody seats a National Chairman in the app; that follows the vote, recorded by the admin', () => {
  const noChair = { ...d, positions: P.map((p): Position => (p.id === 'p-2' ? { ...p, endedOn: '2026-10-01' } : p)) };
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-jet'), null, 'nec_chair', noChair, TODAY)), false);
});

test('only the Chairman ends a national role, and nobody ends the Chairman\'s', () => {
  const withSecretary = {
    ...d,
    positions: [...P, { id: 'p-sec', memberId: 'm-jet', chapterId: null, role: 'nec_secretary' as const, startedOn: '2025-08-16', endedOn: null }],
  };
  const sec = withSecretary.positions.find((p) => p.id === 'p-sec')!;
  assert.equal(allowed(endTermProblem(m('m-rusty'), sec, withSecretary, TODAY)), true); // Chairman ends the Secretary's
  assert.equal(allowed(endTermProblem(m('m-smokey'), sec, withSecretary, TODAY)), false); // a President can't
  assert.equal(allowed(endTermProblem(m('m-jet'), pos('p-2'), withSecretary, TODAY)), false); // Secretary can't end the Chairman's
  assert.equal(allowed(endTermProblem(m('m-smokey'), pos('p-2'), d, TODAY)), false); // nor can a President
  assert.equal(allowed(endTermProblem(m('m-jet'), sec, withSecretary, TODAY)), true); // the Secretary steps down herself (9.3)
  assert.equal(allowed(endTermProblem(m('m-rusty'), pos('p-2'), d, TODAY)), false); // not even the Chairman ends his own seat here
  // Suspended, she can still step down from her own seat (ChatGPT audit F10), but can't end anyone else's.
  const suspendedJet = { ...m('m-jet'), approval: 'suspended' as const };
  assert.equal(endTermProblem(suspendedJet, sec, withSecretary, TODAY), null);
  assert.equal(endTermProblem({ ...m('m-rusty'), approval: 'suspended' as const }, sec, withSecretary, TODAY), 'Only approved members can do that.');
});

// West President seat vacated: Rusty's term ended, he stays National Chair.
const vacantWest = {
  ...d,
  positions: P.map((p): Position => (p.id === 'p-1' ? { ...p, endedOn: '2026-10-01' } : p)),
};

test('only NEC officers seat a President', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'president', vacantWest, TODAY)), false);
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-spanner'), 'ch-west', 'president', vacantWest, TODAY)), false);
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-spanner'), 'ch-west', 'president', vacantWest, TODAY)), true);
});

const pos = (id: string) => {
  const found = P.find((p) => p.id === id);
  if (!found) throw new Error(`no position ${id}`);
  return found;
};

/** A carried removal vote about a term (9.3), closed on `closedAt`. */
const removal = (p: Position, over: Partial<Vote> = {}): Vote => {
  const boardSeat = ['president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'].includes(p.role);
  return {
    id: `rv-${p.id}`, chapterId: p.chapterId, meetingId: null, subjectMemberId: p.memberId, subjectRole: p.role,
    question: 'Remove them?', details: null, electorate: boardSeat ? 'chapter_patched' : 'chapter_board',
    threshold: boardSeat ? 'two_thirds' : 'majority', secret: false, quorum: 3, openedAt: '2026-10-20T08:00:00.000Z',
    closesAt: '2026-10-27T08:00:00.000Z', closedAt: '2026-10-27T08:00:00.000Z', result: 'carried', castingVote: null,
    tally: { yes: 4, no: 1, abstain: 0 }, electorIds: [], votedIds: [], ballots: [], createdBy: 'm-torque', ...over,
  };
};
const withVotes = (...votes: Vote[]) => ({ ...d, votes: [...(d.votes ?? []), ...votes] });

test('anyone steps down from their own role; ending someone else’s chapter role follows a board majority vote (9.3)', () => {
  assert.equal(endTermProblem(m('m-torque'), pos('p-3'), d, TODAY), null, 'her own Secretary term: stepping down is free');
  assert.equal(endTermProblem(m('m-spanner'), pos('p-7'), d, TODAY), null, 'the Tail Gunner steps down');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), d, TODAY), ROLE_NEEDS_VOTE, 'no vote yet');
  assert.equal(endTermProblem(m('m-crank'), pos('p-7'), d, TODAY), 'Only that chapter’s board can end this term.', 'North board, West seat');
  assert.equal(endTermProblem(m('m-smokey'), pos('p-7'), d, TODAY), 'Only that chapter’s board can end this term.', 'a President off the board');
  assert.equal(endTermProblem(m('m-chook'), pos('p-7'), d, TODAY), 'Only that chapter’s board can end this term.', 'a member');
  const carried = withVotes(removal(pos('p-7')));
  assert.equal(hasCarriedRemovalVote(pos('p-7'), carried, TODAY), true);
  assert.equal(hasCarriedRemovalVote(pos('p-8'), carried, TODAY), false, 'not for another term');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), carried, TODAY), null, 'the board records the removal');
  assert.equal(endTermProblem(m('m-rusty'), pos('p-7'), carried, TODAY), null, 'the President sits on the board too');
  assert.equal(endTermProblem(m('m-chook'), pos('p-7'), carried, TODAY), 'Only that chapter’s board can end this term.', 'still the board’s to record');
  // The vote has to be the right shape, recent, and about this term.
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { electorate: 'chapter_patched', threshold: 'two_thirds' })), TODAY), ROLE_NEEDS_VOTE, 'wrong shape');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { result: 'lost' })), TODAY), ROLE_NEEDS_VOTE, 'lost');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { closedAt: null, result: null })), TODAY), ROLE_NEEDS_VOTE, 'still open');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { closedAt: '2026-07-30T08:00:00.000Z' })), TODAY), ROLE_NEEDS_VOTE, '91 days old');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { closedAt: '2026-07-31T08:00:00.000Z' })), TODAY), null, '90 days old');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { closedAt: '2025-08-15T08:00:00.000Z' })), '2025-08-20'), ROLE_NEEDS_VOTE, 'closed before the term began');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { subjectRole: 'officer' })), TODAY), ROLE_NEEDS_VOTE, 'about another role');
  assert.equal(endTermProblem(m('m-torque'), pos('p-7'), withVotes(removal(pos('p-7'), { chapterId: 'ch-north' })), TODAY), ROLE_NEEDS_VOTE, 'another chapter’s vote');
});

test('removing a board member takes two-thirds of the chapter’s Full Members (9.3)', () => {
  assert.equal(endTermProblem(m('m-rusty'), pos('p-4'), d, TODAY), BOARD_SEAT_NEEDS_VOTE, 'Diesel, Road Captain: no vote yet');
  assert.equal(endTermProblem(m('m-diesel'), pos('p-4'), d, TODAY), null, 'Diesel steps down');
  assert.equal(endTermProblem(m('m-rusty'), pos('p-4'), withVotes(removal(pos('p-4'), { electorate: 'chapter_board', threshold: 'majority' })), TODAY), BOARD_SEAT_NEEDS_VOTE, 'a board majority isn’t enough');
  assert.equal(endTermProblem(m('m-rusty'), pos('p-4'), withVotes(removal(pos('p-4'))), TODAY), null, 'after the two-thirds vote');
  assert.equal(endTermProblem(m('m-smokey'), pos('p-4'), withVotes(removal(pos('p-4'))), TODAY), 'Only that chapter’s board can end this term.', 'the Chairman or another President doesn’t record it');
});

test('a President goes after the same two-thirds vote, recorded by the board or an NEC officer (9.3)', () => {
  assert.equal(endTermProblem(m('m-rusty'), pos('p-9'), d, TODAY), PRESIDENT_NEEDS_VOTE, 'the Chairman needs the vote');
  assert.equal(endTermProblem(m('m-torque'), pos('p-1'), d, TODAY), PRESIDENT_NEEDS_VOTE, 'so does the board');
  assert.equal(endTermProblem(m('m-smokey'), pos('p-1'), d, TODAY), PRESIDENT_ENDED_BY, 'another President is neither');
  assert.equal(endTermProblem(m('m-chook'), pos('p-1'), d, TODAY), PRESIDENT_ENDED_BY, 'nor is a member');
  assert.equal(endTermProblem(m('m-rusty'), pos('p-1'), d, TODAY), null, 'his own: stepping down is free');
  assert.equal(endTermProblem(m('m-smokey'), pos('p-9'), d, TODAY), null, 'Smokey steps down');
  const north = withVotes(removal(pos('p-9')));
  assert.equal(endTermProblem(m('m-rusty'), pos('p-9'), north, TODAY), null, 'the Chairman records it');
  assert.equal(endTermProblem(m('m-crank'), pos('p-9'), north, TODAY), null, 'so does North’s board');
  assert.equal(endTermProblem(m('m-torque'), pos('p-9'), north, TODAY), PRESIDENT_ENDED_BY, 'not West’s');
});

test('an ended term cannot be ended again', () => {
  const ended = { ...pos('p-7'), endedOn: '2026-09-01' };
  const data = { ...d, positions: P.map((p) => (p.id === 'p-7' ? ended : p)) };
  assert.equal(allowed(endTermProblem(m('m-torque'), ended, data, TODAY)), false);
});

test('seat holders the viewer cannot see are left out instead of crashing', () => {
  const seats = [
    { id: 's1', memberId: 'm-torque', chapterId: 'ch-west', role: 'secretary' as const, startedOn: '2025-08-16', endedOn: null },
    { id: 's2', memberId: 'm-gone', chapterId: 'ch-west', role: 'officer' as const, startedOn: '2025-08-16', endedOn: null },
  ];
  assert.deepEqual(withHolders(seats, d.members).map((x) => [x.position.id, x.member.id]), [['s1', 'm-torque']]);
});

test('Founder is an honour: no powers, and nobody hands it out or ends it in the app', () => {
  const withFounder = {
    ...d,
    positions: [...P, { id: 'p-founder', memberId: 'm-spanner', chapterId: null, role: 'founder' as const, startedOn: '2019-01-01', endedOn: null }],
  };
  assert.equal(accessLevel(m('m-spanner'), withFounder.positions), 'member');
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-chook'), null, 'founder', d, TODAY)), false);
  assert.equal(allowed(endTermProblem(m('m-rusty'), withFounder.positions.find((p) => p.id === 'p-founder')!, withFounder, TODAY)), false);
});

test('Ride Committee and Assistant Tail Gunner are ordinary chapter roles', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'ride_committee', d, TODAY)), true);
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'assistant_tail_gunner', d, TODAY)), true);
});

test('Founder is a title: it carries no chapter and no national powers', () => {
  const founderOnly = [
    { id: 'f1', memberId: 'm-spanner', chapterId: null, role: 'founder' as const, startedOn: '2019-05-11', endedOn: null },
  ];
  assert.equal(accessLevel(m('m-spanner'), founderOnly), 'member');
  assert.equal(isChapterless('founder'), true);
  assert.equal(isChapterless('nec_chair'), true);
  assert.equal(isChapterless('ride_committee'), false);
  assert.equal(isChapterless('assistant_tail_gunner'), false);
});

test('national roles see every chapter’s board records, and act only where they hold a seat', () => {
  assert.equal(seesBoardOf(m('m-rusty'), 'ch-north', P), true); // National Chairman and West President
  assert.equal(seesBoardOf(m('m-smokey'), 'ch-west', P), true); // North's President sits on the NEC
  assert.equal(seesBoardOf(m('m-torque'), 'ch-west', P), true);
  assert.equal(seesBoardOf(m('m-torque'), 'ch-north', P), false);
  assert.equal(seesBoardOf(m('m-spanner'), 'ch-west', P), false);
  assert.equal(seesBoardOf(m('m-dylan'), 'ch-west', P), false); // an applicant
  assert.equal(seesBoardOf(null, 'ch-west', P), false);
  assert.equal(canSeePrivate(m('m-smokey'), m('m-spanner'), P), true, 'reads a West member’s private details');
  assert.equal(canManageMember(m('m-smokey'), m('m-spanner'), P), true, 'opens Manage member (the NEC’s own acts live there)');
  assert.equal(
    statusChangeProblem(m('m-smokey'), m('m-spanner'), 'supporter', d, '2026-10-29'),
    'Only that chapter’s board can change this member’s status.',
    'but the chapter’s acts on it refuse them',
  );
  // An applicant who isn't approved yet is the board's to approve first, not a 5.6 reinstatement.
  assert.equal(statusChangeProblem(m('m-torque'), m('m-dylan'), 'full', d, '2026-10-29'), 'Approve them first.');
  assert.equal(statusChangeProblem(m('m-smokey'), m('m-dylan'), 'full', d, '2026-10-29'), 'Only that chapter’s board can change this member’s status.');
});

test('moving an FNG, Full Member or Nomad down to Supporter, Legacy or FNG follows a decided 5.5 notice, unless it’s at their request (L2, deep audit F2)', () => {
  const torque = m('m-torque');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'supporter', d, TODAY), DOWNWARD_NEEDS_NOTICE, 'an FNG, no notice decided');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'supporter', d, TODAY, true), null, 'at her request');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'legacy', d, TODAY), DOWNWARD_NEEDS_NOTICE, 'Legacy is a step down too');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'legacy', d, TODAY, true), null, 'Legacy at her request');
  assert.equal(statusChangeProblem(m('m-smokey'), m('m-ratchet'), 'supporter', d, TODAY), DOWNWARD_NEEDS_NOTICE, 'a Nomad');
  assert.equal(statusChangeProblem(torque, m('m-patches'), 'fng', d, TODAY), null, 'a Supporter becomes an FNG');
  // Gravel's open notice doesn't count; a decided one within 90 days does, an older one doesn't.
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', d, TODAY), 'End their positions first.', 'the position check still comes first');
  const noSeat = { ...d, positions: d.positions.filter((p) => p.id !== 'p-6') };
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', noSeat, TODAY), DOWNWARD_NEEDS_NOTICE, 'the notice is still open');
  assert.equal(decidedNoticeFor('m-gravel', noSeat, TODAY), null);
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'fng', noSeat, TODAY), DOWNWARD_NEEDS_NOTICE, 'a Full Member back to FNG');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'legacy', noSeat, TODAY), DOWNWARD_NEEDS_NOTICE, 'a Full Member to Legacy');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'legacy', noSeat, TODAY, true), null, 'Legacy at his request');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'nomad', noSeat, TODAY), null, 'Nomad is sideways, not down');
  const decided = (closedOn: string) => ({
    ...noSeat,
    statusNotices: noSeat.statusNotices!.map((n) => ({ ...n, outcome: 'decided' as const, closedOn, closedBy: 'm-torque' })),
  });
  assert.equal(decidedNoticeFor('m-gravel', decided('2026-10-20'), TODAY)?.id, 'sn-gravel');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', decided('2026-10-20'), TODAY), null, 'after the decided notice');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', decided('2026-07-31'), TODAY), null, '90 days is still in time');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', decided('2026-07-30'), TODAY), DOWNWARD_NEEDS_NOTICE, '91 days is stale');
  assert.equal(statusChangeProblem(m('m-smokey'), m('m-gravel'), 'supporter', decided('2026-10-20'), TODAY), 'Only that chapter’s board can change this member’s status.', 'the board gate comes first');
});

// Suspending and restoring a member's app access (App Review Guideline 1.2)
test('suspend and restore app access: the chapter board only, not yourself, and only from the right state', async () => {
  const { suspendAccessProblem, restoreAccessProblem } = await import('./access');
  const mk = (id: string, over: Partial<Member> = {}): Member => ({
    id, chapterId: 'ch-west', fullName: id, roadName: null, status: 'full', approval: 'approved', joinedOn: '2024-01-01',
    patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false, ...over,
  });
  const sec = mk('sec');
  const pres = mk('pres', { chapterId: 'ch-north' });
  const target = mk('target');
  const benched = mk('benched', { approval: 'suspended' });
  const positions: Position[] = [
    { id: 'p1', memberId: 'sec', chapterId: 'ch-west', role: 'secretary', startedOn: '2025-01-01', endedOn: null },
    { id: 'p2', memberId: 'pres', chapterId: 'ch-north', role: 'president', startedOn: '2025-01-01', endedOn: null },
  ];
  assert.equal(suspendAccessProblem(sec, target, positions), null);
  assert.equal(suspendAccessProblem(null, target, positions), 'Sign in first.');
  assert.equal(suspendAccessProblem(mk('p', { approval: 'pending' }), target, positions), 'Only approved members can do that.');
  assert.equal(suspendAccessProblem(sec, undefined, positions), 'That member no longer exists.');
  assert.equal(suspendAccessProblem(sec, sec, positions), 'You can’t suspend your own access.');
  assert.equal(suspendAccessProblem(pres, target, positions), 'Only that member’s chapter board can do that.');
  assert.equal(suspendAccessProblem(mk('plain'), target, positions), 'Only that member’s chapter board can do that.');
  assert.equal(suspendAccessProblem(sec, benched, positions), 'They’re not an approved member.');
  assert.equal(restoreAccessProblem(sec, benched, positions), null);
  assert.equal(restoreAccessProblem(sec, target, positions), 'Their access isn’t suspended.');
  assert.equal(restoreAccessProblem(sec, sec, positions), 'You can’t restore your own access.');
  assert.equal(restoreAccessProblem(pres, benched, positions), 'Only that member’s chapter board can do that.');
});

// ---------------------------------------------------------------------------
// Acting: the four readings (held, board member, duties, club-wide), as the database's views
// ---------------------------------------------------------------------------

/** Jet (North's VP) covers Smokey's President seat while he's away; Crank recorded it. */
const jetCoversSmokey: Position = {
  id: 'p-jet-covers-smokey', memberId: 'm-jet', chapterId: 'ch-north', role: 'president', startedOn: '2026-10-20', endedOn: null,
  actingUntil: '2026-11-20', covers: 'p-9', actingWhy: 'Smokey overseas', appointedBy: 'm-crank',
};
/** Torque (West's Secretary) covers Sparks's Treasurer seat. */
const torqueCoversSparks: Position = {
  id: 'p-torque-covers-sparks', memberId: 'm-torque', chapterId: 'ch-west', role: 'treasurer', startedOn: '2026-10-20', endedOn: null,
  actingUntil: '2026-11-20', covers: 'p-5', actingWhy: 'Sparks overseas', appointedBy: 'm-rusty',
};
const COVERED = [...P, jetCoversSmokey];
const coveredData = { ...d, positions: COVERED };

test('a covered President keeps the board level and board records and is off the NEC', () => {
  const smokey = m('m-smokey');
  assert.equal(accessLevel(smokey, COVERED), 'board');
  assert.equal(isBoardOf(smokey, 'ch-north', COVERED), true, 'still acts as the board');
  assert.equal(seesBoardOf(smokey, 'ch-north', COVERED), true, 'still reads North’s board records');
  assert.equal(canSeePrivate(smokey, m('m-crank'), COVERED), true);
  assert.equal(isNational(smokey.id, COVERED), false, 'the NEC seat goes to the stand-in');
  assert.equal(seesBoardOf(smokey, 'ch-west', COVERED), false, 'nor every chapter’s records');
  assert.equal(seesEveryChapter(smokey, COVERED), false);
});

test('an Acting President is national but sees no other chapter’s private details', () => {
  const jet = m('m-jet');
  assert.equal(isNational(jet.id, COVERED), true, 'takes part in NEC business (11.2)');
  assert.equal(accessLevel(jet, COVERED), 'national');
  assert.equal(seesEveryChapter(jet, COVERED), false);
  assert.equal(seesBoardOf(jet, 'ch-west', COVERED), false);
  assert.equal(canSeePrivate(jet, m('m-torque'), COVERED), false, 'a West member’s private details');
  assert.equal(canManageMember(jet, m('m-torque'), COVERED), false);
  assert.equal(canSeePrivate(jet, m('m-crank'), COVERED), true, 'his own chapter’s, as a board member');
  // The club-wide seats still see every chapter: a sitting President, the Chairman.
  assert.equal(seesEveryChapter(m('m-smokey'), P), true);
  assert.equal(seesEveryChapter(m('m-rusty'), COVERED), true);
  assert.equal(seesEveryChapter(m('m-ace'), P), false, 'the Auditor reviews but isn’t on the NEC');
  assert.equal(seesEveryChapter(m('m-torque'), P), false);
  assert.equal(seesEveryChapter(null, P), false);
});

test('empty-seat acting makes a board member; a settled lapsed one doesn’t', () => {
  // West has no Vice President; Chook (an Officer) acts in the seat.
  const chookVp: Position = {
    id: 'p-chook-vp', memberId: 'm-chook', chapterId: 'ch-west', role: 'vice_president', startedOn: '2026-10-01', endedOn: null,
    actingUntil: '2026-11-30', actingWhy: 'No VP since the ACM',
  };
  const acting = [...P, chookVp];
  assert.equal(accessLevel(m('m-chook'), acting), 'board');
  assert.equal(isBoardOf(m('m-chook'), 'ch-west', acting), true);
  const lapsed = settleActing({ ...d, positions: [...P, { ...chookVp, actingUntil: '2026-10-28' }] }, TODAY).positions;
  assert.equal(accessLevel(m('m-chook'), lapsed), 'member');
  assert.equal(isBoardOf(m('m-chook'), 'ch-west', lapsed), false);
});

test('board-member mirrors count a covered holder; club-wide mirrors skip acting rows', () => {
  const smokey = m('m-smokey');
  // Board member: a distinct person with a held board row, covered or not.
  assert.equal(isAnyBoard(smokey, COVERED), true);
  assert.equal(managesBus(smokey, coveredData), true);
  assert.equal(canRunCheckin(smokey, null, COVERED), true, 'a whole-club ride');
  assert.equal(canRunCheckin(smokey, 'ch-north', COVERED), true);
  assert.equal(isRideLeader(smokey.id, COVERED), true);
  assert.deepEqual(electorsFor('chapter_board', 'ch-north', coveredData), ['m-crank', 'm-jet', 'm-smokey'], 'one ballot each, no second one for Jet');
  // Club-wide: duty rows that aren't acting. The shop and the feedback inbox are club-wide.
  assert.equal(holdsShopSeat(m('m-jet'), COVERED), false, 'an Acting President');
  assert.equal(holdsShopSeat(smokey, COVERED), false, 'a covered President');
  assert.equal(holdsShopSeat(m('m-rusty'), COVERED), true);
  const books = [...P, torqueCoversSparks];
  assert.equal(isFeedbackKeeper(m('m-torque'), books), false, 'an Acting Treasurer');
  assert.equal(isFeedbackKeeper(m('m-sparks'), books), false, 'a covered Treasurer');
  assert.equal(isFeedbackKeeper(m('m-sparks'), P), true);
});

test('holdProblem: a covered Treasurer can’t be seated as Auditor', () => {
  const data = { ...d, positions: [...P, torqueCoversSparks] };
  assert.equal(
    appointProblem(m('m-rusty'), m('m-sparks'), null, 'nec_auditor', data, TODAY),
    'The National Auditor can’t also be a President or Treasurer (11.8).',
  );
});

test('an acting Officer, or a covered holder, must end their positions first', () => {
  const ratchetOfficer: Position = {
    id: 'p-ratchet-officer', memberId: 'm-ratchet', chapterId: 'ch-north', role: 'officer', startedOn: '2026-10-01', endedOn: null,
    actingUntil: '2026-11-30', actingWhy: 'No Officer since the ACM',
  };
  const acting = { ...d, positions: [...P, ratchetOfficer] };
  assert.equal(statusChangeProblem(m('m-smokey'), m('m-ratchet'), 'supporter', acting, TODAY, true), 'End their positions first.');
  const covered = { ...d, positions: [...P, torqueCoversSparks] };
  assert.equal(statusChangeProblem(m('m-rusty'), m('m-sparks'), 'supporter', covered, TODAY, true), 'End their positions first.');
});

test('a stint isn’t a 9.4 served term', () => {
  const NINE_FOUR = 'A President or Vice President should have served a full term in another board seat, unless they’re a founding officer or the NEC gave an exemption (9.4).';
  // A row long enough to be a full term (no stint runs this long; the rule is what's checked).
  const long: Position = {
    id: 'p-crank-old-treasurer', memberId: 'm-crank', chapterId: 'ch-north', role: 'treasurer', startedOn: '2022-07-01', endedOn: '2024-08-01',
  };
  const served = { ...d, positions: [...P, long] };
  assert.ok(!appointWarnings(m('m-crank'), 'president', served, TODAY).includes(NINE_FOUR), 'a full term in another seat');
  const stint = { ...d, positions: [...P, { ...long, actingUntil: '2024-07-31', actingWhy: 'No Treasurer since the ACM', endedReason: 'lapsed' as const }] };
  assert.ok(appointWarnings(m('m-crank'), 'president', stint, TODAY).includes(NINE_FOUR), 'acting there isn’t one');
});

// ---------------------------------------------------------------------------
// Acting rules: the same order and words as the database's acting RPCs and writers
// (supabase/migrations/20270870000000_acting_roles.sql §4, §5). The fixture mirrors
// supabase/tests/acting_test.sql's: North has Smokey (President), Jet (VP), Crank (Road Captain),
// Lou (National Secretary), Ned and Gus (no seat); West has Rusty (President), Torque (Secretary),
// Penny (Treasurer), Spanner and Hal (no seat) and Kim (National Auditor).
// ---------------------------------------------------------------------------

const AT = '2026-11-15';
const UNTIL = '2026-12-13';
const RIDERS: [string, string][] = [
  ['smokey', 'north'], ['jet', 'north'], ['crank', 'north'], ['lou', 'north'], ['ned', 'north'], ['gus', 'north'],
  ['rusty', 'west'], ['torque', 'west'], ['penny', 'west'], ['spanner', 'west'], ['hal', 'west'], ['kim', 'west'],
];
const rider = (id: string, chapterId: string): Member => ({
  id, chapterId, fullName: `${id[0].toUpperCase()}${id.slice(1)} Rider`, roadName: null, status: 'full', approval: 'approved',
  joinedOn: '2023-01-01', patchedOn: '2025-06-01', fngStartedOn: null, bio: null, sharePhone: false, appliedOn: '2023-01-01', onHiatus: false,
});
const seat = (id: string, memberId: string, chapterId: string | null, role: PositionRole, over: Partial<Position> = {}): Position => ({
  id, memberId, chapterId, role, startedOn: '2026-08-01', endedOn: null, ...over,
});
/** A stint from today to UNTIL: in an empty seat, unless `covers`. */
const stint = (id: string, memberId: string, chapterId: string, role: PositionRole, over: Partial<Position> = {}): Position =>
  seat(id, memberId, chapterId, role, { startedOn: AT, actingUntil: UNTIL, actingWhy: 'No one since the ACM', appointedBy: 'smokey', ...over });
const SEATS: Position[] = [
  seat('smokey-president', 'smokey', 'north', 'president'),
  seat('jet-vp', 'jet', 'north', 'vice_president'),
  seat('crank-rc', 'crank', 'north', 'road_captain'),
  seat('lou-nec-secretary', 'lou', null, 'nec_secretary'),
  seat('rusty-president', 'rusty', 'west', 'president'),
  seat('torque-secretary', 'torque', 'west', 'secretary'),
  seat('penny-treasurer', 'penny', 'west', 'treasurer'),
  seat('kim-auditor', 'kim', null, 'nec_auditor'),
];
const JET_COVERS = stint('jet-covers-smokey', 'jet', 'north', 'president', { covers: 'smokey-president', actingWhy: 'Smokey overseas', appointedBy: 'crank' });

interface World {
  seats?: Position[]; without?: string[]; ended?: Record<string, string>; members?: Record<string, Partial<Member>>;
  requests?: ActingRequest[]; votes?: Vote[]; meetings?: Meeting[]; privates?: MemberPrivate[]; crew?: CrewSpot[]; rides?: Ride[];
}
const world = (w: World = {}): ClubData => ({
  ...d,
  chapters: [
    { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
    { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
  ],
  members: RIDERS.map(([id, ch]) => ({ ...rider(id, ch), ...w.members?.[id] })),
  positions: [...SEATS, ...(w.seats ?? [])]
    .filter((p) => !w.without?.includes(p.id))
    .map((p) => (w.ended?.[p.id] ? { ...p, endedOn: w.ended[p.id] } : p)),
  privates: w.privates ?? [], votes: w.votes ?? [], meetings: w.meetings ?? [], actingRequests: w.requests ?? [], actingChanges: [],
  crew: w.crew ?? [], rides: w.rides ?? [],
});
const who = (data: ClubData, id: string): Member => {
  const found = data.members.find((x) => x.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};
const row = (data: ClubData, id: string): Position => {
  const found = data.positions.find((p) => p.id === id);
  if (!found) throw new Error(`no position ${id}`);
  return found;
};
/** Smokey asks for Jet to cover his President seat until UNTIL, made today. */
const ask = (id: string, over: Partial<ActingRequest> = {}): ActingRequest => ({
  id, chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: UNTIL, why: 'Smokey overseas',
  requestedBy: 'smokey', createdAt: `${AT}T01:00:00.000Z`, closedAt: null, outcome: null, ...over,
});
/** A North board-majority vote on Jet as President, opened 8 days ago and carried yesterday. */
const boardVote = (id: string, over: Partial<Vote> = {}): Vote => ({
  id, chapterId: 'north', meetingId: null, subjectMemberId: 'jet', subjectRole: 'president', question: 'Jet acts as President?', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, openedAt: '2026-11-07T01:00:00.000Z',
  closesAt: '2026-11-14T01:00:00.000Z', closedAt: '2026-11-14T01:00:00.000Z', result: 'carried', castingVote: null,
  tally: { yes: 3, no: 0, abstain: 0 }, electorIds: [], votedIds: [], ballots: [], createdBy: 'crank', ...over,
});
const licence = (memberId: string, licenceClass: LicenceClass, licenceExpiry: string | null): MemberPrivate => ({
  memberId, email: null, phone: null, licenceClass, licenceExpiry, firstAidExpiry: null, introducedBy: null, applicationNote: null,
});
/** A meeting at 6 or 7 pm Melbourne time on `day`. */
const meet = (id: string, chapterId: string | null, kind: MeetingKind, day: string, cancelled = false): Meeting => ({
  id, chapterId, kind, title: id, startsAt: `${day}T08:00:00.000Z`, location: null, agenda: [], minutes: null,
  minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: cancelled ? '2026-11-01T00:00:00.000Z' : null, createdBy: null,
});
/** North with five board members: Ned seated Secretary and Gus Treasurer. */
const FIVE: Position[] = [seat('ned-secretary', 'ned', 'north', 'secretary'), seat('gus-treasurer', 'gus', 'north', 'treasurer')];

test('the acting words are the spec’s Appendix A', () => {
  assert.equal(ACTING_CHAPTER_ONLY, 'Acting is for chapter roles, not national seats or honours.');
  assert.equal(SEAT_HAS_HOLDER, 'That seat has a holder. Arrange a cover instead.');
  assert.equal(SEAT_HAS_ACTING, 'Someone is already acting in that seat, or a request is waiting.');
  assert.equal(ONE_STINT, 'They’re already acting in a role. One stint at a time.');
  assert.equal(OWN_SEAT_COVERED, 'Their own seat is covered, so they can’t act for anyone.');
  assert.equal(CHAIR_NOT_BOOKS, 'An Acting President can’t also keep the chapter’s books (9.5).');
  assert.equal(BOOKS_NOT_CHAIR, 'An Acting Treasurer can’t also be the chapter’s President (9.5).');
  assert.equal(HIATUS_NO_LEAD, 'Members on hiatus can’t lead rides.');
  assert.equal(COVER_BOARD_SEATS, 'Only board seats can be covered.');
  assert.equal(COVER_FROM_BOARD, 'A cover goes to someone already on that chapter’s board.');
  assert.equal(PRESIDENT_NEEDS_BOARD_VOTE, 'Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8).');
  assert.equal(ENDED_BY_VOTE, 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.');
  assert.equal(WHY_NEEDED, 'Say why, in 120 characters or fewer.');
  assert.equal(untilRange('2026-12-13'), 'Pick an until date from today to 13/12/2026.');
  assert.equal(RUN_OVER, 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).');
  assert.equal(ASKED_RECENTLY, 'The board voted down your request for this seat in the last 28 days.');
  assert.equal(SMALL_BOARD, 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).');
  assert.equal(LICENCE_ENDS, 'Their recorded licence ends before the until date (9.7).');
  assert.equal(RECORD_INSTEAD, 'This doesn’t need a vote. Record it as acting, or ask for cover from your own seat.');
  assert.equal(REPLACE_NEEDS_END, 'Someone is acting in that seat. They step down first, or a carried board vote ends their acting.');
  assert.equal(AUDITOR_STAYS_OUT, 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).');
  assert.equal(BOARD_RECORDS_ACTING, 'Only that chapter’s board can record acting here.');
  assert.equal(NOT_YOURSELF, 'You can’t record yourself as acting.');
  assert.equal(OWN_SEAT_ONLY, 'You can only ask for cover of your own board seat.');
  assert.equal(NO_REQUEST, 'That request isn’t open.');
  assert.equal(CONFIRM_NOT_STANDIN, 'The stand-in can’t confirm their own acting.');
  assert.equal(CONFIRM_NOT_HOLDER, 'A third board member confirms the cover you asked for (9.5).');
  assert.equal(NEEDS_ACTING_VOTE, 'This needs a carried board vote on the request in the last 90 days.');
  assert.equal(SEAT_ENDED, 'The seat they asked to cover has ended.');
  assert.equal(WITHDRAW_WHO, 'Only the stand-in or the holder can withdraw this, or the person who asked before a vote on it opens.');
  assert.equal(NOT_ACTING, 'That isn’t an acting seat.');
  assert.equal(UNTIL_NOT_PAST, 'Pick today or later. To end it now, step down.');
  assert.equal(EARLIER_WHO, 'Only the acting person or the holder can bring the date forward.');
  assert.equal(LATER_WHO_EMPTY, 'Only another board member can give this more time.');
  assert.equal(laterWhoCover('Smokey'), 'Only Smokey can keep this cover going longer.');
  assert.equal(VOTED_NEEDS_NEW_VOTE, 'The board voted for this stint, so it needs a new vote to run longer.');
  assert.equal(ACTING_END_NEEDS_VOTE, 'Ending someone’s acting needs a carried majority vote of the chapter board in the last 90 days (9.3).');
  assert.equal(necBallotsWait('North', 2), 'North can’t cast its ballot on 2 open NEC votes while this runs, so they may close without quorum (11.2, 11.5).');
  assert.equal(necBallotsWait('North', 1), 'North can’t cast its ballot on 1 open NEC vote while this runs, so they may close without quorum (11.2, 11.5).');
  // The warnings (the spec's "Who may act").
  assert.equal(ACTING_FAMILY, 'Immediate family can’t sit on the same board, including the person they cover, without a two-thirds written exemption (9.6).');
  assert.equal(ACTING_LICENCE_VACANCY, 'If their licence is suspended or cancelled, their seat is vacant (9.7). The app can’t record that yet: they step down, then the board fills the seat.');
  assert.equal(ACTING_COMBINED, 'A small chapter may combine duties for a while where it’s necessary, with the reason recorded (9.5).');
  assert.equal(BOARD_TWO_YEARS, 'Board nominees need two years as a Full Member, unless the NEC waived it or they’re a founding officer (9.1).');
  assert.equal(SERVED_TERM_FIRST, 'A President or Vice President should have served a full term in another board seat, unless they’re a founding officer or the NEC gave an exemption (9.4).');
  assert.equal(actingRideWarning('Crank', '2026-12-13', '2026-12-14'), 'Crank leads the 13/12 run. Acting ends that night. Pick 14/12 or later.');
});

test('actingProblem refuses, in order, with the shared words', () => {
  const w = world();
  const p = (target: string, chapter: string | null, role: PositionRole, covers: Position | null = null, data = w, until = UNTIL) =>
    actingProblem(who(data, target), chapter, role, covers, until, data);
  // Chapter roles only: never a national seat or an honour.
  assert.equal(p('ned', null, 'nec_secretary'), ACTING_CHAPTER_ONLY);
  assert.equal(p('ned', 'north', 'founder'), ACTING_CHAPTER_ONLY);
  // Their own chapter, and someone who could hold the role at all.
  assert.equal(p('spanner', 'north', 'treasurer'), 'They’re not a member of that chapter.');
  assert.equal(p('ned', 'north', 'treasurer', null, world({ members: { ned: { status: 'supporter' } } })), 'Only Full and Nomad members hold Club positions (4.6, 5.8).');
  assert.equal(p('kim', 'west', 'treasurer'), 'The National Auditor can’t also be a President or Treasurer (11.8).', 'before the seat has a holder');
  assert.equal(p('crank', 'north', 'road_captain'), 'They already hold that role.');
  // A board seat: a holder, a stint or a request already there.
  assert.equal(p('ned', 'north', 'vice_president'), SEAT_HAS_HOLDER);
  const crankActing = world({ seats: [stint('crank-acting-treasurer', 'crank', 'north', 'treasurer')] });
  assert.equal(p('ned', 'north', 'treasurer', null, crankActing), SEAT_HAS_ACTING);
  const asked = world({ requests: [ask('crank-asks-gus', { role: 'treasurer', memberId: 'gus', covers: null, requestedBy: 'crank' })] });
  assert.equal(p('ned', 'north', 'treasurer', null, asked), SEAT_HAS_ACTING, 'a request is waiting');
  const covered = world({ seats: [JET_COVERS] });
  assert.equal(p('crank', 'north', 'president', row(covered, 'smokey-president'), covered), SEAT_HAS_ACTING, 'a second cover');
  // A non-board role takes acting beside its holders.
  const tg = world({ seats: [seat('spanner-tg', 'spanner', 'west', 'tail_gunner')] });
  assert.equal(p('hal', 'west', 'tail_gunner', null, tg), null);
  assert.equal(p('ned', 'north', 'officer', null, crankActing), null, 'not a board seat: no seat checks');
  // One stint at a time, and nobody whose own seat is covered.
  assert.equal(p('crank', 'north', 'secretary', null, crankActing), ONE_STINT);
  assert.equal(p('smokey', 'north', 'secretary', null, covered), OWN_SEAT_COVERED);
  assert.equal(p('smokey', 'north', 'treasurer', null, covered), OWN_SEAT_COVERED, 'before chair and books');
  // Chair and books stay apart (9.5).
  const nedTreasurer = world({ ended: { 'smokey-president': '2026-11-01' }, seats: [seat('ned-treasurer', 'ned', 'north', 'treasurer')] });
  assert.equal(p('ned', 'north', 'president', null, nedTreasurer), CHAIR_NOT_BOOKS, 'an elected Treasurer');
  assert.equal(p('smokey', 'north', 'treasurer'), BOOKS_NOT_CHAIR);
  // Hiatus, for every role that leads rides.
  const away = world({ members: { ned: { onHiatus: true }, hal: { onHiatus: true } } });
  assert.equal(p('ned', 'north', 'secretary', null, away), HIATUS_NO_LEAD);
  assert.equal(p('ned', 'north', 'tail_gunner', null, away), HIATUS_NO_LEAD);
  assert.equal(p('ned', 'north', 'assistant_tail_gunner', null, away), HIATUS_NO_LEAD);
  assert.equal(p('ned', 'north', 'officer', null, away), null, 'an Officer doesn’t lead rides');
  assert.equal(p('hal', 'west', 'president', null, away), SEAT_HAS_HOLDER, 'the seat comes before the hiatus');
  // A recorded licence: a learner's, or ending before the until date (9.7). None recorded: no refusal.
  assert.equal(p('ned', 'north', 'secretary', null, world({ privates: [licence('ned', 'learner', '2030-01-01')] })), LICENCE_ENDS);
  const expiring = world({ privates: [licence('ned', 'full_open', '2026-12-12')] });
  assert.equal(p('ned', 'north', 'secretary', null, expiring), LICENCE_ENDS);
  assert.equal(p('ned', 'north', 'secretary', null, expiring, '2026-12-12'), null, 'it lasts the stint');
  assert.equal(p('ned', 'north', 'secretary', null, world({ privates: [licence('ned', 'full_open', null)] })), null);
  // Covers: board seats only, from someone already on that chapter's board.
  assert.equal(p('rusty', 'west', 'tail_gunner', row(tg, 'spanner-tg'), tg), COVER_BOARD_SEATS);
  assert.equal(p('ned', 'north', 'president', row(w, 'smokey-president')), COVER_FROM_BOARD);
  assert.equal(p('lou', 'north', 'president', row(w, 'smokey-president')), COVER_FROM_BOARD, 'an NEC seat isn’t a board seat');
  assert.equal(p('jet', 'north', 'president', row(w, 'smokey-president')), null);
  assert.equal(p('crank', 'north', 'treasurer'), null);
});

test('routes: Smokey records Crank as Acting Treasurer (North); every refusal, in order', () => {
  const w = world();
  const rec = (me: string | null, target: string, role: PositionRole, until = UNTIL, why = 'No Treasurer since the ACM', data = w) =>
    appointActingProblem(me === null ? null : who(data, me), who(data, target), 'north', role, until, why, data, AT);
  assert.equal(rec('smokey', 'crank', 'treasurer'), null);
  assert.equal(rec(null, 'crank', 'treasurer'), 'Sign in first.');
  assert.equal(rec('smokey', 'crank', 'treasurer', UNTIL, 'x', world({ members: { smokey: { approval: 'suspended' } } })), 'Only approved members can do that.');
  assert.equal(rec('ned', 'crank', 'treasurer'), BOARD_RECORDS_ACTING, 'off the board');
  assert.equal(rec('lou', 'crank', 'treasurer'), BOARD_RECORDS_ACTING, 'an NEC officer has no part');
  assert.equal(rec('rusty', 'crank', 'treasurer'), BOARD_RECORDS_ACTING, 'another chapter’s board');
  assert.equal(rec('crank', 'crank', 'treasurer'), NOT_YOURSELF);
  assert.equal(rec('ned', 'ned', 'treasurer', '2020-01-01', ''), BOARD_RECORDS_ACTING, 'standing comes first');
  assert.equal(rec('smokey', 'ned', 'secretary', UNTIL, 'No Secretary since the ACM', world({ members: { ned: { onHiatus: true } } })), HIATUS_NO_LEAD);
  assert.equal(rec('smokey', 'ned', 'secretary', UNTIL, 'No Secretary since the ACM', world({ privates: [licence('ned', 'full_open', '2026-12-01')] })), LICENCE_ENDS);
  assert.equal(rec('smokey', 'crank', 'treasurer', UNTIL, '   '), WHY_NEEDED, 'a blank why');
  assert.equal(rec('smokey', 'crank', 'treasurer', UNTIL, 'x'.repeat(121)), WHY_NEEDED, '121 characters');
  assert.equal(rec('smokey', 'crank', 'treasurer', UNTIL, 'x'.repeat(120)), null, '120 characters');
  assert.equal(rec('smokey', 'crank', 'treasurer', '2026-11-14', ''), WHY_NEEDED, 'the why comes before the date');
  // Today to the cap (six months from today: no ACM saved).
  assert.equal(rec('smokey', 'crank', 'treasurer', '2026-11-14'), untilRange('2027-05-15'));
  assert.equal(rec('smokey', 'crank', 'treasurer', AT), null, 'today is the earliest');
  assert.equal(rec('smokey', 'crank', 'treasurer', '2027-05-15'), null, 'the cap itself');
  assert.equal(rec('smokey', 'crank', 'treasurer', '2027-05-16'), untilRange('2027-05-15'));
  // A non-board role, recorded the same way beside its holder.
  const tg = world({ seats: [seat('spanner-tg', 'spanner', 'west', 'tail_gunner')] });
  assert.equal(appointActingProblem(who(tg, 'rusty'), who(tg, 'hal'), 'west', 'tail_gunner', UNTIL, 'Spanner needs a hand', tg, AT), null);
});

test('only a VP seated before the President seat fell empty acts as President without a vote', () => {
  const vacant = world({ ended: { 'smokey-president': '2026-11-01' } });
  const rec = (me: string, target: string, data: ClubData) =>
    appointActingProblem(who(data, me), who(data, target), 'north', 'president', UNTIL, 'No President since Smokey stepped down', data, AT);
  assert.equal(rec('crank', 'jet', vacant), null, 'Jet, VP before it fell empty');
  assert.equal(rec('crank', 'ned', vacant), PRESIDENT_NEEDS_BOARD_VOTE);
  assert.equal(rec('crank', 'ned', world({ ended: { 'smokey-president': '2026-11-01', 'jet-vp': '2026-11-02' } })), PRESIDENT_NEEDS_BOARD_VOTE, 'with no VP');
  const lateVp = world({ ended: { 'smokey-president': '2026-11-01' }, without: ['jet-vp'], seats: [seat('gus-vp', 'gus', 'north', 'vice_president', { startedOn: '2026-11-05' })] });
  assert.equal(rec('crank', 'gus', lateVp), PRESIDENT_NEEDS_BOARD_VOTE, 'seated VP after it fell empty');
  assert.equal(rec('crank', 'jet', world({ without: ['smokey-president'] })), PRESIDENT_NEEDS_BOARD_VOTE, 'a seat that never had a President');
  // A cover of a President: the sitting VP only, so West (no VP) can't.
  const w = world();
  assert.equal(requestCoverProblem(who(w, 'rusty'), row(w, 'rusty-president'), who(w, 'torque'), UNTIL, 'Rusty overseas', w, AT), PRESIDENT_NEEDS_BOARD_VOTE);
  assert.equal(requestCoverProblem(who(w, 'smokey'), row(w, 'smokey-president'), who(w, 'crank'), UNTIL, 'Smokey overseas', w, AT), PRESIDENT_NEEDS_BOARD_VOTE);
  // Lou (an NEC officer) can't record, propose or confirm North's Acting President.
  assert.equal(rec('lou', 'jet', vacant), BOARD_RECORDS_ACTING);
  assert.equal(requestActingProblem(who(vacant, 'lou'), who(vacant, 'ned'), 'north', 'president', null, UNTIL, 'No President', vacant, AT), BOARD_RECORDS_ACTING);
  const proposed = world({ ended: { 'smokey-president': '2026-11-01' }, requests: [ask('crank-asks-ned', { memberId: 'ned', covers: null, requestedBy: 'crank' })] });
  assert.equal(confirmActingProblem(who(proposed, 'lou'), proposed.actingRequests![0], proposed, AT), BOARD_RECORDS_ACTING);
  // Route 3 takes anyone else (here with Ned and Gus seated, so three electors are left either way).
  const vacantFive = world({ ended: { 'smokey-president': '2026-11-01' }, seats: FIVE });
  assert.equal(requestActingProblem(who(vacantFive, 'crank'), who(vacantFive, 'ned'), 'north', 'president', null, UNTIL, 'No President', vacantFive, AT), null);
  assert.equal(requestActingProblem(who(vacantFive, 'crank'), who(vacantFive, 'jet'), 'north', 'president', null, UNTIL, 'No President', vacantFive, AT), RECORD_INSTEAD, 'the sitting VP is recorded instead');
  assert.equal(requestActingProblem(who(vacant, 'crank'), who(vacant, 'jet'), 'north', 'president', null, UNTIL, 'No President', vacant, AT), SMALL_BOARD, 'Crank alone is left');
});

test('a carried vote that ended their time in a seat holds for 90 days: re-recording needs a new vote (ENDED_BY_VOTE)', () => {
  // Jet's Acting President stint was ended by a carried board-majority vote yesterday.
  const jetEnded = world({
    ended: { 'smokey-president': '2026-11-01' },
    seats: [...FIVE, stint('jet-acting-president', 'jet', 'north', 'president', { startedOn: '2026-11-02', endedOn: '2026-11-14', endedReason: 'removed' })],
    votes: [boardVote('v-end-jet')],
  });
  const recJet = (data: ClubData) => appointActingProblem(who(data, 'crank'), who(data, 'jet'), 'north', 'president', UNTIL, 'No President', data, AT);
  assert.equal(recJet(jetEnded), ENDED_BY_VOTE);
  assert.equal(actingNeedsVote('jet', 'north', 'president', jetEnded, AT), true);
  assert.equal(requestActingProblem(who(jetEnded, 'crank'), who(jetEnded, 'jet'), 'north', 'president', null, UNTIL, 'No President', jetEnded, AT), null, 'request_acting takes it');
  const old = { ...jetEnded, votes: [boardVote('v-end-jet', { closedAt: '2026-08-16T01:00:00.000Z' })] };
  assert.equal(recJet(old), null, '91 days on');
  const actingVote = { ...jetEnded, votes: [boardVote('v-end-jet', { actingRequestId: 'ar-old' })] };
  assert.equal(recJet(actingVote), null, 'a vote that seated acting isn’t one that ended it');
  // A 9.3 removal of Penny as Treasurer counts too.
  const pennyRemoved = world({
    ended: { 'penny-treasurer': '2026-11-14' },
    votes: [boardVote('v-remove-penny', { chapterId: 'west', subjectMemberId: 'penny', subjectRole: 'treasurer', electorate: 'chapter_patched', threshold: 'two_thirds' })],
  });
  assert.equal(appointActingProblem(who(pennyRemoved, 'rusty'), who(pennyRemoved, 'penny'), 'west', 'treasurer', UNTIL, 'No Treasurer', pennyRemoved, AT), ENDED_BY_VOTE);
  assert.equal(appointActingProblem(who(pennyRemoved, 'rusty'), who(pennyRemoved, 'hal'), 'west', 'treasurer', UNTIL, 'No Treasurer', pennyRemoved, AT), null, 'about Penny only');
});

test('caps run from the start: a cover three months, an empty board seat six with no ACM saved; defaults four weeks and three months', () => {
  const w = world();
  assert.equal(actingCap('north', 'president', true, '2026-11-30', w), '2027-02-28');
  assert.equal(actingCap('north', 'treasurer', false, '2026-11-30', w), '2027-05-30');
  assert.equal(actingCap('north', 'president', true, '2027-01-31', w), '2027-04-30');
  assert.equal(actingCap('north', 'treasurer', false, '2027-01-31', w), '2027-07-31');
  assert.equal(actingDefaultUntil('north', 'president', true, '2026-11-30', w), '2026-12-28');
  assert.equal(actingDefaultUntil('north', 'treasurer', false, '2026-11-30', w), '2027-02-28');
  assert.equal(actingDefaultUntil('north', 'president', true, '2027-01-31', w), '2027-02-28');
  assert.equal(actingDefaultUntil('north', 'treasurer', false, '2027-01-31', w), '2027-04-30');
});

test('caps: an empty board seat runs to the chapter’s first ACM on or after the run starts, twelve months at most', () => {
  const ignored = [
    meet('north-acm-off', 'north', 'agm', '2027-01-10', true), meet('north-special', 'north', 'special', '2027-01-05'),
    meet('north-general', 'north', 'general', '2027-01-06'), meet('west-acm', 'west', 'agm', '2027-01-07'),
  ];
  const w = world({ meetings: [meet('north-acm', 'north', 'agm', '2027-02-14'), ...ignored] });
  assert.equal(actingCap('north', 'treasurer', false, '2026-11-30', w), '2027-02-14');
  assert.equal(actingDefaultUntil('north', 'treasurer', false, '2026-11-30', w), '2027-02-14');
  assert.equal(actingCap('north', 'treasurer', false, '2026-11-30', world({ meetings: ignored })), '2027-05-30', 'cancelled, special, general and West meetings don’t count');
  assert.equal(actingCap('north', 'treasurer', false, '2026-11-30', world({ meetings: [meet('north-acm', 'north', 'agm', '2029-02-14')] })), '2027-11-30', 'twelve months at most');
  // Covers and non-board roles take no ACM.
  assert.equal(actingCap('north', 'president', true, '2026-11-30', w), '2027-02-28');
  assert.equal(actingCap('north', 'tail_gunner', false, '2026-11-30', w), '2027-05-30', 'an Acting Tail Gunner: its own start + 6 months');
  assert.equal(actingDefaultUntil('north', 'tail_gunner', false, '2026-11-30', w), '2027-02-28');
});

test('caps: stints under four weeks apart share one run from its first start; a longer gap or a full term between starts afresh', () => {
  const before = (over: Partial<Position>) =>
    world({ seats: [stint('crank-old', 'crank', 'north', 'treasurer', { startedOn: '2026-10-01', endedOn: '2026-11-14', endedReason: 'stepped_down', ...over })] });
  assert.equal(actingCap('north', 'treasurer', false, AT, before({})), '2027-04-01', 're-recorded the day after stepping down keeps the first start');
  assert.equal(actingCap('north', 'treasurer', false, AT, before({ actingUntil: '2026-10-17', endedOn: '2026-10-18', endedReason: 'lapsed' })), '2027-04-01', '28 days after it ended');
  assert.equal(actingCap('north', 'treasurer', false, AT, before({ actingUntil: '2026-10-16', endedOn: '2026-10-17', endedReason: 'lapsed' })), '2027-05-15', '29 days after: a new run');
  const chained = world({ seats: [
    stint('gus-old', 'gus', 'north', 'treasurer', { startedOn: '2026-07-01', actingUntil: '2026-08-09', endedOn: '2026-08-10', endedReason: 'lapsed' }),
    stint('crank-old', 'crank', 'north', 'treasurer', { startedOn: '2026-09-01', endedOn: '2026-11-14', endedReason: 'stepped_down' }),
  ] });
  assert.equal(actingCap('north', 'treasurer', false, AT, chained), '2027-01-01', 'back through each stint');
  const elected = world({ seats: [
    stint('crank-old', 'crank', 'north', 'treasurer', { startedOn: '2026-09-01', endedOn: '2026-10-20', endedReason: 'replaced' }),
    seat('gus-treasurer', 'gus', 'north', 'treasurer', { startedOn: '2026-10-20', endedOn: '2026-11-10', endedReason: 'stepped_down' }),
  ] });
  assert.equal(actingCap('north', 'treasurer', false, AT, elected), '2027-05-15', 'only stints after the last full term ended');
});

test('caps: once the run’s ACM is held, no stint can start or run longer (RUN_OVER); an ACM before the run doesn’t count', () => {
  const old = stint('crank-old', 'crank', 'north', 'treasurer', { startedOn: '2026-09-01', endedOn: '2026-11-10', endedReason: 'stepped_down' });
  const held = world({ seats: [old], meetings: [meet('north-acm', 'north', 'agm', '2026-11-12')] });
  assert.equal(actingCap('north', 'treasurer', false, AT, held), '2026-11-12');
  assert.equal(appointActingProblem(who(held, 'smokey'), who(held, 'ned'), 'north', 'treasurer', UNTIL, 'No Treasurer', held, AT), RUN_OVER);
  const live = world({
    seats: [stint('crank-acting', 'crank', 'north', 'treasurer', { startedOn: '2026-09-01', actingUntil: '2026-11-20' })],
    meetings: [meet('north-acm', 'north', 'agm', '2026-11-12')],
  });
  assert.equal(setActingUntilProblem(who(live, 'smokey'), row(live, 'crank-acting'), '2026-11-25', live, AT), RUN_OVER, 'an extension');
  assert.equal(setActingUntilProblem(who(live, 'crank'), row(live, 'crank-acting'), '2026-11-18', live, AT), null, 'bringing it forward');
  const earlier = world({ seats: [old], meetings: [meet('north-acm', 'north', 'agm', '2026-08-20')] });
  assert.equal(actingCap('north', 'treasurer', false, AT, earlier), '2027-03-01');
});

test('warnings: 9.6 on every board-seat stint; 9.1 and 9.4 where they fit; 9.7 on covers; 9.5 for a stand-in already on the board', () => {
  const w = world();
  const warn = (target: string, role: PositionRole, covers: string | null, data = w, chapter = 'north') =>
    actingWarnings(who(data, target), chapter, role, covers ? row(data, covers) : null, UNTIL, data, AT);
  assert.deepEqual(warn('ned', 'treasurer', null), [ACTING_FAMILY, BOARD_TWO_YEARS], 'off the board, not two years Full');
  assert.deepEqual(warn('ned', 'treasurer', null, world({ members: { ned: { patchedOn: '2024-01-01' } } })), [ACTING_FAMILY]);
  assert.deepEqual(warn('crank', 'treasurer', null), [ACTING_FAMILY, ACTING_COMBINED], 'the Road Captain combines duties');
  assert.deepEqual(warn('jet', 'president', 'smokey-president'), [ACTING_FAMILY, ACTING_LICENCE_VACANCY], 'the VP acting for the President is 8.2');
  assert.deepEqual(warn('torque', 'treasurer', 'penny-treasurer', w, 'west'), [ACTING_FAMILY, ACTING_LICENCE_VACANCY, ACTING_COMBINED]);
  const vacant = world({ ended: { 'smokey-president': '2026-11-01' } });
  assert.deepEqual(warn('ned', 'president', null, vacant), [ACTING_FAMILY, BOARD_TWO_YEARS, SERVED_TERM_FIRST]);
  assert.deepEqual(warn('crank', 'president', null, vacant), [ACTING_FAMILY, SERVED_TERM_FIRST, ACTING_COMBINED]);
  assert.deepEqual(warn('jet', 'president', null, vacant), [ACTING_FAMILY], 'the sitting VP');
  assert.deepEqual(warn('ned', 'vice_president', null, world({ ended: { 'jet-vp': '2026-11-01' } })), [ACTING_FAMILY, BOARD_TWO_YEARS, SERVED_TERM_FIRST]);
  assert.deepEqual(warn('ned', 'officer', null), [], 'not a board seat');
});

test('warnings: the stand-in leads a ride on the until day, or one running past its midnight', () => {
  const ride = (id: string, startsAt: string, endsAt: string | null, cancelled = false): Ride => ({
    id, title: id, startsAt, endsAt, allDay: false, location: null, notes: null, category: 'north',
    cancelledAt: cancelled ? '2026-11-01T00:00:00.000Z' : null, source: 'app', website: false,
  });
  const crewed = (rideId: string, memberId = 'crank'): CrewSpot => ({ rideId, memberId, role: 'road_captain', assignedBy: 'smokey', assignedAt: '2026-11-01T00:00:00.000Z' });
  const warn = (data: ClubData, until: string, target = 'crank') => actingWarnings(who(data, target), 'north', 'treasurer', null, until, data, AT);
  // 13/12, 9:00 am to 5:00 pm.
  const day = world({ rides: [ride('r-xmas', '2026-12-12T22:00:00.000Z', '2026-12-13T06:00:00.000Z')], crew: [crewed('r-xmas')] });
  assert.ok(warn(day, '2026-12-13').includes('Crank leads the 13/12 run. Acting ends that night. Pick 14/12 or later.'));
  assert.ok(!warn(day, '2026-12-14').some((x) => x.includes('leads the')));
  assert.ok(!warn(day, '2026-12-12').some((x) => x.includes('leads the')), 'the ride is after the stint');
  // 12/12, 8:00 pm, to 1:00 am on 14/12.
  const night = world({ rides: [ride('r-night', '2026-12-12T09:00:00.000Z', '2026-12-13T14:00:00.000Z')], crew: [crewed('r-night')] });
  assert.ok(warn(night, '2026-12-13').includes(actingRideWarning('Crank', '2026-12-12', '2026-12-14')));
  assert.ok(warn(night, '2026-12-12').includes(actingRideWarning('Crank', '2026-12-12', '2026-12-14')));
  assert.ok(!warn(night, '2026-12-14').some((x) => x.includes('leads the')));
  // Cancelled, or someone else's.
  const off = world({ rides: [ride('r-xmas', '2026-12-12T22:00:00.000Z', null, true)], crew: [crewed('r-xmas')] });
  assert.ok(!warn(off, '2026-12-13').some((x) => x.includes('leads the')));
  assert.ok(!warn(world({ rides: day.rides, crew: [crewed('r-xmas', 'jet')] }), '2026-12-13').some((x) => x.includes('leads the')));
});

test('warnings: a voted President cover holds up the chapter’s uncast ballot on open NEC votes', () => {
  const nec = (id: string, votedIds: string[], over: Partial<Vote> = {}): Vote => boardVote(id, {
    chapterId: null, subjectMemberId: null, subjectRole: null, electorate: 'nec', closesAt: '2026-11-20T01:00:00.000Z', closedAt: null,
    result: null, tally: null, electorIds: ['rusty', 'smokey'], votedIds, electorChapters: { rusty: 'west', smokey: 'north' }, ...over,
  });
  const votes = [nec('nec-1', []), nec('nec-2', ['rusty']), nec('nec-3', ['smokey']), nec('nec-4', [], { closedAt: '2026-11-14T01:00:00.000Z', result: 'carried' })];
  const w = world({ votes });
  const wait = necBallotsWait('North', 2);
  const smokeySeat = row(w, 'smokey-president');
  assert.ok(actingWarnings(who(w, 'crank'), 'north', 'president', smokeySeat, UNTIL, w, AT).includes(wait), 'Crank isn’t the VP, so a voted cover');
  assert.ok(!actingWarnings(who(w, 'jet'), 'north', 'president', smokeySeat, UNTIL, w, AT).includes(wait), 'an agreed cover');
  assert.ok(actingWarnings(who(w, 'jet'), 'north', 'president', smokeySeat, UNTIL, w, AT, true).includes(wait), 'the VP, voted in (route 3)');
  assert.ok(!actingWarnings(who(w, 'torque'), 'west', 'treasurer', row(w, 'penny-treasurer'), UNTIL, w, AT, true).some((x) => x.includes('open NEC vote')), 'not a President cover');
  const vacant = world({ ended: { 'smokey-president': '2026-11-01' }, votes });
  assert.ok(!actingWarnings(who(vacant, 'ned'), 'north', 'president', null, UNTIL, vacant, AT, true).some((x) => x.includes('open NEC vote')), 'not a cover');
});

test('routes: Smokey asks for Jet to cover; the holder’s own board seat, a third board member to confirm', () => {
  const w = world();
  const askFor = (me: string, seatId: string, target: string, data = w, until = UNTIL) =>
    requestCoverProblem(who(data, me), row(data, seatId), who(data, target), until, 'Smokey overseas', data, AT);
  assert.equal(askFor('smokey', 'smokey-president', 'jet'), null);
  assert.equal(askFor('crank', 'smokey-president', 'jet'), OWN_SEAT_ONLY);
  assert.equal(askFor('smokey', 'smokey-president', 'crank'), PRESIDENT_NEEDS_BOARD_VOTE, 'Crank isn’t the VP');
  assert.equal(askFor('smokey', 'smokey-president', 'lou'), COVER_FROM_BOARD, 'Lou is off the board');
  assert.equal(askFor('smokey', 'smokey-president', 'crank', world({ without: ['jet-vp'] })), SMALL_BOARD, 'a board of two');
  assert.equal(askFor('smokey', 'smokey-president', 'jet', w, '2027-02-15'), null, 'the cover cap');
  assert.equal(askFor('smokey', 'smokey-president', 'jet', w, '2027-02-16'), untilRange('2027-02-15'));
  assert.equal(askFor('smokey', 'smokey-president', 'jet', world({ requests: [ask('smokey-asks-jet')] })), SEAT_HAS_ACTING, 'one request at a time');
  assert.equal(askFor('jet', 'jet-vp', 'crank'), null, 'any board seat can be covered');
});

test('confirm re-runs every check', () => {
  const asks = ask('smokey-asks-jet');
  const w = world({ requests: [asks] });
  const confirm = (me: string, data = w, request = asks) => confirmActingProblem(who(data, me), request, data, AT);
  assert.equal(confirm('crank'), null);
  assert.equal(confirm('smokey'), CONFIRM_NOT_HOLDER);
  assert.equal(confirm('jet'), CONFIRM_NOT_STANDIN);
  assert.equal(confirm('spanner'), BOARD_RECORDS_ACTING);
  assert.equal(confirm('crank', world({ requests: [asks], ended: { 'smokey-president': AT } })), SEAT_ENDED);
  assert.equal(confirm('crank', world({ requests: [asks], ended: { 'jet-vp': AT } })), COVER_FROM_BOARD);
  assert.equal(confirm('crank', world({ requests: [asks], seats: [stint('jet-acting-treasurer', 'jet', 'north', 'treasurer')] })), ONE_STINT);
  assert.equal(
    confirm('crank', world({ requests: [asks], ended: { 'jet-vp': AT }, seats: [seat('jet-secretary', 'jet', 'north', 'secretary')] })),
    NEEDS_ACTING_VOTE, 'Jet, also Secretary, is no longer the VP',
  );
  // A passed date: the request has lapsed, so a new one fits.
  const stale = ask('smokey-asks-jet', { until: '2026-11-14', createdAt: '2026-11-01T01:00:00.000Z' });
  const lapsedW = world({ requests: [stale] });
  assert.equal(confirm('crank', lapsedW, stale), NO_REQUEST);
  assert.equal(requestCoverProblem(who(lapsedW, 'smokey'), row(lapsedW, 'smokey-president'), who(lapsedW, 'jet'), UNTIL, 'Smokey overseas', lapsedW, AT), null);
  // 28 days old: lapsed; 27: still open.
  const aged = ask('smokey-asks-jet', { createdAt: '2026-10-18T01:00:00.000Z' });
  assert.equal(confirm('crank', world({ requests: [aged] }), aged), NO_REQUEST);
  const younger = ask('smokey-asks-jet', { createdAt: '2026-10-19T01:00:00.000Z' });
  assert.equal(confirm('crank', world({ requests: [younger] }), younger), null);
});

test('a confirmed request isn’t open', () => {
  const done = ask('smokey-asks-jet', { closedAt: `${AT}T02:00:00.000Z`, outcome: 'confirmed' });
  const w = world({ requests: [done], seats: [JET_COVERS] });
  assert.equal(confirmActingProblem(who(w, 'crank'), done, w, AT), NO_REQUEST, 'a second confirm');
  assert.equal(withdrawRequestProblem(who(w, 'smokey'), done, w), NO_REQUEST);
});

test('routes: a voted cover needs a carried board vote on the request in the last 90 days', () => {
  const five = world({ seats: FIVE });
  const propose = (me: string, target: string, role: PositionRole, covers: string | null, data = five) =>
    requestActingProblem(who(data, me), who(data, target), 'north', role, covers ? row(data, covers) : null, UNTIL, 'Smokey can’t be reached', data, AT);
  assert.equal(propose('crank', 'jet', 'president', 'smokey-president'), null);
  assert.equal(propose('crank', 'jet', 'president', 'smokey-president', world()), SMALL_BOARD, 'three-member North');
  assert.equal(propose('smokey', 'jet', 'president', 'smokey-president'), RECORD_INSTEAD, 'the holder asks from his own seat');
  assert.equal(propose('smokey', 'crank', 'treasurer', null, world({ seats: [FIVE[0]] })), RECORD_INSTEAD, 'an empty Treasurer seat');
  assert.equal(propose('crank', 'crank', 'president', 'smokey-president'), NOT_YOURSELF);
  const crankAsks = ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' });
  const asked = (votes: Vote[] = []) => world({ seats: FIVE, requests: [crankAsks], votes });
  assert.equal(requestNeedsVote(crankAsks, asked(), AT), true);
  assert.equal(requestNeedsVote(ask('smokey-asks-jet'), asked(), AT), false);
  assert.equal(confirmActingProblem(who(asked(), 'ned'), crankAsks, asked(), AT), NEEDS_ACTING_VOTE);
  const carried = boardVote('v-acting', { actingRequestId: 'crank-asks-jet' });
  assert.equal(confirmActingProblem(who(asked([carried]), 'ned'), crankAsks, asked([carried]), AT), null, 'opened 8 and closed 1 day ago');
  assert.equal(confirmActingProblem(who(asked([carried]), 'crank'), crankAsks, asked([carried]), AT), null, 'the requester can confirm');
  const stale = boardVote('v-acting', { actingRequestId: 'crank-asks-jet', openedAt: '2026-08-09T01:00:00.000Z', closedAt: '2026-08-16T01:00:00.000Z' });
  assert.equal(confirmActingProblem(who(asked([stale]), 'ned'), crankAsks, asked([stale]), AT), NEEDS_ACTING_VOTE, 'closed 91 days ago');
  const other = boardVote('v-acting', { actingRequestId: 'another-request' });
  assert.equal(confirmActingProblem(who(asked([other]), 'ned'), crankAsks, asked([other]), AT), NEEDS_ACTING_VOTE, 'a vote on another request');
});

test('withdraw by the requester, the stand-in and the holder; the requester only before a vote opens', () => {
  const crankAsks = ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' });
  const w = (votes: Vote[] = []) => world({ seats: FIVE, requests: [crankAsks], votes });
  const withdraw = (me: string, data = w()) => withdrawRequestProblem(who(data, me), crankAsks, data);
  assert.equal(withdraw('crank'), null, 'the requester');
  assert.equal(withdraw('jet'), null, 'the stand-in declines');
  assert.equal(withdraw('smokey'), null, 'the holder');
  assert.equal(withdraw('gus'), WITHDRAW_WHO, 'another board member');
  assert.equal(withdraw('spanner'), WITHDRAW_WHO);
  const open = w([boardVote('v-acting', { actingRequestId: 'crank-asks-jet', closedAt: null, result: null, tally: null, closesAt: '2026-11-20T01:00:00.000Z' })]);
  assert.equal(withdraw('crank', open), WITHDRAW_WHO, 'once his vote opened');
  assert.equal(withdraw('jet', open), null);
  assert.equal(withdraw('smokey', open), null);
  assert.equal(withdraw('crank', w([boardVote('v-acting', { actingRequestId: 'crank-asks-jet' })])), WITHDRAW_WHO, 'or carried');
  assert.equal(withdraw('crank', w([boardVote('v-acting', { actingRequestId: 'crank-asks-jet', result: 'no_quorum' })])), null, 'a vote without quorum');
});

test('after a lost vote, asking again for that seat waits 28 days (ASKED_RECENTLY)', () => {
  const crankAsks = ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' });
  const lost = world({ seats: FIVE, requests: [crankAsks], votes: [boardVote('v-acting', { actingRequestId: 'crank-asks-jet', result: 'lost' })] });
  const again = (data: ClubData, me = 'crank') =>
    requestActingProblem(who(data, me), who(data, 'jet'), 'north', 'president', row(data, 'smokey-president'), UNTIL, 'Smokey can’t be reached', data, AT);
  assert.equal(again(lost), ASKED_RECENTLY, 'the lost vote rejected it');
  assert.equal(again(lost, 'ned'), null, 'someone else may ask');
});

test('actingElectors leaves out the stand-in, the holder and, for a President or Treasurer seat, the Auditor', () => {
  const five = world({ seats: FIVE });
  assert.deepEqual(actingElectors('north', 'president', 'jet', 'smokey-president', five), ['crank', 'gus', 'ned']);
  assert.deepEqual(actingElectors('north', 'treasurer', 'crank', null, five), ['gus', 'jet', 'ned', 'smokey']);
  const kimOnWest = world({ seats: [seat('kim-west-vp', 'kim', 'west', 'vice_president')] });
  assert.deepEqual(actingElectors('west', 'treasurer', 'torque', 'penny-treasurer', kimOnWest), ['rusty']);
  assert.deepEqual(actingElectors('west', 'secretary', 'penny', 'torque-secretary', kimOnWest), ['kim', 'rusty']);
});

test('dates: set_acting_until, earlier by the acting person or holder, later by whoever the stint allows', () => {
  const crankActing = stint('crank-acting-treasurer', 'crank', 'north', 'treasurer', { startedOn: '2026-11-01' });
  const w = world({ seats: [crankActing, JET_COVERS] });
  const set = (me: string, id: string, until: string, data = w) => setActingUntilProblem(who(data, me), row(data, id), until, data, AT);
  // Earlier: the acting person, or for a cover also the holder.
  assert.equal(set('crank', 'crank-acting-treasurer', '2026-11-20'), null);
  assert.equal(set('crank', 'crank-acting-treasurer', AT), null, 'today');
  assert.equal(set('crank', 'crank-acting-treasurer', '2026-11-14'), UNTIL_NOT_PAST);
  assert.equal(set('smokey', 'crank-acting-treasurer', '2026-11-20'), EARLIER_WHO);
  assert.equal(set('jet', 'jet-covers-smokey', '2026-12-01'), null);
  assert.equal(set('smokey', 'jet-covers-smokey', '2026-12-01'), null, 'the holder');
  assert.equal(set('crank', 'jet-covers-smokey', '2026-12-01'), EARLIER_WHO);
  // Later, in an empty seat: another board member, within the cap (six months from 01/11).
  assert.equal(set('smokey', 'crank-acting-treasurer', '2027-01-10'), null);
  assert.equal(set('crank', 'crank-acting-treasurer', '2027-01-10'), LATER_WHO_EMPTY);
  assert.equal(set('ned', 'crank-acting-treasurer', '2027-01-10'), LATER_WHO_EMPTY, 'off the board');
  assert.equal(set('smokey', 'crank-acting-treasurer', '2027-05-01'), null);
  assert.equal(set('smokey', 'crank-acting-treasurer', '2027-05-02'), untilRange('2027-05-01'));
  // Later, on an agreed cover: the holder only, within three months of its start.
  assert.equal(set('smokey', 'jet-covers-smokey', '2027-01-10'), null);
  assert.equal(set('jet', 'jet-covers-smokey', '2027-01-10'), laterWhoCover('Smokey'));
  assert.equal(set('crank', 'jet-covers-smokey', '2027-01-10'), laterWhoCover('Smokey'));
  assert.equal(set('smokey', 'jet-covers-smokey', '2027-02-16'), untilRange('2027-02-15'));
  // A stint with a carried vote behind it needs a new vote to run longer.
  const voted = world({ seats: [{ ...JET_COVERS, actingVote: 'v-acting' }] });
  assert.equal(set('smokey', 'jet-covers-smokey', '2027-01-10', voted), VOTED_NEEDS_NEW_VOTE);
  assert.equal(set('jet', 'jet-covers-smokey', '2026-12-01', voted), null, 'bringing it forward needs none');
  const votedPresident = world({ ended: { 'smokey-president': '2026-11-01' }, seats: [stint('ned-acting-president', 'ned', 'north', 'president', { actingVote: 'v-acting' })] });
  assert.equal(set('crank', 'ned-acting-president', '2027-01-10', votedPresident), VOTED_NEEDS_NEW_VOTE);
  // A President stint recorded because they were the sitting VP is extended only while they still are.
  const vpStint = stint('jet-acting-president', 'jet', 'north', 'president', { startedOn: '2026-11-02' });
  const sitting = world({ ended: { 'smokey-president': '2026-11-01' }, seats: [vpStint] });
  assert.equal(set('crank', 'jet-acting-president', '2027-01-10', sitting), null);
  const vpGone = world({ ended: { 'smokey-president': '2026-11-01', 'jet-vp': AT }, seats: [vpStint] });
  assert.equal(set('crank', 'jet-acting-president', '2027-01-10', vpGone), PRESIDENT_NEEDS_BOARD_VOTE);
  // Not a stint, or one already over.
  assert.equal(set('smokey', 'crank-rc', '2027-01-10'), NOT_ACTING);
  const lapsed = world({ seats: [{ ...crankActing, actingUntil: '2026-11-14' }] });
  assert.equal(set('smokey', 'crank-acting-treasurer', '2026-12-01', lapsed), 'That term has already ended.');
  const ended = world({ seats: [{ ...crankActing, endedOn: '2026-11-10', endedReason: 'stepped_down' }] });
  assert.equal(set('smokey', 'crank-acting-treasurer', '2026-12-01', ended), 'That term has already ended.');
});

test('end branches: the acting person steps down, the holder says I’m back, anyone else on the board needs a carried board-majority vote', () => {
  // The cover started 05/11, before the end vote below closed (14/11).
  const jetCovers = { ...JET_COVERS, startedOn: '2026-11-05' };
  const w = world({ seats: [jetCovers] });
  const cover = row(w, 'jet-covers-smokey');
  const end = (me: string, position = cover, data = w) => endTermProblem(who(data, me), position, data, AT);
  assert.equal(end('jet'), null, 'stepped down');
  assert.equal(end('smokey'), null, 'the holder is back');
  const voted = world({ seats: [{ ...jetCovers, actingVote: 'v-acting' }] });
  assert.equal(end('smokey', row(voted, 'jet-covers-smokey'), voted), null, 'from a voted cover too');
  assert.equal(end('crank'), ACTING_END_NEEDS_VOTE);
  assert.equal(end('lou'), 'Only that chapter’s board can end this term.', 'NEC officers have no branch');
  assert.equal(end('spanner'), 'Only that chapter’s board can end this term.');
  const ended = world({ seats: [jetCovers], votes: [boardVote('v-end-jet')] });
  assert.equal(end('crank', cover, ended), null, 'a carried board-majority vote naming Jet as President');
  assert.equal(end('lou', cover, ended), 'Only that chapter’s board can end this term.');
  const tooEarly = world({ seats: [JET_COVERS], votes: [boardVote('v-end-jet')] });
  assert.equal(end('crank', row(tooEarly, 'jet-covers-smokey'), tooEarly), ACTING_END_NEEDS_VOTE, 'a vote that closed before this stint started');
  // An acting vote never counts as one that ends acting.
  const seated = world({ seats: [jetCovers], votes: [boardVote('v-acting', { actingRequestId: 'crank-asks-jet' })] });
  assert.equal(end('crank', cover, seated), ACTING_END_NEEDS_VOTE);
  // A 9.3 removal in the role's own shape counts once it closed since the stint started.
  const pennyActing = stint('penny-acting-treasurer', 'penny', 'west', 'treasurer', { startedOn: '2026-11-10', appointedBy: 'rusty' });
  const removal93 = (closedAt: string) => world({
    ended: { 'penny-treasurer': '2026-11-10' }, seats: [pennyActing],
    votes: [boardVote('v-remove-penny', { chapterId: 'west', subjectMemberId: 'penny', subjectRole: 'treasurer', electorate: 'chapter_patched', threshold: 'two_thirds', closedAt })],
  });
  const after = removal93('2026-11-14T01:00:00.000Z');
  assert.equal(endTermProblem(who(after, 'rusty'), row(after, 'penny-acting-treasurer'), after, AT), null, 'a 9.3 vote outlasts a step-down');
  const before = removal93('2026-11-09T01:00:00.000Z');
  assert.equal(endTermProblem(who(before, 'rusty'), row(before, 'penny-acting-treasurer'), before, AT), ACTING_END_NEEDS_VOTE, 'closed before the stint started');
  // A lapsed stint has already ended, closed or not.
  const lapsed = world({ seats: [stint('crank-acting-treasurer', 'crank', 'north', 'treasurer', { startedOn: '2026-10-01', actingUntil: '2026-11-14' })] });
  assert.equal(end('crank', row(lapsed, 'crank-acting-treasurer'), lapsed), 'That term has already ended.');
});

test('removal votes need no acting request; an acting row takes the board-majority shape too', () => {
  const tgSeat = seat('spanner-tg', 'spanner', 'west', 'tail_gunner');
  const tgVote = (over: Partial<Vote> = {}) => boardVote('v-tg', { chapterId: 'west', subjectMemberId: 'spanner', subjectRole: 'tail_gunner', ...over });
  assert.equal(hasCarriedRemovalVote(tgSeat, world({ seats: [tgSeat], votes: [tgVote()] }), AT), true);
  assert.equal(hasCarriedRemovalVote(tgSeat, world({ seats: [tgSeat], votes: [tgVote({ actingRequestId: 'ar-1' })] }), AT), false, 'an acting vote');
  // A full board seat still takes only its 9.3 shape.
  const smokeyMajority = boardVote('v-smokey', { subjectMemberId: 'smokey' });
  const w = world({ votes: [smokeyMajority] });
  assert.equal(hasCarriedRemovalVote(row(w, 'smokey-president'), w, AT), false);
  assert.equal(endTermProblem(who(w, 'crank'), row(w, 'smokey-president'), w, AT), PRESIDENT_NEEDS_VOTE);
});

test('the Auditor in a second seat can’t record, propose, confirm, change or end acting for a President or Treasurer seat', () => {
  const kimVp = seat('kim-west-vp', 'kim', 'west', 'vice_president');
  const open = world({ without: ['penny-treasurer', 'torque-secretary'], seats: [kimVp] });
  const kim = who(open, 'kim');
  assert.equal(auditorStaysOut(kim, 'treasurer', open.positions), true);
  assert.equal(auditorStaysOut(kim, 'secretary', open.positions), false);
  assert.equal(auditorStaysOut(who(open, 'rusty'), 'treasurer', open.positions), false);
  assert.equal(appointActingProblem(kim, who(open, 'spanner'), 'west', 'treasurer', UNTIL, 'No Treasurer', open, AT), AUDITOR_STAYS_OUT);
  assert.equal(appointActingProblem(kim, who(open, 'spanner'), 'west', 'secretary', UNTIL, 'No Secretary', open, AT), null);
  assert.equal(requestActingProblem(kim, who(open, 'spanner'), 'west', 'treasurer', null, UNTIL, 'No Treasurer', open, AT), AUDITOR_STAYS_OUT);
  const proposed = world({ without: ['penny-treasurer'], seats: [kimVp], requests: [ask('rusty-asks-hal', { chapterId: 'west', role: 'treasurer', memberId: 'hal', covers: null, requestedBy: 'rusty' })] });
  assert.equal(confirmActingProblem(who(proposed, 'kim'), proposed.actingRequests![0], proposed, AT), AUDITOR_STAYS_OUT);
  const acting = world({ without: ['penny-treasurer'], seats: [kimVp, stint('spanner-acting-treasurer', 'spanner', 'west', 'treasurer', { startedOn: '2026-11-05', appointedBy: 'rusty' })], votes: [boardVote('v-end-spanner', { chapterId: 'west', subjectMemberId: 'spanner', subjectRole: 'treasurer' })] });
  const stintRow = row(acting, 'spanner-acting-treasurer');
  assert.equal(setActingUntilProblem(who(acting, 'kim'), stintRow, '2027-01-10', acting, AT), AUDITOR_STAYS_OUT);
  assert.equal(endTermProblem(who(acting, 'kim'), stintRow, acting, AT), AUDITOR_STAYS_OUT);
  assert.equal(endTermProblem(who(acting, 'rusty'), stintRow, acting, AT), null);
  // In full too (11.8, tightening 3).
  assert.equal(appointProblem(kim, who(open, 'hal'), 'west', 'treasurer', open, AT), AUDITOR_STAYS_OUT);
  assert.equal(appointProblem(kim, who(open, 'hal'), 'west', 'secretary', open, AT), null);
});

test('appointProblem: a full appointment over acting', () => {
  const crankActing = stint('crank-acting-treasurer', 'crank', 'north', 'treasurer', { startedOn: '2026-11-01' });
  const w = world({ seats: [crankActing] });
  const appoint = (me: string, target: string, chapter: string, role: PositionRole, data: ClubData) => appointProblem(who(data, me), who(data, target), chapter, role, data, AT);
  assert.equal(appoint('smokey', 'crank', 'north', 'treasurer', w), null, 'electing the acting person ends their acting');
  assert.equal(appoint('jet', 'ned', 'north', 'treasurer', w), REPLACE_NEEDS_END);
  assert.equal(appoint('jet', 'ned', 'north', 'treasurer', world({ seats: [crankActing], meetings: [meet('north-acm', 'north', 'agm', '2026-11-12')] })), REPLACE_NEEDS_END, 'an ACM since changes nothing');
  // Lou (an NEC officer) can't replace an Acting President.
  const actingPresident = world({ ended: { 'smokey-president': '2026-11-01' }, seats: [stint('jet-acting-president', 'jet', 'north', 'president', { startedOn: '2026-11-02' })] });
  assert.equal(appoint('lou', 'ned', 'north', 'president', actingPresident), REPLACE_NEEDS_END);
  assert.equal(appoint('lou', 'jet', 'north', 'president', actingPresident), null, 'electing Jet');
  // A non-board role seats a full holder beside acting.
  assert.equal(appoint('rusty', 'hal', 'west', 'tail_gunner', world({ seats: [stint('spanner-acting-tg', 'spanner', 'west', 'tail_gunner')] })), null);
  // A cover is no holder, but the covered seat still is.
  const covered = world({ seats: [JET_COVERS] });
  assert.equal(appoint('lou', 'ned', 'north', 'president', covered), 'That seat is taken. End the current term first.');
  // After a vote ended their acting there.
  const endedByVote = world({
    seats: [{ ...crankActing, endedOn: '2026-11-14', endedReason: 'removed' }],
    votes: [boardVote('v-end-crank', { subjectMemberId: 'crank', subjectRole: 'treasurer' })],
  });
  assert.equal(appoint('smokey', 'crank', 'north', 'treasurer', endedByVote), ENDED_BY_VOTE);
  assert.equal(appoint('smokey', 'ned', 'north', 'treasurer', endedByVote), null, 'someone else');
  const seatedByVote = { ...endedByVote, votes: [boardVote('v-acting', { subjectMemberId: 'crank', subjectRole: 'treasurer', actingRequestId: 'ar-1' })] };
  assert.equal(appoint('smokey', 'crank', 'north', 'treasurer', seatedByVote), null, 'an acting vote isn’t an end vote');
  // Chair and books apart, only against an acting row (17.6: a full Treasurer can be seated President).
  const books = world({ ended: { 'smokey-president': '2026-11-01' }, seats: [crankActing] });
  assert.equal(appoint('lou', 'crank', 'north', 'president', books), BOOKS_NOT_CHAIR);
  assert.equal(appoint('lou', 'penny', 'west', 'president', world({ ended: { 'rusty-president': '2026-11-01' } })), null);
  assert.equal(appoint('crank', 'jet', 'north', 'treasurer', covered), CHAIR_NOT_BOOKS, 'an Acting President, in full as Treasurer');
  assert.equal(appoint('crank', 'smokey', 'north', 'treasurer', world()), null, 'a full President, as today');
  // A lapsed stint, still open, leaves its seat free.
  const lapsedVp = world({ ended: { 'jet-vp': '2026-10-01' }, seats: [stint('ned-acting-vp', 'ned', 'north', 'vice_president', { startedOn: '2026-10-15', actingUntil: '2026-11-14' })] });
  assert.equal(appoint('smokey', 'gus', 'north', 'vice_president', lapsedVp), null);
});

// ---------------------------------------------------------------------------
// Where the app's acting checks first met the database (Task 12's shared route cases): each of
// these is the answer the database's RPC gives (supabase/migrations/20270870000000_acting_roles.sql §4, §5).
// ---------------------------------------------------------------------------

test('acting needs an approved member, as the database checks after the chapter', () => {
  const benched = world({ members: { ned: { approval: 'suspended' } } });
  const p = (role: PositionRole) => actingProblem(who(benched, 'ned'), 'north', role, null, UNTIL, benched);
  assert.equal(p('officer'), 'Approve them first.');
  assert.equal(p('treasurer'), 'Approve them first.', 'before hold_problem and the seat');
  assert.equal(actingProblem(who(benched, 'ned'), 'west', 'officer', null, UNTIL, benched), 'They’re not a member of that chapter.', 'the chapter comes first');
  assert.equal(appointActingProblem(who(benched, 'smokey'), who(benched, 'ned'), 'north', 'officer', UNTIL, 'Help out', benched, AT), 'Approve them first.');
});

test('a cover has to point at the held, full holder of that very seat (SEAT_ENDED), as acting_problem checks it', () => {
  // Five on North's board, so a voted proposal has three electors left.
  const five = world({ seats: FIVE });
  const propose = (target: string, role: PositionRole, covers: Position, data = five) =>
    requestActingProblem(who(data, 'crank'), who(data, target), 'north', role, covers, UNTIL, 'Smokey can’t be reached', data, AT);
  assert.equal(propose('jet', 'sergeant_at_arms', row(five, 'smokey-president')), SEAT_ENDED, 'another seat’s row');
  assert.equal(propose('ned', 'treasurer', row(five, 'gus-treasurer')), null, 'the right seat');
  const covered = world({ seats: [...FIVE, JET_COVERS] });
  assert.equal(
    actingProblem(who(covered, 'crank'), 'north', 'vice_president', row(covered, 'jet-covers-smokey'), UNTIL, covered),
    SEAT_ENDED, 'a cover can’t cover a cover',
  );
  // The seat is checked where acting_problem checks it: after the member, before a waiting request.
  const ended = world({ seats: FIVE, ended: { 'smokey-president': AT } });
  assert.equal(
    actingProblem(who(ended, 'spanner'), 'north', 'president', row(ended, 'smokey-president'), UNTIL, ended),
    'They’re not a member of that chapter.',
  );
  assert.equal(actingProblem(who(ended, 'jet'), 'north', 'president', row(ended, 'smokey-president'), UNTIL, ended), SEAT_ENDED);
});

test('a cover of a seat that has ended needs a vote whoever asks, and its old holder is an elector again', () => {
  // Smokey stepped down as President today but still sits as Secretary; Ned and Gus are seated too.
  const data = world({
    ended: { 'smokey-president': AT },
    seats: [seat('smokey-secretary', 'smokey', 'north', 'secretary'), seat('gus-treasurer', 'gus', 'north', 'treasurer')],
  });
  const asks = { chapterId: 'north', role: 'president' as const, memberId: 'jet', covers: 'smokey-president', requestedBy: 'smokey' };
  assert.equal(requestNeedsVote(asks, data, AT), true, 'the seat has no holder now, so Smokey isn’t asking from it');
  assert.deepEqual(actingElectors('north', 'president', 'jet', 'smokey-president', data), ['crank', 'gus', 'smokey']);
  assert.equal(
    requestActingProblem(who(data, 'smokey'), who(data, 'jet'), 'north', 'president', row(data, 'smokey-president'), UNTIL, 'Away', data, AT),
    SEAT_ENDED,
  );
});

test('asking for a cover: not for yourself, a board seat only, and not within 28 days of the board voting it down', () => {
  const tg = world({ seats: [seat('spanner-tg', 'spanner', 'west', 'tail_gunner'), seat('hal-sec', 'hal', 'west', 'sergeant_at_arms')] });
  const askFor = (me: string, seatId: string, target: string, data: ClubData) =>
    requestCoverProblem(who(data, me), row(data, seatId), who(data, target), UNTIL, 'Away', data, AT);
  assert.equal(askFor('smokey', 'smokey-president', 'smokey', world()), NOT_YOURSELF);
  assert.equal(askFor('spanner', 'spanner-tg', 'hal', tg), OWN_SEAT_ONLY, 'a Tail Gunner seat isn’t a board seat');
  // Smokey proposed Crank as his cover (route 3) and the board voted it down yesterday.
  const crankAsk = ask('smokey-asks-crank', { memberId: 'crank' });
  const lost = world({ requests: [crankAsk], votes: [boardVote('v-acting', { subjectMemberId: 'crank', actingRequestId: 'smokey-asks-crank', result: 'lost' })] });
  assert.equal(askFor('smokey', 'smokey-president', 'jet', lost), ASKED_RECENTLY);
  assert.equal(askFor('smokey', 'smokey-president', 'smokey', lost), NOT_YOURSELF, 'who comes first');
});

test('ASKED_RECENTLY counts 28 days from the day it was voted down, as the database does', () => {
  const crankAsks = ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' });
  const rejected = (closedAt: string) => world({ seats: FIVE, requests: [{ ...crankAsks, closedAt, outcome: 'rejected' }] });
  const again = (data: ClubData) =>
    requestActingProblem(who(data, 'crank'), who(data, 'jet'), 'north', 'president', row(data, 'smokey-president'), UNTIL, 'Smokey can’t be reached', data, AT);
  assert.equal(again(rejected('2026-10-19T01:00:00.000Z')), ASKED_RECENTLY, '27 days ago');
  assert.equal(again(rejected('2026-10-18T01:00:00.000Z')), null, '28 days ago: the wait is over');
});

test('withdrawing settles first, and the holder is whoever holds the covered seat now', () => {
  const crankAsks = ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' });
  const lost = world({ seats: FIVE, requests: [crankAsks], votes: [boardVote('v-acting', { actingRequestId: 'crank-asks-jet', result: 'lost' })] });
  assert.equal(withdrawRequestProblem(who(lost, 'jet'), crankAsks, lost, AT), NO_REQUEST, 'the lost vote closed it');
  // Smokey stepped down after Crank asked: he's no longer the holder, so can't withdraw it.
  const stepped = world({ seats: FIVE, requests: [crankAsks], ended: { 'smokey-president': AT } });
  assert.equal(withdrawRequestProblem(who(stepped, 'smokey'), crankAsks, stepped, AT), WITHDRAW_WHO);
  assert.equal(withdrawRequestProblem(who(stepped, 'jet'), crankAsks, stepped, AT), null, 'the stand-in still can');
});

test('ending a term settles first: a stint that lapsed last night gives no board standing', () => {
  // Ned's Acting Secretary stint ended yesterday; a carried vote removes Gus as Tail Gunner.
  const data = world({
    seats: [
      stint('ned-acting-secretary', 'ned', 'north', 'secretary', { startedOn: '2026-10-01', actingUntil: '2026-11-14' }),
      seat('gus-tg', 'gus', 'north', 'tail_gunner'),
    ],
    votes: [boardVote('v-gus', { subjectMemberId: 'gus', subjectRole: 'tail_gunner' })],
  });
  assert.equal(endTermProblem(who(data, 'ned'), row(data, 'gus-tg'), data, AT), 'Only that chapter’s board can end this term.');
  assert.equal(endTermProblem(who(data, 'crank'), row(data, 'gus-tg'), data, AT), null);
});

test('a stint the board voted for needs a new vote to run longer, whoever asks', () => {
  const voted = world({ seats: [{ ...JET_COVERS, actingVote: 'v-acting' }] });
  assert.equal(setActingUntilProblem(who(voted, 'jet'), row(voted, 'jet-covers-smokey'), '2027-01-10', voted, AT), VOTED_NEEDS_NEW_VOTE);
  assert.equal(setActingUntilProblem(who(voted, 'crank'), row(voted, 'jet-covers-smokey'), '2027-01-10', voted, AT), VOTED_NEEDS_NEW_VOTE);
});

test('the acting routes take approved members who aren’t Family, as is_approved_member does', () => {
  const family = world({ members: { smokey: { status: 'family' } } });
  assert.equal(
    appointActingProblem(who(family, 'smokey'), who(family, 'crank'), 'north', 'treasurer', UNTIL, 'No Treasurer', family, AT),
    'Only approved members can do that.',
  );
});
