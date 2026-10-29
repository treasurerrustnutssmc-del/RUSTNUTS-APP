// The National Auditor reviews and never runs anything (constitution v4, 11.8).
// See docs/superpowers/specs/2026-10-29-national-auditor-design.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessLevel, appointProblem, AUDITOR_NEEDS_VOTE, AUDITOR_NOT_NEC, canApprove, canManageMember, canSeeMember, canSeePhone, canSeePrivate,
  endTermProblem, hasCarriedAuditorVote, isAuditor, isBoardOf, isNational, isNecOfficer, renewAuditorProblem,
  reviewsChapter, statusChangeProblem,
} from './access';
import { canManageFees, canSeeFees } from './fees';
import { isRideLeader } from './liveRide';
import { canSeeActionItem, canSeeMeeting, canSeeMinutes, reviewsScope, runsScope } from './meetings';
import { seesItem, seesOrder } from './merch';
import { club, member, who } from './stage4.testkit';
import type { ActionItem, ClubData, Meeting, MerchItem, MerchOrder, Position, Vote } from './types';
import { AUDITOR_VOTE, canSeeVote, openVoteProblem, REINSTATE_VOTE, type VoteInput } from './votes';

const TODAY = '2026-10-29';
const NOW = '2026-10-29T01:00:00.000Z';

const auditorVote = (memberId: string, over: Partial<Vote> = {}): Vote => ({
  id: `v-aud-${memberId}`, chapterId: null, meetingId: null, subjectMemberId: memberId, question: 'Appoint the National Auditor?',
  details: null, electorate: 'nec', threshold: 'two_thirds', secret: false, quorum: 1,
  openedAt: '2026-10-10T00:00:00.000Z', closesAt: '2026-10-20T00:00:00.000Z', closedAt: '2026-10-20T00:00:00.000Z',
  result: 'carried', castingVote: null, tally: null, electorIds: [], votedIds: [], ballots: [], createdBy: 'chair', ...over,
});

/** The Stage 4 club plus a West President, so the NEC has a voter. */
function auditClub(over: Partial<ClubData> = {}): ClubData {
  const base = club();
  return club({
    members: [...base.members, member('pres', { patchedOn: '2020-01-01' })],
    positions: [...base.positions, { id: 'p-pres', memberId: 'pres', chapterId: 'west', role: 'president', startedOn: '2025-01-01', endedOn: null }],
    ...over,
  });
}

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'mt-board', chapterId: 'west', kind: 'board', title: 'Board meeting', startsAt: '2026-10-20T08:00:00.000Z',
  location: null, agenda: null, minutes: 'Draft notes', minutesSharedAt: null, minutesApprovedAt: null,
  minutesApprovedBy: null, cancelledAt: null, createdBy: 'sec', ...over,
} as Meeting);

// 1. Not on the NEC -------------------------------------------------------------------------------

test('the Auditor is not on the NEC and runs nothing (11.2, 11.8)', () => {
  const d = auditClub();
  const aud = who(d, 'auditor');
  assert.equal(isAuditor(aud, d.positions), true);
  assert.equal(isNational(aud.id, d.positions), false);
  assert.equal(isNecOfficer(aud.id, d.positions), false);
  assert.equal(isBoardOf(aud, 'west', d.positions), false);
  assert.equal(accessLevel(aud, d.positions), 'member');
  assert.equal(runsScope(aud, null, d.positions), false);
  assert.equal(runsScope(aud, 'west', d.positions), false);
  // The Chairman, Secretary and Presidents still are.
  assert.equal(isNational('chair', d.positions), true);
  assert.equal(isNational('pres', d.positions), true);
  assert.equal(isNecOfficer('chair', d.positions), true);
});

test('the Auditor can’t approve, manage, seat or end Presidents', () => {
  const d = auditClub();
  const aud = who(d, 'auditor');
  assert.equal(canApprove(aud, who(d, 'applicant'), d.positions), false);
  assert.equal(canManageMember(aud, who(d, 'rider'), d.positions), false);
  assert.notEqual(statusChangeProblem(aud, who(d, 'rider'), 'supporter', d, TODAY), null);
  assert.notEqual(appointProblem(aud, who(d, 'rider'), 'west', 'president', d), null);
  const presSeat = d.positions.find((p) => p.id === 'p-pres')!;
  assert.notEqual(endTermProblem(aud, presSeat, d), null);
  // The Chairman still can.
  assert.equal(endTermProblem(who(d, 'chair'), presSeat, d), null);
});

// 2. What the Auditor reads -----------------------------------------------------------------------

test('the Auditor reads membership records but not private details (11.8)', () => {
  const d = auditClub();
  const aud = who(d, 'auditor');
  assert.equal(reviewsChapter(aud, 'west', d.positions), true);
  assert.equal(reviewsChapter(who(d, 'rider'), 'west', d.positions), false);
  assert.equal(canSeeMember(aud, who(d, 'applicant'), d.positions), true);
  assert.equal(canSeeMember(who(d, 'rider'), who(d, 'applicant'), d.positions), false);
  assert.equal(canSeePrivate(aud, who(d, 'rider'), d.positions), false);
  assert.equal(canSeePhone(aud, who(d, 'rider'), d.positions), false);
});

test('the Auditor reads fees but can’t handle them', () => {
  const d = auditClub();
  const aud = who(d, 'auditor');
  assert.equal(canSeeFees(aud, 'west', d.positions), true);
  assert.equal(canManageFees(aud, 'west', d.positions), false);
  assert.equal(canSeeFees(who(d, 'rider'), 'west', d.positions), false);
});

test('the Auditor reads board and NEC meetings, draft minutes, action items and votes', () => {
  const d = auditClub();
  const aud = who(d, 'auditor');
  assert.equal(reviewsScope(aud, 'west', d.positions), true);
  assert.equal(reviewsScope(aud, null, d.positions), true);
  assert.equal(reviewsScope(who(d, 'rider'), 'west', d.positions), false);
  assert.equal(reviewsScope(who(d, 'sec'), 'west', d.positions), true);
  const board = meeting();
  const nec = meeting({ id: 'mt-nec', chapterId: null, kind: 'nec' });
  assert.equal(canSeeMeeting(aud, board, d.positions), true);
  assert.equal(canSeeMeeting(aud, nec, d.positions), true);
  assert.equal(canSeeMinutes(aud, board, d.positions), true);
  assert.equal(canSeeMeeting(who(d, 'rider'), board, d.positions), false);
  const item: ActionItem = { id: 'ai', chapterId: 'west', meetingId: null, title: 'Fix it', ownerId: 'sec', dueOn: null, doneOn: null } as ActionItem;
  assert.equal(canSeeActionItem(aud, item, d.positions), true);
  const boardVote = auditorVote('rider', { id: 'v-b', chapterId: 'west', subjectMemberId: null, electorate: 'chapter_board', threshold: 'majority' });
  assert.equal(canSeeVote(aud, boardVote, d.positions), true);
  assert.equal(canSeeVote(who(d, 'rider'), boardVote, d.positions), false);
});

test('the Auditor reads merch items and orders (event funds) but doesn’t run them', () => {
  const item: MerchItem = {
    id: 'mi', chapterId: 'west', name: 'Tee', details: null, sizes: ['L'], priceCents: 3000, patchedOnly: false,
    status: 'proposed', proposedBy: 'sec', proposedAt: NOW, decidedBy: null, decidedAt: null, declineReason: null,
  } as MerchItem;
  const order: MerchOrder = {
    id: 'mo', itemId: 'mi', memberId: 'rider', size: 'L', qty: 1, unitCents: 3000, note: null, status: 'waiting',
    orderedAt: NOW, decidedBy: null, decidedAt: null, declineReason: null, paidOn: null, ledgerEntryId: null, handedOverOn: null,
  } as MerchOrder;
  const d = auditClub({ merchItems: [item], merchOrders: [order] });
  const aud = who(d, 'auditor');
  assert.equal(seesItem(aud, item, d), true);
  assert.equal(seesOrder(aud, order, d), true);
  assert.equal(seesItem(who(d, 'fng'), item, d), false);
});

// 3. Appointment by a two-thirds NEC vote, renewable ---------------------------------------------

const voteInput = (over: Partial<VoteInput> = {}): VoteInput => ({
  chapterId: null, meetingId: null, subjectMemberId: 'rider', question: 'Appoint Rider as National Auditor?', details: null,
  electorate: 'nec', threshold: 'two_thirds', secret: false, quorum: 1, closesAt: '2026-11-05T01:00:00.000Z', ...over,
});

test('an NEC two-thirds vote about a Full Member is an auditor appointment vote (11.8)', () => {
  const d = auditClub();
  const chair = who(d, 'chair');
  assert.equal(openVoteProblem(chair, voteInput(), d, NOW), null);
  assert.equal(openVoteProblem(chair, voteInput({ threshold: 'majority' }), d, NOW), AUDITOR_VOTE);
  assert.equal(openVoteProblem(chair, voteInput({ subjectMemberId: 'tre' }), d, NOW), AUDITOR_VOTE); // a Treasurer
  assert.equal(openVoteProblem(chair, voteInput({ subjectMemberId: 'pres' }), d, NOW), AUDITOR_VOTE); // a President
  // Reinstatement is unchanged: a majority vote on someone who isn't Full, Nomad or an FNG.
  assert.equal(openVoteProblem(chair, voteInput({ subjectMemberId: 'legacy', threshold: 'majority' }), d, NOW), null);
  assert.equal(openVoteProblem(chair, voteInput({ subjectMemberId: 'legacy' }), d, NOW), REINSTATE_VOTE);
  // The Auditor can't open one.
  assert.notEqual(openVoteProblem(who(d, 'auditor'), voteInput(), d, NOW), null);
});

test('appointing the Auditor needs a carried two-thirds NEC vote about them in 90 days', () => {
  const free = auditClub();
  const d = { ...free, positions: free.positions.filter((p) => p.role !== 'nec_auditor') };
  const chair = who(d, 'chair');
  const rider = who(d, 'rider');
  assert.equal(appointProblem(chair, rider, null, 'nec_auditor', d), AUDITOR_NEEDS_VOTE);
  const carried = { ...d, votes: [auditorVote('rider')] };
  assert.equal(hasCarriedAuditorVote('rider', carried, TODAY), true);
  assert.equal(appointProblem(chair, rider, null, 'nec_auditor', carried, TODAY), null);
  // Lost, still open, about someone else, a majority vote, or too old: not enough.
  for (const v of [
    auditorVote('rider', { result: 'lost' }),
    auditorVote('rider', { closedAt: null, result: null }),
    auditorVote('sec'),
    auditorVote('rider', { threshold: 'majority' }),
    auditorVote('rider', { closedAt: '2026-07-01T00:00:00.000Z' }),
  ]) {
    assert.equal(appointProblem(chair, rider, null, 'nec_auditor', { ...d, votes: [v] }, TODAY), AUDITOR_NEEDS_VOTE);
  }
});

test('the Chairman renews the Auditor for twelve months with a fresh carried vote', () => {
  const seat: Position = { id: 'p-auditor', memberId: 'auditor', chapterId: null, role: 'nec_auditor', startedOn: '2025-12-01', endedOn: null };
  const base = auditClub();
  const d = { ...base, positions: [...base.positions.filter((p) => p.role !== 'nec_auditor'), seat], votes: [auditorVote('auditor')] };
  const chair = who(d, 'chair');
  assert.equal(renewAuditorProblem(chair, d, TODAY), null); // ends 01/12/2026, within 60 days
  assert.notEqual(renewAuditorProblem(who(d, 'pres'), d, TODAY), null);
  assert.notEqual(renewAuditorProblem(chair, { ...d, votes: [] }, TODAY), null);
  const early = { ...d, positions: d.positions.map((p) => (p.id === 'p-auditor' ? { ...p, startedOn: '2026-08-01' } : p)) };
  assert.notEqual(renewAuditorProblem(chair, early, TODAY), null);
  const none = { ...d, positions: d.positions.filter((p) => p.role !== 'nec_auditor') };
  assert.notEqual(renewAuditorProblem(chair, none, TODAY), null);
});

// 4. Review fixes -----------------------------------------------------------------------------------

test('the Auditor can’t also be National Chairman or Secretary, either way round', () => {
  const base = auditClub();
  const withVote = (d: ClubData, id: string) => ({ ...d, votes: [auditorVote(id)] });
  const chair = who(base, 'chair');
  // The sitting Auditor can't be seated as National Secretary.
  assert.equal(appointProblem(chair, who(base, 'auditor'), null, 'nec_secretary', base, TODAY), AUDITOR_NOT_NEC);
  // A National Secretary can't be voted on or seated as Auditor.
  const free = { ...base, positions: [...base.positions.filter((p) => p.role !== 'nec_auditor'),
    { id: 'p-nsec', memberId: 'rider', chapterId: null, role: 'nec_secretary' as const, startedOn: '2025-08-16', endedOn: null }] };
  assert.equal(appointProblem(chair, who(free, 'rider'), null, 'nec_auditor', withVote(free, 'rider'), TODAY), AUDITOR_NOT_NEC);
  assert.equal(openVoteProblem(chair, voteInput({ subjectMemberId: 'rider' }), free, NOW), AUDITOR_VOTE);
  assert.equal(openVoteProblem(chair, voteInput({ subjectMemberId: 'chair' }), free, NOW), AUDITOR_VOTE);
});

test('a vote that closed before the Auditor’s last term began doesn’t seat them again', () => {
  const base = auditClub();
  const ended: Position = { id: 'p-auditor', memberId: 'auditor', chapterId: null, role: 'nec_auditor', startedOn: '2026-10-21', endedOn: '2026-10-28' };
  const d = { ...base, positions: [...base.positions.filter((p) => p.role !== 'nec_auditor'), ended], votes: [auditorVote('auditor')] };
  assert.equal(hasCarriedAuditorVote('auditor', d, TODAY), false);
  assert.equal(appointProblem(who(d, 'chair'), who(d, 'auditor'), null, 'nec_auditor', d, TODAY), AUDITOR_NEEDS_VOTE);
  // A vote after that term began does.
  const fresh = { ...d, votes: [auditorVote('auditor', { closedAt: '2026-10-28T00:00:00.000Z' })] };
  assert.equal(hasCarriedAuditorVote('auditor', fresh, TODAY), true);
});

test('nobody renews themselves as Auditor', () => {
  const base = auditClub();
  const seat: Position = { id: 'p-auditor', memberId: 'chair', chapterId: null, role: 'nec_auditor', startedOn: '2025-12-01', endedOn: null };
  const d = { ...base, positions: [...base.positions.filter((p) => p.role !== 'nec_auditor'), seat], votes: [auditorVote('chair')] };
  assert.equal(renewAuditorProblem(who(d, 'chair'), d, TODAY), 'You can’t renew yourself.');
});

test('the Auditor doesn’t lead rides', () => {
  const d = auditClub();
  assert.equal(isRideLeader('auditor', d.positions), false);
  assert.equal(isRideLeader('chair', d.positions), true);
});
