import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import type { Position, Vote } from './types';
import {
  accessLevel,
  appointProblem,
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
  isNecOfficer,
  PRESIDENT_ENDED_BY,
  PRESIDENT_NEEDS_VOTE,
  ROLE_NEEDS_VOTE,
  seesBoardOf,
  pendingFor,
  SECRETARY_NEEDS_VOTE,
  SUPPORTER_NEEDS_NOTICE,
  visibleMembers,
  withHolders,
} from './access';
import { isChapterless } from './labels';

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
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'officer', d)), true);
});

test('nobody appoints themselves', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-torque'), 'ch-west', 'officer', d)), false);
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-rusty'), null, 'nec_auditor', d)), false);
});

test('a chapter seat only goes to a member of that chapter', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-jet'), 'ch-west', 'officer', d)), false);
  // not even when national does the appointing
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-jet'), 'ch-west', 'officer', d)), false);
});

test('applicants cannot be appointed', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-dylan'), 'ch-west', 'officer', d)), false);
});

test('a member cannot hold the same open role twice', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-chook'), 'ch-west', 'officer', d)), false);
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
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-jet'), null, 'nec_chair', noChair)), false);
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
});

// West President seat vacated: Rusty's term ended, he stays National Chair.
const vacantWest = {
  ...d,
  positions: P.map((p): Position => (p.id === 'p-1' ? { ...p, endedOn: '2026-10-01' } : p)),
};

test('only NEC officers seat a President', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'president', vacantWest)), false);
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-spanner'), 'ch-west', 'president', vacantWest)), false);
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-spanner'), 'ch-west', 'president', vacantWest)), true);
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
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-chook'), null, 'founder', d)), false);
  assert.equal(allowed(endTermProblem(m('m-rusty'), withFounder.positions.find((p) => p.id === 'p-founder')!, withFounder, TODAY)), false);
});

test('Ride Committee and Assistant Tail Gunner are ordinary chapter roles', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'ride_committee', d)), true);
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'assistant_tail_gunner', d)), true);
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

test('moving an FNG, Full Member or Nomad to Supporter follows a decided 5.5 notice, unless it’s at their request (L2)', () => {
  const torque = m('m-torque');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'supporter', d, TODAY), SUPPORTER_NEEDS_NOTICE, 'an FNG, no notice decided');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'supporter', d, TODAY, true), null, 'at her request');
  assert.equal(statusChangeProblem(torque, m('m-throttle'), 'legacy', d, TODAY), null, 'other moves aren’t gated');
  assert.equal(statusChangeProblem(m('m-smokey'), m('m-ratchet'), 'supporter', d, TODAY), SUPPORTER_NEEDS_NOTICE, 'a Nomad');
  assert.equal(statusChangeProblem(torque, m('m-patches'), 'fng', d, TODAY), null, 'a Supporter becomes an FNG');
  // Gravel's open notice doesn't count; a decided one within 90 days does, an older one doesn't.
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', d, TODAY), 'End their positions first.', 'the position check still comes first');
  const noSeat = { ...d, positions: d.positions.filter((p) => p.id !== 'p-6') };
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', noSeat, TODAY), SUPPORTER_NEEDS_NOTICE, 'the notice is still open');
  assert.equal(decidedNoticeFor('m-gravel', noSeat, TODAY), null);
  const decided = (closedOn: string) => ({
    ...noSeat,
    statusNotices: noSeat.statusNotices!.map((n) => ({ ...n, outcome: 'decided' as const, closedOn, closedBy: 'm-torque' })),
  });
  assert.equal(decidedNoticeFor('m-gravel', decided('2026-10-20'), TODAY)?.id, 'sn-gravel');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', decided('2026-10-20'), TODAY), null, 'after the decided notice');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', decided('2026-07-31'), TODAY), null, '90 days is still in time');
  assert.equal(statusChangeProblem(torque, m('m-gravel'), 'supporter', decided('2026-07-30'), TODAY), SUPPORTER_NEEDS_NOTICE, '91 days is stale');
  assert.equal(statusChangeProblem(m('m-smokey'), m('m-gravel'), 'supporter', decided('2026-10-20'), TODAY), 'Only that chapter’s board can change this member’s status.', 'the board gate comes first');
});
