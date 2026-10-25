// The rules constitution v4 (25 Oct 2026) changed for members, positions, fees and meetings.
// See docs/superpowers/specs/2026-10-25-constitution-v4-audit.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointProblem, appointWarnings, statusChangeProblem } from './access';
import { continuationFeeFor, continuationFeeProblem } from './fees';
import { decideApplicationProblem, fngReviewProblem } from './joining';
import { meetingKindLabel } from './labels';
import { noticeWarning, saveMeetingProblem, type MeetingInput } from './meetings';
import { club, member, who } from './stage4.testkit';
import type { ClubData, MemberPrivate, Position, Vote } from './types';

const seat = (id: string, memberId: string, chapterId: string | null, role: Position['role'], startedOn = '2025-01-01'): Position => ({
  id, memberId, chapterId, role, startedOn, endedOn: null,
});

const priv = (memberId: string, over: Partial<MemberPrivate> = {}): MemberPrivate => ({
  memberId, email: null, phone: null, licenceClass: null, licenceExpiry: null, firstAidExpiry: null,
  introducedBy: null, applicationNote: null, ...over,
});

const patchVote = (memberId: string, result: Vote['result'], closedAt: string | null = '2026-10-20T00:00:00.000Z'): Vote => ({
  id: `v-${memberId}-${result}`, chapterId: 'west', meetingId: null, subjectMemberId: memberId, question: 'Patch?',
  details: null, electorate: 'chapter_patched', threshold: 'unanimous', secret: true, quorum: 1,
  openedAt: '2026-10-10T00:00:00.000Z', closesAt: '2026-10-20T00:00:00.000Z', closedAt, result,
  castingVote: null, tally: null, electorIds: [], votedIds: [], ballots: [], createdBy: 'sec',
});

/** The Stage 4 test club plus a Supporter, a Family member, a Nomad and a West President. */
function v4Club(over: Partial<ClubData> = {}): ClubData {
  const base = club();
  return club({
    members: [
      ...base.members,
      member('sup', { status: 'supporter' }),
      member('fam', { status: 'family' }),
      member('nomad', { status: 'nomad', patchedOn: '2023-01-01' }),
      member('pres', { patchedOn: '2020-01-01' }),
    ],
    positions: [...base.positions, seat('p-pres', 'pres', 'west', 'president')],
    ...over,
  });
}

// --- A. Who can hold a Club Position ------------------------------------------------------------

const ONLY_PATCHED = 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
const NO_NOMAD_SEAT = 'Nomads can’t hold a board or national seat (9.1).';
const AUDITOR_APART = 'The National Auditor can’t also be a President or Treasurer (11.8).';

test('only Full and Nomad members hold Club positions', () => {
  const data = v4Club();
  const sec = who(data, 'sec');
  assert.equal(appointProblem(sec, who(data, 'fng'), 'west', 'officer', data), ONLY_PATCHED);
  assert.equal(appointProblem(sec, who(data, 'sup'), 'west', 'officer', data), ONLY_PATCHED);
  assert.equal(appointProblem(sec, who(data, 'fam'), 'west', 'tail_gunner', data), ONLY_PATCHED);
  assert.equal(appointProblem(sec, who(data, 'rider'), 'west', 'officer', data), null);
});

test('Nomads hold Non-Board roles only', () => {
  const data = v4Club();
  const sec = who(data, 'sec');
  assert.equal(appointProblem(sec, who(data, 'nomad'), 'west', 'officer', data), null);
  assert.equal(appointProblem(sec, who(data, 'nomad'), 'west', 'road_captain', data), NO_NOMAD_SEAT);
  assert.equal(appointProblem(who(data, 'chair'), who(data, 'nomad'), null, 'nec_secretary', data), NO_NOMAD_SEAT);
  assert.equal(appointProblem(who(data, 'chair'), who(data, 'rider'), null, 'nec_secretary', data), null);
});

test('the National Auditor stays apart from Presidents and Treasurers', () => {
  const data = v4Club();
  const chair = who(data, 'chair');
  assert.equal(appointProblem(chair, who(data, 'pres'), null, 'nec_auditor', data), AUDITOR_APART);
  assert.equal(appointProblem(chair, who(data, 'tre'), null, 'nec_auditor', data), AUDITOR_APART);
  assert.equal(appointProblem(who(data, 'northsec'), who(data, 'auditor'), 'north', 'treasurer', data), AUDITOR_APART);
  // The testkit's auditor holds the seat, so a second one waits; ending it frees the seat.
  const free = { ...data, positions: data.positions.filter((p) => p.role !== 'nec_auditor') };
  assert.equal(appointProblem(chair, who(free, 'rider'), null, 'nec_auditor', free), null);
});

test('the two-year and full-term rules show as warnings, not refusals', () => {
  const data = v4Club();
  const today = '2026-10-25';
  // rider has no patched date on file; nomad was patched in 2023; pres in 2020
  const fresh = { ...data, members: data.members.map((m) => (m.id === 'rider' ? { ...m, patchedOn: '2025-06-01' } : m)) };
  assert.deepEqual(appointWarnings(who(fresh, 'rider'), 'secretary', fresh, today), [
    'Board nominees need two years as a Full Member, unless the NEC waived it or they’re a founding officer (9.1).',
  ]);
  assert.deepEqual(appointWarnings(who(data, 'pres'), 'treasurer', data, today), []);
  assert.deepEqual(appointWarnings(who(data, 'pres'), 'vice_president', data, today), [
    'A President or Vice President should have served a full term in another board seat, unless they’re a founding officer or the NEC gave an exemption (9.4).',
  ]);
  const served = { ...data, positions: [...data.positions, { ...seat('p-old', 'pres', 'west', 'secretary', '2022-08-01'), endedOn: '2024-08-01' }] };
  assert.deepEqual(appointWarnings(who(served, 'pres'), 'vice_president', served, today), []);
  assert.deepEqual(appointWarnings(who(data, 'rider'), 'officer', data, today), [], 'Non-Board roles have no tenure rule');
});

// --- B. Status changes can't skip the patch vote ------------------------------------------------

const NEEDS_PATCH_VOTE = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
const NEC_REINSTATES = 'Only the NEC can bring someone back to Full or Nomad (5.6).';

test('an FNG becomes Full only after a carried patch vote', () => {
  const data = v4Club();
  const sec = who(data, 'sec');
  assert.equal(statusChangeProblem(sec, who(data, 'fng'), 'full', data), NEEDS_PATCH_VOTE);
  assert.equal(statusChangeProblem(sec, who(data, 'fng'), 'nomad', data), NEEDS_PATCH_VOTE);
  const lost = { ...data, votes: [patchVote('fng', 'lost')] };
  assert.equal(statusChangeProblem(sec, who(lost, 'fng'), 'full', lost), NEEDS_PATCH_VOTE);
  const open = { ...data, votes: [patchVote('fng', null, null)] };
  assert.equal(statusChangeProblem(sec, who(open, 'fng'), 'full', open), NEEDS_PATCH_VOTE);
  const carried = { ...data, votes: [patchVote('fng', 'carried')] };
  assert.equal(statusChangeProblem(sec, who(carried, 'fng'), 'full', carried), null);
});

test('only the NEC reinstates someone to Full or Nomad', () => {
  const data = v4Club();
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'sup'), 'full', data), NEC_REINSTATES);
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'legacy'), 'nomad', data), NEC_REINSTATES);
  assert.equal(statusChangeProblem(who(data, 'chair'), who(data, 'sup'), 'full', data), null);
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'rider'), 'nomad', data), null, 'Full to Nomad is the board’s');
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'nomad'), 'full', data), null, 'and back');
});

test('positions end before someone moves to a status that can’t hold them', () => {
  const base = v4Club();
  const data = { ...base, positions: [...base.positions, seat('p-off', 'rider', 'west', 'officer'), seat('p-rc', 'nomad', 'west', 'officer')] };
  const sec = who(data, 'sec');
  assert.equal(statusChangeProblem(sec, who(data, 'rider'), 'supporter', data), 'End their positions first.');
  assert.equal(statusChangeProblem(sec, who(data, 'rider'), 'nomad', data), null, 'Nomads keep Non-Board roles');
  assert.equal(statusChangeProblem(sec, who(data, 'tre'), 'nomad', data), 'End their board and national seats first (9.1).');
  assert.equal(statusChangeProblem(who(data, 'chair'), who(data, 'sec'), 'family', data), 'End their positions first.');
  assert.equal(statusChangeProblem(sec, who(data, 'rider'), 'legacy', data), 'End their positions first.');
});

test('the old status-change checks still come first', () => {
  const data = v4Club();
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'sec'), 'nomad', data), 'You can’t change your own status.');
  assert.equal(statusChangeProblem(who(data, 'rider'), who(data, 'fng'), 'supporter', data), 'Only that chapter’s board can change this member’s status.');
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'applicant'), 'fng', data), 'Approve them first.');
  assert.equal(statusChangeProblem(who(data, 'sec'), who(data, 'fng'), 'supporter', data), null);
});

// --- C. Learner riders can't become FNGs --------------------------------------------------------

const LEARNER = 'A learner permit rider can’t become an FNG yet (3.2).';

test('a learner permit rider can’t become an FNG', () => {
  const none = { for: null, against: null, abstained: null };
  const data = v4Club({ privates: [priv('applicant', { licenceClass: 'learner' }), priv('sup', { licenceClass: 'learner' })] });
  const sec = who(data, 'sec');
  assert.equal(decideApplicationProblem(sec, who(data, 'applicant'), 'fng', none, data), LEARNER);
  assert.equal(decideApplicationProblem(sec, who(data, 'applicant'), 'introduced', none, data), null);
  assert.equal(statusChangeProblem(sec, who(data, 'sup'), 'fng', data), LEARNER);
  const probationary = v4Club({ privates: [priv('applicant', { licenceClass: 'probationary_open' })] });
  assert.equal(decideApplicationProblem(sec, who(probationary, 'applicant'), 'fng', none, probationary), null);
  assert.equal(decideApplicationProblem(sec, who(v4Club(), 'applicant'), 'fng', none, v4Club()), null, 'no licence on file doesn’t block');
});

// --- B again: the Patch review outcome ----------------------------------------------------------

test('a Patch review needs nine months and a carried patch vote', () => {
  const none = { for: null, against: null, abstained: null };
  const data = v4Club(); // fng started 2026-04-24: the 6-month review is due 2026-10-24
  const sec = who(data, 'sec');
  assert.equal(
    fngReviewProblem(sec, who(data, 'fng'), 6, 'patch', { for: 9, against: 0, abstained: 0 }, data, '2026-10-24'),
    'Full Membership can’t be granted before nine months (4.7).',
  );
  const at9 = { ...data, decisions: [{ id: 'd6', memberId: 'fng', kind: 'fng_review' as const, atMonths: 6, outcome: 'continue' as const, status: null, votesFor: null, votesAgainst: null, votesAbstained: null, note: null, decidedOn: '2026-10-24', recordedBy: 'sec' }] };
  assert.equal(fngReviewProblem(sec, who(at9, 'fng'), 9, 'patch', none, at9, '2027-01-24'), NEEDS_PATCH_VOTE);
  const carried = { ...at9, votes: [patchVote('fng', 'carried')] };
  assert.equal(fngReviewProblem(sec, who(carried, 'fng'), 9, 'patch', none, carried, '2027-01-24'), null);
  assert.equal(fngReviewProblem(sec, who(at9, 'fng'), 9, 'continue', none, at9, '2027-01-24'), null);
});

// --- D. The continuation fee --------------------------------------------------------------------

test('the continuation fee is half the FNG fee for the year', () => {
  const rate = (status: 'fng' | 'full', amountCents: number) => ({ chapterId: 'west', fy: 2026, status, amountCents, dueOn: '2026-08-31' });
  const data = v4Club({ feeRates: [rate('fng', 25_001), rate('full', 40_000)] });
  assert.equal(continuationFeeFor('west', 2026, data), 12_500, 'rounded down to the cent');
  assert.equal(continuationFeeFor('west', 2027, data), null, 'no FNG fee that year, no continuation fee');
  assert.equal(continuationFeeFor('north', 2026, data), null);
  assert.equal(
    continuationFeeProblem(who(data, 'tre'), 'west', 5_000, data),
    'The continuation fee is half the FNG fee (4.11), so the app works it out.',
  );
});

// --- E. Meeting kinds and notice ----------------------------------------------------------------

test('meeting kinds read as v4 names them', () => {
  assert.equal(meetingKindLabel('agm', 'west'), 'Annual Chapter Meeting');
  assert.equal(meetingKindLabel('agm', null), 'Association AGM');
  assert.equal(meetingKindLabel('general', 'west'), 'Chapter meeting');
  assert.equal(meetingKindLabel('general', null), 'National Club meeting');
  assert.equal(meetingKindLabel('special', 'west'), 'Special meeting');
  assert.equal(meetingKindLabel('board', 'west'), 'Board meeting');
  assert.equal(meetingKindLabel('nec', null), 'NEC meeting');
});

const NOW = '2026-10-25T00:00:00.000Z';
const inDays = (days: number) => new Date(Date.parse(NOW) + days * 86_400_000).toISOString();
const meetingInput = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  id: null, chapterId: 'west', kind: 'general', title: 'November meeting', startsAt: inDays(30), location: null, agenda: [], ...over,
});

test('meetings need v4’s notice', () => {
  const data = v4Club();
  const sec = who(data, 'sec');
  const chair = who(data, 'chair');
  const save = (over: Partial<MeetingInput>, me = sec) => saveMeetingProblem(me, meetingInput(over), null, data, NOW);
  assert.equal(save({ startsAt: inDays(6) }), 'A chapter meeting needs 7 days’ notice (10.4).');
  assert.equal(save({ startsAt: inDays(7) }), null);
  assert.equal(save({ kind: 'special', startsAt: inDays(3) }), 'A special meeting needs 7 days’ notice (10.4).');
  assert.equal(save({ kind: 'agm', startsAt: inDays(10) }), 'An Annual Chapter Meeting needs 14 days’ notice (10.4).');
  assert.equal(save({ kind: 'board', startsAt: inDays(1) }), null, 'v4 sets no notice for a board meeting');
  assert.equal(save({ chapterId: null, startsAt: inDays(13) }, chair), 'A National Club meeting needs 14 days’ notice (10.4).');
  assert.equal(save({ chapterId: null, kind: 'special', startsAt: inDays(13) }, chair), 'A National Club meeting needs 14 days’ notice (10.4).');
  assert.equal(save({ chapterId: null, kind: 'agm', startsAt: inDays(13) }, chair), 'The Association AGM needs 14 days’ notice (10.4).');
  assert.equal(save({ chapterId: null, kind: 'nec', startsAt: inDays(1) }, chair), null, 'an urgent NEC meeting is allowed');
  assert.equal(save({ startsAt: inDays(-3) }), null, 'a meeting already held is a record');
});

test('notice counts when a meeting is new or moved earlier', () => {
  const existing = {
    id: 'mt-1', chapterId: 'west', kind: 'general' as const, title: 'November meeting', startsAt: inDays(5), location: null,
    agenda: [], minutes: null, minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null, createdBy: 'sec',
  };
  const data = v4Club({ meetings: [existing] });
  const sec = who(data, 'sec');
  const edit = (startsAt: string) => saveMeetingProblem(sec, meetingInput({ id: 'mt-1', startsAt }), existing, data, NOW);
  assert.equal(edit(inDays(5)), null, 'editing the agenda of a meeting already called is fine');
  assert.equal(edit(inDays(6)), null, 'moving it later is fine');
  assert.equal(edit(inDays(4)), 'A chapter meeting needs 7 days’ notice (10.4).');
});

test('a short-notice NEC meeting gets a warning', () => {
  assert.equal(noticeWarning(meetingInput({ chapterId: null, kind: 'nec', startsAt: inDays(2) }), NOW), 'NEC meetings need 7 days’ notice unless most of the NEC agree to an urgent one (11.5).');
  assert.equal(noticeWarning(meetingInput({ chapterId: null, kind: 'nec', startsAt: inDays(8) }), NOW), null);
  assert.equal(noticeWarning(meetingInput({ startsAt: inDays(2) }), NOW), null, 'other kinds refuse instead');
});
