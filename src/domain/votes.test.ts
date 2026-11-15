import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { AUDITOR_STAYS_OUT, BOARD_RECORDS_ACTING, NO_REQUEST, NOT_YOURSELF, SMALL_BOARD } from './access';
import type { ActingRequest, ClubData, Member, Position, PositionRole, Vote } from './types';
import { settleActing } from './acting';
import {
  ACTING_END_SHAPE,
  ACTING_VOTE_OPEN,
  actingVoteQuestion,
  CAST_BOARD_ENDED,
  castNecCast,
  castNecNotYours,
  canSeeVote,
  castProblem,
  chairOf,
  chaptersRepresented,
  closeProblem,
  decide,
  defaultQuorum,
  electorsFor,
  endActingQuestion,
  isRemovalVote,
  lacksChapters,
  NEC_SEATS_ONLY,
  necVoterBefore,
  NO_VOTE_NEEDED,
  openActingVoteProblem,
  openVoteProblem,
  outcome,
  patchVoteFor,
  patchVoteTooEarly,
  REMOVAL_BOARD_SEAT,
  REMOVAL_CHAPTER_ROLE,
  REMOVAL_NEEDS_HOLDER,
  REMOVAL_SUBJECT,
  removalShape,
  removalVoteFor,
  ruleLine,
  seatVoteFor,
  SEAT_VOTE_IS_NATIONAL,
  stintVoteWarnings,
  type VoteInput,
} from './votes';

const d = DEMO_DATA;
const P = d.positions;
const m = (id: string) => {
  const found = d.members.find((x) => x.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};

const NOW = '2026-10-24T02:00:00.000Z';
const LATER = '2026-10-31T02:00:00.000Z';

const input = (over: Partial<VoteInput> = {}): VoteInput => ({
  chapterId: 'ch-west', meetingId: null, subjectMemberId: null, subjectRole: null, question: 'Buy a new gazebo?', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, closesAt: LATER, ...over,
});

const vote = (over: Partial<Vote> = {}): Vote => ({
  id: 'v-1', chapterId: 'ch-west', meetingId: null, subjectMemberId: null, subjectRole: null, question: 'Buy a new gazebo?', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, openedAt: NOW, closesAt: LATER,
  closedAt: null, result: null, castingVote: null, tally: null,
  electorIds: ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque'], votedIds: [], ballots: [], createdBy: 'm-torque',
  ...over,
});

test('electorates', () => {
  assert.deepEqual(electorsFor('chapter_board', 'ch-west', d), ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque']);
  assert.deepEqual(
    electorsFor('chapter_patched', 'ch-west', d),
    ['m-chook', 'm-diesel', 'm-gravel', 'm-rusty', 'm-spanner', 'm-sparks', 'm-torque'],
    'Full members only: no FNG, Supporter, Family, Legacy, or North',
  );
  assert.ok(!electorsFor('chapter_patched', 'ch-north', d).includes('m-ratchet'), 'Nomads don’t vote on chapter matters (10.7)');
  assert.ok(electorsFor('club_patched', null, d).includes('m-ratchet'), 'but do on national ones');
  assert.equal(electorsFor('club_patched', null, d).length, 12);
  assert.deepEqual(electorsFor('nec', null, d), ['m-smokey'], 'one vote per chapter, cast by its President; West’s President chairs the NEC and has no VP (11.2)');
  const westVp = { ...d, positions: [...P, { id: 'p-vp', memberId: 'm-gravel', chapterId: 'ch-west', role: 'vice_president' as const, startedOn: '2026-01-01', endedOn: null }] };
  assert.deepEqual(electorsFor('nec', null, westVp), ['m-gravel', 'm-smokey'], 'the acting President casts the chair’s chapter vote');
  const necChairOnly = { ...d, positions: [...P.filter((p) => p.memberId !== 'm-rusty' || p.role === 'nec_chair')] };
  assert.deepEqual(electorsFor('nec', null, necChairOnly), ['m-smokey'], 'the National Chairperson has no ordinary vote');
});

test('the default quorum', () => {
  assert.equal(defaultQuorum('chapter_patched', 7), 3, 'a third of the chapter’s Full Members, rounded up (10.6)');
  assert.equal(defaultQuorum('chapter_patched', 9), 3);
  assert.equal(defaultQuorum('club_patched', 12), 4, 'a third of all Voting Members (10.6)');
  assert.equal(defaultQuorum('nec', 2), 2, '51% of the NEC’s votes, rounded up (11.5)');
  assert.equal(defaultQuorum('nec', 3), 2);
  assert.equal(defaultQuorum('chapter_board', 5), 3, 'more than half the board (8.5)');
  assert.equal(defaultQuorum('chapter_board', 4), 3);
  assert.equal(defaultQuorum('chapter_board', 6), 4, 'a majority of six is four (2.4)');
  assert.equal(defaultQuorum('chapter_board', 3), 3, 'and never fewer than three (8.5)');
  assert.equal(defaultQuorum('chapter_patched', 1), 1);
});

test('the chair', () => {
  assert.equal(chairOf('ch-west', P), 'm-rusty');
  assert.equal(chairOf('ch-north', P), 'm-smokey');
  assert.equal(chairOf(null, P), 'm-rusty', 'the National Chairman');
  assert.equal(chairOf('ch-north', P.filter((p) => p.role !== 'president')), 'm-jet', 'then the Vice President (10.9)');
  assert.equal(chairOf('ch-west', P.filter((p) => p.role !== 'president')), null, 'West has no Vice President');
  const handover = [...P, { id: 'p-new', memberId: 'm-torque', chapterId: 'ch-west', role: 'president' as const, startedOn: '2026-10-01', endedOn: null }];
  assert.equal(chairOf('ch-west', handover), 'm-torque', 'during a handover the newer President chairs (9.8)');
});

test('deciding a result', () => {
  const t = (yes: number, no: number, abstain = 0) => ({ yes, no, abstain });
  assert.deepEqual(decide('majority', 3, t(3, 2), null, 6), { result: 'carried', tied: false });
  assert.deepEqual(decide('majority', 3, t(2, 3), null, 6), { result: 'lost', tied: false });
  assert.deepEqual(decide('two_thirds', 3, t(4, 2), null, 6), { result: 'carried', tied: false });
  assert.deepEqual(decide('two_thirds', 3, t(3, 2), null, 6), { result: 'lost', tied: false });
  assert.deepEqual(decide('unanimous', 3, t(6, 0), null, 6), { result: 'carried', tied: false }, 'every elector says yes');
  assert.deepEqual(decide('unanimous', 3, t(5, 0, 1), null, 6), { result: 'lost', tied: false }, 'an abstention isn’t a yes (4.9)');
  assert.deepEqual(decide('unanimous', 3, t(5, 0), null, 6), { result: 'lost', tied: false }, 'nor is a missing ballot');
  assert.deepEqual(decide('unanimous', 3, t(4, 1), null, 6), { result: 'lost', tied: false });
  assert.deepEqual(decide('unanimous', 3, t(0, 0, 4), null, 6), { result: 'lost', tied: false }, 'all abstain is lost');
  assert.deepEqual(decide('majority', 5, t(2, 1, 1), null, 6), { result: 'no_quorum', tied: false }, 'abstentions count to quorum');
  assert.deepEqual(decide('majority', 3, t(2, 2), null, 6), { result: 'lost', tied: true });
  assert.deepEqual(decide('majority', 3, t(2, 2), 'yes', 6), { result: 'carried', tied: true });
  assert.deepEqual(decide('majority', 3, t(2, 2), 'no', 6), { result: 'lost', tied: true });
  assert.deepEqual(decide('two_thirds', 3, t(2, 2), null, 6), { result: 'lost', tied: false }, 'only a majority vote can tie');
  assert.deepEqual(decide('majority', 3, t(0, 0, 3), null, 6), { result: 'lost', tied: false }, 'nothing for or against is lost, not tied');
});

test('opening a vote', () => {
  assert.equal(openVoteProblem(null, input(), d, NOW), 'Sign in first.');
  assert.equal(openVoteProblem(m('m-dylan'), input(), d, NOW), 'Only approved members can do that.');
  assert.equal(openVoteProblem(m('m-spanner'), input(), d, NOW), 'Only that chapter’s board can do that.');
  assert.equal(openVoteProblem(m('m-torque'), input({ chapterId: null, electorate: 'nec' }), d, NOW), 'Only the NEC can do that.');
  assert.equal(openVoteProblem(m('m-torque'), input({ question: ' ' }), d, NOW), 'Ask a question.');
  assert.equal(openVoteProblem(m('m-torque'), input({ electorate: 'nec' }), d, NOW), 'That electorate doesn’t fit here.');
  assert.equal(openVoteProblem(m('m-smokey'), input({ chapterId: null, electorate: 'chapter_board' }), d, NOW), 'That electorate doesn’t fit here.');
  const empty = { ...d, positions: P.filter((p) => p.chapterId !== 'ch-west' || p.memberId === 'm-torque') };
  const tooSmall = 'A board vote needs at least three board members (8.5).';
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 1 }), empty, NOW), tooSmall, 'a board of one');
  const three = { ...d, positions: P.filter((p) => p.chapterId !== 'ch-west' || ['m-torque', 'm-gravel', 'm-rusty'].includes(p.memberId)) };
  assert.equal(electorsFor('chapter_board', 'ch-west', three).length, 3);
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 3 }), three, NOW), null, 'a board of three');
  const noBoard = { ...d, positions: P.filter((p) => p.chapterId !== 'ch-north') };
  assert.equal(openVoteProblem(m('m-rusty'), input({ chapterId: 'ch-north', quorum: 1 }), noBoard, NOW), 'Only that chapter’s board can do that.', 'no North seat');
  const unpatched = { ...d, members: d.members.map((x) => (x.chapterId === 'ch-west' && x.status === 'full' ? { ...x, status: 'supporter' as const } : x)) };
  assert.equal(openVoteProblem(m('m-torque'), input({ electorate: 'chapter_patched', quorum: 1 }), unpatched, NOW), 'Nobody can vote in that electorate yet.');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 0 }), d, NOW), 'Quorum must be between 3 and 5.');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 2 }), d, NOW), 'Quorum must be between 3 and 5.', 'not below the minimum');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 6 }), d, NOW), 'Quorum must be between 3 and 5.');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 3.5 }), d, NOW), 'Quorum must be between 3 and 5.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: NOW }), d, NOW), 'Pick a closing time in the future.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: '' }), d, NOW), 'Pick a closing time in the future.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: '2026-12-24T02:00:00.001Z' }), d, NOW), 'Votes can stay open for 60 days at most.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: '2026-12-23T02:00:00.000Z' }), d, NOW), null, 'exactly 60 days is fine');
  assert.equal(openVoteProblem(m('m-torque'), input({ meetingId: 'mt-9' }), d, NOW), 'No such meeting.');
  assert.equal(openVoteProblem(m('m-torque'), input(), d, NOW), null);
  assert.equal(openVoteProblem(m('m-smokey'), input({ chapterId: null, electorate: 'club_patched', quorum: 7 }), d, NOW), null);
});

test('a patch vote is secret and unanimous among the chapter’s Full Members, about one of its FNGs', () => {
  const patch = (over: Partial<VoteInput> = {}) =>
    input({ subjectMemberId: 'm-throttle', subjectRole: null, electorate: 'chapter_patched', threshold: 'unanimous', secret: true, quorum: 4, ...over });
  assert.equal(openVoteProblem(m('m-torque'), patch(), d, NOW), null);
  const wrongSubject = 'A patch vote is for an approved FNG of that chapter.';
  assert.equal(openVoteProblem(m('m-torque'), patch({ subjectMemberId: 'm-lefty' }), d, NOW), wrongSubject, 'North FNG');
  assert.equal(openVoteProblem(m('m-torque'), patch({ subjectMemberId: 'm-spanner' }), d, NOW), wrongSubject, 'already Full');
  assert.equal(openVoteProblem(m('m-torque'), patch({ subjectMemberId: 'm-nobody' }), d, NOW), wrongSubject);
  const wrongRule = 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.';
  assert.equal(openVoteProblem(m('m-torque'), patch({ threshold: 'majority' }), d, NOW), wrongRule);
  assert.equal(openVoteProblem(m('m-torque'), patch({ secret: false }), d, NOW), wrongRule, 'only the outcome is recorded (4.9)');
  assert.equal(openVoteProblem(m('m-torque'), patch({ electorate: 'chapter_board', quorum: 3 }), d, NOW), wrongRule);
  assert.equal(openVoteProblem(m('m-smokey'), patch({ chapterId: null, electorate: 'club_patched' }), d, NOW), 'A reinstatement vote is an NEC majority vote on a member who isn’t Full, Nomad or an FNG (5.6).', 'patch votes belong to a chapter; a club-wide vote on someone is the NEC bringing them back');
  const early = 'A patch vote can open only nine months into the FNG’s trial (4.7).';
  const startedOn = (iso: string | null) => ({ ...d, members: d.members.map((x) => (x.id === 'm-throttle' ? { ...x, fngStartedOn: iso } : x)) });
  assert.equal(openVoteProblem(m('m-torque'), patch(), startedOn('2026-01-25'), NOW), early, 'eight and a bit months');
  assert.equal(openVoteProblem(m('m-torque'), patch(), startedOn('2026-01-24'), NOW), null, 'nine months to the day');
  assert.equal(patchVoteTooEarly('2026-05-31', '2027-02-28'), false, 'month end: 31 May plus nine months is 28 Feb');
  assert.equal(patchVoteTooEarly('2026-05-31', '2027-02-27'), true);
  assert.equal(patchVoteTooEarly('2025-12-31', '2026-09-30'), false);
  assert.equal(patchVoteTooEarly(null, '2026-01-01'), false);
  assert.equal(openVoteProblem(m('m-torque'), patch(), startedOn(null), NOW), null, 'a start date nobody recorded doesn’t block it');
});

test('casting a ballot', () => {
  assert.equal(castProblem(m('m-torque'), undefined, NOW, d), 'No such vote.');
  assert.equal(castProblem(m('m-spanner'), vote(), NOW, d), 'You’re not on this vote.');
  assert.equal(castProblem(m('m-torque'), vote({ votedIds: ['m-torque'] }), NOW, d), 'You’ve already voted.');
  assert.equal(castProblem(m('m-torque'), vote({ closedAt: NOW }), NOW, d), 'That vote has closed.');
  assert.equal(castProblem(m('m-torque'), vote(), LATER, d), 'That vote has closed.', 'past its closing time');
  assert.equal(castProblem(m('m-torque'), vote(), NOW, d), null);
  // The electorate was taken when the vote opened, so a later change of status doesn't take the ballot away.
  assert.equal(castProblem({ ...m('m-torque'), status: 'legacy' }, vote(), NOW, d), null);
});

test('closing a vote', () => {
  const all = ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque'];
  const tied = vote({ votedIds: ['m-diesel', 'm-gravel', 'm-sparks', 'm-torque'] });
  const tiedBallots = { yes: 2, no: 2, abstain: 0 };
  assert.equal(closeProblem(m('m-torque'), undefined, null, null, d, LATER), 'No such vote.');
  assert.equal(closeProblem(m('m-spanner'), vote(), null, null, d, LATER), 'Only that chapter’s board can do that.');
  assert.equal(closeProblem(m('m-torque'), vote({ closedAt: NOW }), null, null, d, LATER), 'That vote has already closed.');
  assert.equal(closeProblem(m('m-torque'), vote(), null, null, d, NOW), 'Wait until it closes, or until everyone has voted.');
  assert.equal(closeProblem(m('m-torque'), vote({ votedIds: all }), { yes: 5, no: 0, abstain: 0 }, null, d, NOW), null, 'early once everyone has voted');
  assert.equal(closeProblem(m('m-torque'), vote(), { yes: 0, no: 0, abstain: 0 }, null, d, LATER), null);
  const tie = 'It’s a tie. The chair gives a casting vote or lets it fall.';
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, null, d, LATER), tie);
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, 'yes', d, LATER), tie, 'only the chair casts');
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, 'decline', d, LATER), tie, 'or declines');
  assert.equal(closeProblem(m('m-rusty'), tied, tiedBallots, null, d, LATER), tie, 'the chair says which');
  assert.equal(closeProblem(m('m-rusty'), tied, tiedBallots, 'yes', d, LATER), null);
  assert.equal(closeProblem(m('m-rusty'), tied, tiedBallots, 'decline', d, LATER), null, 'the chair may decline to cast (9.10)');
  assert.deepEqual(decide('majority', 3, tiedBallots, 'decline', 5), { result: 'lost', tied: true }, 'and then it’s lost');
  assert.equal(
    closeProblem(m('m-rusty'), vote(), { yes: 3, no: 1, abstain: 0 }, 'decline', d, LATER),
    'There’s no tie, so no casting vote.',
  );
  assert.equal(
    closeProblem(m('m-rusty'), vote(), { yes: 3, no: 1, abstain: 0 }, 'yes', d, LATER),
    'There’s no tie, so no casting vote.',
  );
  const noChair = { ...d, positions: P.filter((p) => !(p.role === 'president' && p.chapterId === 'ch-west')) };
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, null, noChair, LATER), null, 'with no chair a tie is lost');
  assert.equal(
    closeProblem(m('m-torque'), tied, tiedBallots, 'yes', noChair, LATER),
    'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.',
    'nobody can carry a chairless tie by casting',
  );
});

test('a national vote needs voters from 51% of the chapters (10.6)', () => {
  const west = ['m-chook', 'm-diesel', 'm-gravel', 'm-rusty', 'm-spanner', 'm-sparks', 'm-torque'];
  const everyone = electorsFor('club_patched', null, d);
  const national = (votedIds: string[], over: Partial<Vote> = {}) =>
    vote({ id: 'v-nat', chapterId: null, electorate: 'club_patched', quorum: 4, electorIds: everyone, votedIds, ...over });
  const fourWest = { yes: 4, no: 0, abstain: 0 };
  assert.equal(chaptersRepresented(national(west.slice(0, 4)), d.members), false, 'one chapter of two is not 51%');
  assert.equal(chaptersRepresented(national([...west.slice(0, 3), 'm-jet']), d.members), true, 'one North voter is representation enough');
  assert.equal(chaptersRepresented(national([]), d.members), false);
  assert.deepEqual(outcome(national(west.slice(0, 4)), fourWest, null, d.members), { result: 'no_quorum', tied: false });
  assert.deepEqual(outcome(national([...west.slice(0, 3), 'm-jet']), fourWest, null, d.members), { result: 'carried', tied: false });
  assert.deepEqual(outcome(vote({ votedIds: west.slice(0, 4) }), fourWest, null, d.members), { result: 'carried', tied: false }, 'a chapter vote is its own business');
  // Closing it: no tie to settle, so no casting vote, and the chair closes it as any other.
  assert.equal(closeProblem(m('m-rusty'), national(west.slice(0, 4)), fourWest, null, d, LATER), null);
  assert.equal(closeProblem(m('m-rusty'), national(west.slice(0, 4)), { yes: 2, no: 2, abstain: 0 }, 'yes', d, LATER), 'There’s no tie, so no casting vote.');
  // The result screen says why.
  const closed = national(west.slice(0, 4), { closedAt: LATER, result: 'no_quorum', tally: fourWest });
  assert.equal(lacksChapters(closed, d.members), true);
  assert.equal(lacksChapters({ ...closed, tally: { yes: 2, no: 0, abstain: 0 } }, d.members), false, 'too few ballots is the plain reason');
  assert.equal(lacksChapters({ ...closed, electorate: 'chapter_patched' }, d.members), false);
  // Three chapters: 51% means two of them.
  const south = { id: 'ch-south', slug: 'south', name: 'South', area: 'Southern Melbourne', state: 'VIC' };
  const d3 = { ...d, chapters: [...d.chapters, south], members: [...d.members, { ...m('m-jet'), id: 'm-sunny', chapterId: 'ch-south', fullName: 'Sunny Day', roadName: 'Sunny' }] };
  const three = (votedIds: string[]) =>
    vote({ id: 'v-nat3', chapterId: null, electorate: 'club_patched', quorum: 4, electorIds: electorsFor('club_patched', null, d3), votedIds });
  assert.equal(chaptersRepresented(three(west.slice(0, 4)), d3.members), false, 'one chapter of three');
  assert.equal(chaptersRepresented(three([...west.slice(0, 3), 'm-jet']), d3.members), true, 'two of three is 51%, rounded up');
  assert.equal(chaptersRepresented(three([...west.slice(0, 3), 'm-sunny']), d3.members), true, 'whichever two');
  assert.deepEqual(outcome(three(west.slice(0, 4)), fourWest, null, d3.members), { result: 'no_quorum', tied: false });
  // An NEC vote is exempt: 10.6 is about the club's Voting Members, and the NEC has its own quorum (11.5).
  const nec = vote({ id: 'v-nec', chapterId: null, electorate: 'nec', quorum: 1, electorIds: ['m-smokey'], votedIds: ['m-smokey'] });
  assert.equal(chaptersRepresented(nec, d.members), true);
  assert.deepEqual(outcome(nec, { yes: 1, no: 0, abstain: 0 }, null, d.members), { result: 'carried', tied: false }, 'an NEC vote is its own business');
});

test('no casting vote on a vote about a member: a tie is lost (10.7)', () => {
  // West gets a Vice President, so the NEC has two votes and can tie.
  const westVp = { ...d, positions: [...P, { id: 'p-vp', memberId: 'm-gravel', chapterId: 'ch-west', role: 'vice_president' as const, startedOn: '2026-01-01', endedOn: null }] };
  const reinstate = vote({
    id: 'v-back', chapterId: null, electorate: 'nec', subjectMemberId: 'm-rooster', question: 'Bring Rooster back?', quorum: 2,
    electorIds: ['m-gravel', 'm-smokey'], votedIds: ['m-gravel', 'm-smokey'],
  });
  const split = { yes: 1, no: 1, abstain: 0 };
  assert.equal(closeProblem(m('m-rusty'), reinstate, split, 'yes', westVp, NOW), 'No casting vote on a vote about a member (10.7): a tie is lost.');
  assert.equal(closeProblem(m('m-rusty'), reinstate, split, 'decline', westVp, NOW), 'No casting vote on a vote about a member (10.7): a tie is lost.');
  assert.equal(closeProblem(m('m-rusty'), reinstate, split, null, westVp, NOW), null, 'it closes without one');
  assert.deepEqual(outcome(reinstate, split, 'yes', westVp.members), { result: 'lost', tied: true }, 'and a casting vote would change nothing');
  // Ordinary national business still gets the Chairman's casting vote.
  const tuesdays = vote({ ...reinstate, id: 'v-tue', subjectMemberId: null, question: 'Tuesdays?' });
  assert.equal(closeProblem(m('m-rusty'), tuesdays, split, null, westVp, NOW), 'It’s a tie. The chair gives a casting vote or lets it fall.');
  assert.equal(closeProblem(m('m-rusty'), tuesdays, split, 'yes', westVp, NOW), null);
  assert.deepEqual(outcome(tuesdays, split, 'yes', westVp.members), { result: 'carried', tied: true });
});

test('who sees a vote', () => {
  assert.equal(canSeeVote(m('m-gravel'), vote(), P), true, 'an elector');
  assert.equal(canSeeVote(m('m-spanner'), vote(), P), false);
  assert.equal(canSeeVote(m('m-smokey'), vote(), P), true, 'the NEC reaches every chapter');
  assert.equal(canSeeVote(m('m-spanner'), vote({ electorate: 'chapter_patched', electorIds: ['m-spanner'] }), P), true);
  assert.equal(canSeeVote(m('m-dylan'), vote({ electorIds: ['m-dylan'] }), P), false);
});

test('the rule line', () => {
  assert.equal(ruleLine(vote()), 'Majority of votes cast · Quorum 3 of 5');
  assert.equal(ruleLine(vote({ threshold: 'two_thirds', secret: true })), 'Two-thirds of votes cast · Quorum 3 of 5 · Secret ballot');
  assert.equal(ruleLine(vote({ threshold: 'unanimous' })), 'Unanimous: all 5 must vote yes', 'a quorum means nothing when everyone must vote');
  assert.equal(ruleLine(vote({ threshold: 'unanimous', secret: true })), 'Unanimous: all 5 must vote yes · Secret ballot');
});

test('the vote for a national seat is found by its seat', () => {
  const seat = (id: string, subjectRole: 'nec_auditor' | 'nec_secretary') =>
    vote({ id, chapterId: null, electorate: 'nec', threshold: 'two_thirds', subjectMemberId: 'm-spanner', subjectRole, closedAt: NOW, result: 'carried' });
  const votes = [seat('aud', 'nec_auditor'), seat('sec', 'nec_secretary')];
  assert.equal(seatVoteFor('m-spanner', votes, 'nec_auditor')?.id, 'aud');
  assert.equal(seatVoteFor('m-spanner', votes, 'nec_secretary')?.id, 'sec');
  assert.equal(seatVoteFor('m-gravel', votes, 'nec_secretary'), null);
});

test('the patch vote on a member: the open one, or else the latest result', () => {
  const t = 'm-throttle';
  const lost = vote({ id: 'old', electorate: 'chapter_patched', subjectMemberId: t, subjectRole: null, closedAt: '2026-05-01T09:00:00.000Z', result: 'lost' });
  const carried = vote({ id: 'new', electorate: 'chapter_patched', subjectMemberId: t, subjectRole: null, closedAt: '2026-09-01T09:00:00.000Z', result: 'carried' });
  const open = vote({ id: 'open', electorate: 'chapter_patched', subjectMemberId: t });
  const other = vote({ id: 'other', subjectRole: null, electorate: 'chapter_patched', subjectMemberId: 'm-dylan' });
  assert.equal(patchVoteFor(t, []), null);
  assert.equal(patchVoteFor(t, [lost, other])?.id, 'old');
  assert.equal(patchVoteFor(t, [carried, lost])?.id, 'new', 'latest result');
  assert.equal(patchVoteFor(t, [carried, open, lost])?.id, 'open', 'an open vote comes first');
  assert.equal(patchVoteFor(t, [vote({ id: 'gazebo' })]), null, 'not a vote about anyone');
});

test('a removal vote names a role holder of the chapter, in the shape 9.3 gives', () => {
  const torque = m('m-torque');
  // Spanner, West Tail Gunner: a majority of the five-strong West board.
  const gunner = (over: Partial<VoteInput> = {}) =>
    input({ subjectMemberId: 'm-spanner', subjectRole: 'tail_gunner', electorate: 'chapter_board', threshold: 'majority', quorum: 3, ...over });
  assert.equal(openVoteProblem(torque, gunner(), d, NOW), null);
  assert.equal(openVoteProblem(m('m-spanner'), gunner(), d, NOW), 'Only that chapter’s board can do that.', 'the subject can’t open it');
  assert.equal(openVoteProblem(m('m-smokey'), gunner(), d, NOW), 'Only that chapter’s board can do that.', 'nor can another chapter’s President');
  assert.equal(openVoteProblem(torque, gunner({ electorate: 'chapter_patched', threshold: 'two_thirds' }), d, NOW), REMOVAL_CHAPTER_ROLE, 'wrong electorate');
  assert.equal(openVoteProblem(torque, gunner({ threshold: 'two_thirds' }), d, NOW), REMOVAL_CHAPTER_ROLE, 'wrong threshold');
  assert.equal(openVoteProblem(torque, gunner({ subjectMemberId: 'm-gravel', subjectRole: 'secretary', electorate: 'chapter_patched', threshold: 'two_thirds' }), d, NOW), REMOVAL_SUBJECT, 'Gravel isn’t Secretary');
  assert.equal(openVoteProblem(torque, gunner({ subjectMemberId: 'm-crank', subjectRole: 'road_captain', electorate: 'chapter_patched', threshold: 'two_thirds' }), d, NOW), REMOVAL_SUBJECT, 'Crank holds North’s seat, not West’s');
  assert.equal(openVoteProblem(torque, gunner({ subjectMemberId: 'm-throttle' }), d, NOW), REMOVAL_SUBJECT, 'an FNG holds no role');
  assert.equal(openVoteProblem(torque, gunner({ subjectMemberId: null }), d, NOW), REMOVAL_NEEDS_HOLDER, 'a role needs its holder');
  assert.equal(openVoteProblem(torque, gunner({ subjectRole: 'founder' }), d, NOW), REMOVAL_NEEDS_HOLDER, 'the honour isn’t voted on');
  assert.equal(openVoteProblem(torque, gunner({ subjectRole: 'nec_auditor' }), d, NOW), SEAT_VOTE_IS_NATIONAL, 'national seats are the NEC’s');
  assert.equal(
    openVoteProblem(m('m-rusty'), input({ chapterId: null, subjectMemberId: 'm-spanner', subjectRole: 'tail_gunner', electorate: 'nec', quorum: 1 }), d, NOW),
    NEC_SEATS_ONLY,
    'the NEC doesn’t remove chapter roles',
  );
  // Diesel, West Road Captain: two-thirds of West's seven Full Members.
  const captain = (over: Partial<VoteInput> = {}) =>
    input({ subjectMemberId: 'm-diesel', subjectRole: 'road_captain', electorate: 'chapter_patched', threshold: 'two_thirds', quorum: 3, ...over });
  assert.equal(openVoteProblem(torque, captain(), d, NOW), null);
  assert.equal(electorsFor('chapter_patched', 'ch-west', d).length, 7, 'Diesel votes too');
  assert.equal(openVoteProblem(torque, captain({ electorate: 'chapter_board', threshold: 'majority' }), d, NOW), REMOVAL_BOARD_SEAT, 'not the board alone');
  assert.equal(openVoteProblem(torque, captain({ threshold: 'majority' }), d, NOW), REMOVAL_BOARD_SEAT, 'not a bare majority');
  assert.equal(openVoteProblem(torque, captain({ subjectMemberId: 'm-rusty', subjectRole: 'president' }), d, NOW), null, 'the President’s seat goes the same way');
  assert.deepEqual(removalShape('president'), { electorate: 'chapter_patched', threshold: 'two_thirds' });
  assert.deepEqual(removalShape('tail_gunner'), { electorate: 'chapter_board', threshold: 'majority' });
});

test('the removal vote about a term: the open one, or else the latest result', () => {
  const p7 = P.find((p) => p.id === 'p-7')!;
  const about = (id: string, over: Partial<Vote> = {}) =>
    vote({ id, chapterId: 'ch-west', subjectMemberId: 'm-spanner', subjectRole: 'tail_gunner', electorate: 'chapter_board', threshold: 'majority', ...over });
  const lost = about('old', { closedAt: '2026-05-01T09:00:00.000Z', result: 'lost' });
  const carried = about('new', { closedAt: '2026-09-01T09:00:00.000Z', result: 'carried' });
  const open = about('open');
  const other = about('other', { subjectRole: 'officer' });
  const patch = vote({ id: 'patch', chapterId: 'ch-west', subjectMemberId: 'm-spanner', subjectRole: null, electorate: 'chapter_patched' });
  assert.equal(removalVoteFor(p7, []), null);
  assert.equal(removalVoteFor(p7, [lost, other, patch])?.id, 'old');
  assert.equal(removalVoteFor(p7, [carried, lost])?.id, 'new', 'latest result');
  assert.equal(removalVoteFor(p7, [carried, open, lost])?.id, 'open', 'an open vote comes first');
  assert.equal(removalVoteFor(p7, [about('shape', { electorate: 'chapter_patched', threshold: 'two_thirds' })]), null, 'the wrong shape isn’t this vote');
});

// ---------------------------------------------------------------------------
// Acting roles (docs/superpowers/specs/2026-11-15-acting-roles-design.md, "Votes and ballots"):
// the same order and words as the database (supabase/migrations/20270870000000_acting_roles.sql §6,
// §8). The fixture is acting_test.sql's, as in access.test.ts: North has Smokey (President), Jet
// (VP), Crank (Road Captain), Lou (National Secretary), Ned and Gus (no seat); West has Rusty
// (President), Torque (Secretary), Penny (Treasurer), Spanner and Hal (no seat) and Kim (National
// Auditor).
// ---------------------------------------------------------------------------

const AT = '2026-11-15';
/** Noon in Melbourne on AT. */
const AT_NOW = '2026-11-15T01:00:00.000Z';
const UNTIL = '2026-12-13';
const hoursFrom = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
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
/** Jet (North's VP) covers Smokey's President seat from today, agreed: Smokey asked, Crank confirmed. */
const JET_COVERS = stint('jet-covers-smokey', 'jet', 'north', 'president', { covers: 'smokey-president', actingWhy: 'Smokey overseas', appointedBy: 'crank' });
/** North with five board members: Ned seated Secretary and Gus Treasurer. */
const FIVE: Position[] = [seat('ned-secretary', 'ned', 'north', 'secretary'), seat('gus-treasurer', 'gus', 'north', 'treasurer')];

interface World { seats?: Position[]; without?: string[]; ended?: Record<string, string>; requests?: ActingRequest[] }
const world = (w: World = {}): ClubData => ({
  ...d,
  chapters: [
    { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
    { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
  ],
  members: RIDERS.map(([id, ch]) => rider(id, ch)),
  positions: [...SEATS, ...(w.seats ?? [])]
    .filter((p) => !w.without?.includes(p.id))
    .map((p) => (w.ended?.[p.id] ? { ...p, endedOn: w.ended[p.id] } : p)),
  privates: [], votes: [], meetings: [], actingRequests: w.requests ?? [], actingChanges: [], crew: [], rides: [],
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
/** Crank proposes that Jet cover Smokey's President seat until UNTIL: a cover the holder didn't ask for. */
const ask = (id: string, over: Partial<ActingRequest> = {}): ActingRequest => ({
  id, chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: UNTIL, why: 'Smokey can’t be reached',
  requestedBy: 'crank', createdAt: '2026-11-15T00:30:00.000Z', closedAt: null, outcome: null, ...over,
});
/** An open NEC vote opened on 13/11: North's ballot named for `north`, West's for Rusty. */
const necVote = (north: string, over: Partial<Vote> = {}): Vote =>
  vote({
    id: 'v-nec', chapterId: null, electorate: 'nec', threshold: 'majority', quorum: 2, openedAt: '2026-11-13T01:00:00.000Z',
    closesAt: '2026-11-20T01:00:00.000Z', electorIds: [north, 'rusty'].sort(), electorChapters: { [north]: 'north', rusty: 'west' }, ...over,
  });
/** An open North board vote, opened yesterday with the three of them. */
const boardVote = (over: Partial<Vote> = {}): Vote =>
  vote({
    id: 'v-board', chapterId: 'north', openedAt: '2026-11-14T01:00:00.000Z', closesAt: '2026-11-21T01:00:00.000Z',
    electorIds: ['crank', 'jet', 'smokey'], ...over,
  });

test('the acting vote words are the spec’s Appendix A', () => {
  assert.equal(ACTING_END_SHAPE, 'Ending someone’s acting is a majority vote of the chapter board (9.3).');
  assert.equal(ACTING_VOTE_OPEN, 'A vote about acting stays open for at least 48 hours, so everyone affected can answer.');
  assert.equal(NO_VOTE_NEEDED, 'This request doesn’t need a vote. A third board member confirms it.');
  assert.equal(CAST_BOARD_ENDED, 'Your board seat has ended, so this ballot isn’t yours now.');
  assert.equal(castNecNotYours('North'), 'You don’t cast North’s NEC vote now, so this ballot isn’t yours.');
  assert.equal(castNecCast('North'), 'North’s NEC ballot has already been cast.');
});

test('North keeps three board electors under a cover', () => {
  const w = world({ seats: [JET_COVERS] });
  assert.deepEqual(electorsFor('chapter_board', 'north', w), ['crank', 'jet', 'smokey'], 'Smokey keeps his ballot, and Jet has one, not two (8.1)');
  const opening = input({ chapterId: 'north', quorum: 3, closesAt: hoursFrom(AT_NOW, 7 * 24) });
  assert.equal(openVoteProblem(who(w, 'smokey'), opening, w, AT_NOW), null, 'the covered President still opens a board vote');
});

test('the cast-time board check', () => {
  const open = boardVote();
  const removed = world({ ended: { 'crank-rc': AT } });
  assert.equal(castProblem(who(removed, 'crank'), open, AT_NOW, removed), CAST_BOARD_ENDED, 'his seat ended after it opened (8.5)');
  assert.equal(castProblem(who(removed, 'smokey'), open, AT_NOW, removed), null);
  assert.equal(castProblem(who(world(), 'crank'), open, AT_NOW, world()), null, 'while he holds it');
  assert.equal(castProblem(who(removed, 'crank'), { ...open, votedIds: ['crank'] }, AT_NOW, removed), 'You’ve already voted.', 'the older checks come first');
  assert.equal(castProblem(who(removed, 'crank'), open, hoursFrom(open.closesAt, 1), removed), 'That vote has closed.');
  assert.equal(castProblem(who(removed, 'crank'), { ...open, electorate: 'chapter_patched' }, AT_NOW, removed), null, 'a vote of the Full Members needs no seat');
  // A stint past its date has ended, settled or not: the phone left open past midnight.
  const lapsed = world({ seats: [stint('ned-acting-secretary', 'ned', 'north', 'secretary', { startedOn: '2026-10-01', actingUntil: '2026-11-14' })] });
  const withNed = boardVote({ openedAt: '2026-11-10T01:00:00.000Z', electorIds: ['crank', 'jet', 'ned', 'smokey'] });
  assert.equal(castProblem(who(lapsed, 'ned'), withNed, AT_NOW, lapsed), CAST_BOARD_ENDED);
  assert.equal(castProblem(who(lapsed, 'ned'), withNed, '2026-11-14T01:00:00.000Z', lapsed), null, 'on his last day he still casts');
});

test('NEC ballot pass-over', () => {
  const w = world();
  const v = necVote('jet');
  assert.equal(castProblem(who(w, 'smokey'), v, AT_NOW, w), null, 'North’s voter before the opening day takes its uncast ballot');
  assert.equal(castProblem(who(w, 'smokey'), { ...v, votedIds: ['jet'] }, AT_NOW, w), castNecCast('North'), 'a cast one stands');
  assert.equal(castProblem(who(w, 'jet'), v, AT_NOW, w), castNecNotYours('North'), 'Jet is named, but doesn’t cast North’s vote now, or before it opened');
  assert.equal(castProblem(who(w, 'ned'), v, AT_NOW, w), 'You’re not on this vote.');
  assert.equal(castProblem(who(w, 'rusty'), v, AT_NOW, w), null, 'West’s voter, named');
  assert.equal(castProblem(who(w, 'jet'), { ...v, electorChapters: {} }, AT_NOW, w), null, 'a ballot with no chapter keeps the old rule');
  // A lapsed Acting President can't cast the ballot named for him; the returning President can.
  const lapsed = world({ seats: [stint('jet-old-cover', 'jet', 'north', 'president', { covers: 'smokey-president', startedOn: '2026-11-01', actingUntil: '2026-11-14' })] });
  assert.equal(castProblem(who(lapsed, 'jet'), v, AT_NOW, lapsed), castNecNotYours('North'));
  assert.equal(castProblem(who(lapsed, 'smokey'), v, AT_NOW, lapsed), null);
  // Under a voted cover that started after it opened, North's ballot waits: the named President is off
  // the NEC, and the board didn't pick Jet to cast it before it opened.
  const voted = world({ seats: [{ ...JET_COVERS, actingVote: 'v-acting' }] });
  const smokeys = necVote('smokey');
  assert.equal(castProblem(who(voted, 'smokey'), smokeys, AT_NOW, voted), castNecNotYours('North'));
  assert.equal(castProblem(who(voted, 'jet'), smokeys, AT_NOW, voted), 'You’re not on this vote.');
  assert.equal(castProblem(who(voted, 'ned'), smokeys, AT_NOW, voted), 'You’re not on this vote.');
});

test('a seat started on or after the opening day neither takes nor removes it, but an agreed cover or a roster claim takes it', () => {
  // Opened on 13/11 with North's President seat empty, so Jet (VP) was named.
  const empty = (seats: Position[]) => world({ without: ['smokey-president'], seats });
  const v = necVote('jet');
  const seated = empty([seat('smokey-new', 'smokey', 'north', 'president', { startedOn: AT })]);
  assert.equal(castProblem(who(seated, 'smokey'), v, AT_NOW, seated), 'You’re not on this vote.', 'a President seated after it opened doesn’t take it');
  assert.equal(castProblem(who(seated, 'jet'), v, AT_NOW, seated), null, 'and the VP named at opening keeps it');
  const sameDay = empty([seat('smokey-new', 'smokey', 'north', 'president', { startedOn: '2026-11-13' })]);
  assert.equal(castProblem(who(sameDay, 'smokey'), v, AT_NOW, sameDay), 'You’re not on this vote.', 'not even seated on the day it opened');
  assert.equal(castProblem(who(sameDay, 'jet'), v, AT_NOW, sameDay), null);
  const recorded = empty([stint('jet-acting-president', 'jet', 'north', 'president', { appointedBy: 'crank' })]);
  assert.equal(castProblem(who(recorded, 'jet'), v, AT_NOW, recorded), null, 'the named VP keeps it once recorded Acting President');
  // A roster claim records a 2026 election (17.6): the seat runs from 1/8/2026, so it takes the ballot.
  const claimed = empty([seat('smokey-claim', 'smokey', 'north', 'president', { startedOn: '2026-08-01' })]);
  assert.equal(castProblem(who(claimed, 'smokey'), v, AT_NOW, claimed), null);
  assert.equal(castProblem(who(claimed, 'jet'), v, AT_NOW, claimed), castNecNotYours('North'));
  // A cover the holder agreed counts from the holder's own start, so it takes the ballot named for them.
  const covered = world({ seats: [JET_COVERS] });
  const smokeys = necVote('smokey');
  assert.equal(castProblem(who(covered, 'jet'), smokeys, AT_NOW, covered), null);
  assert.equal(castProblem(who(covered, 'smokey'), smokeys, AT_NOW, covered), castNecNotYours('North'), 'the covered President is off the NEC');
  assert.equal(necVoterBefore('north', '2026-11-13', covered.positions), 'jet');
  assert.equal(necVoterBefore('north', '2026-11-13', world({ seats: [{ ...JET_COVERS, actingVote: 'v-acting' }] }).positions), null, 'a voted one, from its own start, gives nobody');
  assert.equal(necVoterBefore('north', '2026-11-13', seated.positions), 'jet');
  assert.equal(necVoterBefore('north', '2026-11-16', seated.positions), 'smokey', 'a vote opened after his seating is his');
});

test('canSeeVote shows Jet the NEC vote while he covers Smokey, not after I’m back', () => {
  const v = necVote('smokey');
  const covered = world({ seats: [JET_COVERS] });
  assert.equal(canSeeVote(who(covered, 'jet'), v, covered.positions), true);
  const back = world({ seats: [{ ...JET_COVERS, endedOn: AT, endedReason: 'holder_back' }] });
  assert.equal(canSeeVote(who(back, 'jet'), v, back.positions), false, 'once Smokey is back, Jet is VP only');
  assert.equal(canSeeVote(who(back, 'smokey'), v, back.positions), true);
  // A VP who would take an uncast ballot sees the vote: Smokey's seat ended after it opened.
  const stepped = world({ ended: { 'smokey-president': AT } });
  assert.equal(canSeeVote(who(stepped, 'jet'), v, stepped.positions), true, 'Jet takes North’s ballot, so he sees it');
  assert.equal(castProblem(who(stepped, 'jet'), v, AT_NOW, stepped), null);
  assert.equal(canSeeVote(who(stepped, 'jet'), { ...v, votedIds: ['smokey'] }, stepped.positions), false, 'not once it’s cast');
  assert.equal(canSeeVote(who(stepped, 'jet'), { ...v, closedAt: AT_NOW, result: 'lost' }, stepped.positions), false, 'nor once it has closed');
});

test('canSeeVote on settled rows: a stand-in whose cover lapsed at midnight no longer sees the NEC vote', () => {
  // canSeeVote reads the rows it's given; the providers hand it settled ones (Task 16), as
  // club_business reads the views.
  const v = necVote('smokey');
  const lapsed = world({ seats: [{ ...JET_COVERS, startedOn: '2026-10-20', actingUntil: '2026-11-14' }] });
  const settled = settleActing(lapsed, AT);
  assert.equal(canSeeVote(who(settled, 'jet'), v, settled.positions), false, 'Jet is VP only again');
  assert.equal(canSeeVote(who(settled, 'smokey'), v, settled.positions), true, 'Smokey has his seat’s duties back');
});

test('closeProblem refuses a day-old acting vote, all voted', () => {
  const w = world({ seats: FIVE, requests: [ask('crank-asks-jet')] });
  const all = ['crank', 'gus', 'ned'];
  const acting = vote({
    id: 'v-acting', chapterId: 'north', subjectMemberId: 'jet', subjectRole: 'president', actingRequestId: 'crank-asks-jet',
    openedAt: hoursFrom(AT_NOW, -24), closesAt: hoursFrom(AT_NOW, 6 * 24), electorIds: all, votedIds: all,
  });
  const tally = { yes: 3, no: 0, abstain: 0 };
  assert.equal(closeProblem(who(w, 'crank'), acting, tally, null, w, AT_NOW), ACTING_VOTE_OPEN);
  assert.equal(closeProblem(who(w, 'crank'), acting, tally, null, w, hoursFrom(acting.openedAt, 48)), null, 'at 48 hours it closes');
  assert.equal(closeProblem(who(w, 'crank'), { ...acting, closedAt: AT_NOW }, tally, null, w, AT_NOW), 'That vote has already closed.');
  // A vote to end someone's acting waits as long: one naming a role its subject holds as acting.
  const ending = { ...acting, id: 'v-end', actingRequestId: null };
  const covered = world({ seats: [...FIVE, JET_COVERS] });
  assert.equal(closeProblem(who(covered, 'crank'), ending, tally, null, covered, AT_NOW), ACTING_VOTE_OPEN);
  assert.equal(closeProblem(who(w, 'crank'), ending, tally, null, w, AT_NOW), null, 'Jet isn’t acting as President, so it closes as any other');
});

test('endActingQuestion', () => {
  const w = world({ seats: [JET_COVERS] });
  assert.equal(endActingQuestion(row(w, 'jet-covers-smokey'), w), 'End Jet’s acting as President (North)?');
  const ned = world({ seats: [stint('ned-acting-secretary', 'ned', 'north', 'secretary')] });
  assert.equal(endActingQuestion(row(ned, 'ned-acting-secretary'), ned), 'End Ned’s acting as Secretary (North)?');
});

test('chairOf follows duties, with a duty VP fallback', () => {
  assert.equal(chairOf('north', world({ seats: [JET_COVERS] }).positions), 'jet', 'the President’s stand-in chairs');
  // Seated and covered the same day: the stand-in still chairs, whichever row sorts first.
  assert.equal(chairOf('north', world({ seats: [{ ...JET_COVERS, startedOn: '2026-08-01' }] }).positions), 'jet');
  const empty = (seats: Position[], without: string[] = []) => world({ without: ['smokey-president', ...without], seats }).positions;
  assert.equal(chairOf('north', empty([])), 'jet', 'then the VP (10.9)');
  assert.equal(chairOf('north', empty([stint('ned-acting-president', 'ned', 'north', 'president', { actingVote: 'v-acting' })])), 'ned', 'an Acting President before the VP');
  const vpCovered = empty([stint('crank-covers-jet', 'crank', 'north', 'vice_president', { covers: 'jet-vp', startedOn: '2026-08-01' })]);
  assert.equal(chairOf('north', vpCovered), 'crank', 'a VP’s stand-in has the VP seat’s duties, so chairs');
  assert.equal(chairOf('north', empty([stint('ned-acting-vp', 'ned', 'north', 'vice_president')], ['jet-vp'])), 'ned', 'so does an Acting VP');
});

test('acting votes leave out the stand-in, the holder and the Auditor', () => {
  const w = world({ seats: [...FIVE, JET_COVERS] });
  assert.deepEqual(electorsFor('chapter_board', 'north', w, { memberId: 'jet', role: 'president' }), ['crank', 'gus', 'ned']);
  assert.deepEqual(electorsFor('chapter_board', 'north', w), ['crank', 'gus', 'jet', 'ned', 'smokey'], 'any other board vote has the whole board');
  const end = (over: Partial<VoteInput> = {}) =>
    input({ chapterId: 'north', subjectMemberId: 'jet', subjectRole: 'president', quorum: 3, closesAt: hoursFrom(AT_NOW, 7 * 24), ...over });
  assert.equal(openVoteProblem(who(w, 'crank'), end(), w, AT_NOW), null);
  assert.equal(openVoteProblem(who(w, 'crank'), end({ quorum: 4 }), w, AT_NOW), 'Quorum must be between 3 and 3.', 'the quorum is worked out on the three left');
  assert.equal(openVoteProblem(who(w, 'crank'), end({ electorate: 'chapter_patched', threshold: 'two_thirds' }), w, AT_NOW), ACTING_END_SHAPE);
  assert.equal(openVoteProblem(who(w, 'crank'), end({ closesAt: hoursFrom(AT_NOW, 24) }), w, AT_NOW), ACTING_VOTE_OPEN);
  const three = world({ seats: [JET_COVERS] });
  assert.equal(openVoteProblem(who(three, 'crank'), end({ quorum: 1 }), three, AT_NOW), SMALL_BOARD, 'Crank alone is left (8.6)');
  // The National Auditor on West's board gets no ballot on acting in a President or Treasurer seat (11.8).
  const west = world({
    without: ['penny-treasurer'],
    seats: [seat('kim-west-vp', 'kim', 'west', 'vice_president'), seat('spanner-saa', 'spanner', 'west', 'sergeant_at_arms'),
      stint('hal-acting-treasurer', 'hal', 'west', 'treasurer', { appointedBy: 'rusty' })],
  });
  assert.deepEqual(electorsFor('chapter_board', 'west', west, { memberId: 'hal', role: 'treasurer' }), ['rusty', 'spanner', 'torque']);
  assert.deepEqual(electorsFor('chapter_board', 'west', west, { memberId: 'hal', role: 'secretary' }), ['hal', 'kim', 'rusty', 'spanner', 'torque'], 'he isn’t acting as Secretary');
  // A covered holder still faces a 9.3 removal vote in the role's own shape: the seat is still theirs.
  const removal = input({
    chapterId: 'north', subjectMemberId: 'smokey', subjectRole: 'president', electorate: 'chapter_patched', threshold: 'two_thirds', quorum: 2,
    closesAt: hoursFrom(AT_NOW, 7 * 24),
  });
  assert.equal(openVoteProblem(who(w, 'crank'), removal, w, AT_NOW), null);
});

test('acting votes aren’t removal votes', () => {
  const seating = vote({
    id: 'v-acting', chapterId: 'north', subjectMemberId: 'jet', subjectRole: 'president', actingRequestId: 'crank-asks-jet',
    closedAt: '2026-11-14T01:00:00.000Z', result: 'carried',
  });
  const ending: Vote = { ...seating, id: 'v-end', actingRequestId: null, closedAt: null, result: null };
  assert.equal(isRemovalVote(seating), false);
  assert.equal(isRemovalVote(ending), true, 'a vote to end acting is one');
  const w = world({ seats: [JET_COVERS] });
  const cover = row(w, 'jet-covers-smokey');
  assert.equal(removalVoteFor(cover, [seating]), null, 'the vote that seated it doesn’t end it');
  assert.equal(removalVoteFor(cover, [seating, ending])?.id, 'v-end', 'a board majority ends acting');
  assert.deepEqual(removalShape('president', true), { electorate: 'chapter_board', threshold: 'majority' });
  assert.deepEqual(removalShape('president'), { electorate: 'chapter_patched', threshold: 'two_thirds' });
});

test('the acting vote question', () => {
  assert.equal(actingVoteQuestion(ask('crank-asks-jet'), world()), 'Jet acts as President (North) for Smokey until 13/12/2026: Smokey can’t be reached');
  const empty = world({ without: ['smokey-president'] });
  const asked = ask('crank-asks-jet', { covers: null, why: 'No President since the ACM' });
  assert.equal(actingVoteQuestion(asked, empty), 'Jet acts as President (North) until 13/12/2026: No President since the ACM');
});

test('opening the board’s vote on a request: the database’s order and words', () => {
  const five = world({ seats: FIVE, requests: [ask('crank-asks-jet'), ask('smokey-asks-jet', { requestedBy: 'smokey', why: 'Smokey overseas' })] });
  const open = (
    me: string | null, id = 'crank-asks-jet',
    o: { quorum?: number; closesAt?: string; meeting?: string | null; data?: ClubData; now?: string } = {},
  ) => {
    const data = o.data ?? five;
    const request = (data.actingRequests ?? []).find((r) => r.id === id);
    return openActingVoteProblem(
      me ? who(data, me) : null, request, o.quorum ?? 3, o.closesAt ?? hoursFrom(o.now ?? AT_NOW, 7 * 24), o.meeting ?? null, data, o.now ?? AT_NOW,
    );
  };
  assert.equal(open('crank'), null);
  assert.equal(open('ned'), null, 'any board member but the stand-in');
  assert.equal(open(null), 'Sign in first.');
  assert.equal(open('crank', 'nope'), NO_REQUEST);
  const withdrawn = world({ seats: FIVE, requests: [ask('crank-asks-jet', { closedAt: '2026-11-15T00:45:00.000Z', outcome: 'withdrawn' })] });
  assert.equal(open('crank', 'crank-asks-jet', { data: withdrawn }), NO_REQUEST);
  assert.equal(open('crank', 'crank-asks-jet', { now: '2026-12-14T01:00:00.000Z' }), NO_REQUEST, 'it lapsed at its until date');
  assert.equal(open('crank', 'smokey-asks-jet'), NO_VOTE_NEEDED, 'the holder asked: a third board member confirms it');
  assert.equal(open('lou'), BOARD_RECORDS_ACTING);
  assert.equal(open('jet'), NOT_YOURSELF);
  assert.equal(open('crank', 'crank-asks-jet', { data: world({ requests: [ask('crank-asks-jet')] }) }), SMALL_BOARD);
  assert.equal(open('crank', 'crank-asks-jet', { closesAt: hoursFrom(AT_NOW, 47) }), ACTING_VOTE_OPEN);
  assert.equal(open('crank', 'crank-asks-jet', { closesAt: hoursFrom(AT_NOW, 48) }), null, '48 hours is enough');
  assert.equal(open('crank', 'crank-asks-jet', { quorum: 2 }), 'Quorum must be between 3 and 3.', 'worked out on Crank, Gus and Ned');
  assert.equal(open('crank', 'crank-asks-jet', { closesAt: hoursFrom(AT_NOW, 61 * 24) }), 'Votes can stay open for 60 days at most.');
  assert.equal(open('crank', 'crank-asks-jet', { meeting: 'mt-none' }), 'No such meeting.');
  // The Auditor in West's VP seat stays out of a President seat (11.8).
  const west = world({
    without: ['rusty-president'],
    seats: [seat('kim-west-vp', 'kim', 'west', 'vice_president'), seat('spanner-saa', 'spanner', 'west', 'sergeant_at_arms')],
    requests: [ask('torque-asks-hal', { chapterId: 'west', memberId: 'hal', covers: null, requestedBy: 'torque', why: 'No President since the ACM' })],
  });
  assert.equal(open('kim', 'torque-asks-hal', { data: west }), AUDITOR_STAYS_OUT);
  assert.equal(open('torque', 'torque-asks-hal', { data: west }), null);
});

test('the stint warning on opening', () => {
  const later = '2026-12-20T08:00:00.000Z';
  const lastDay = '2026-12-13T08:00:00.000Z';
  // NEC: Jet covers Smokey until 13/12, so after that Smokey casts North's ballot.
  const covered = world({ seats: [JET_COVERS] });
  const nec = input({ chapterId: null, electorate: 'nec', quorum: 1, closesAt: later });
  assert.deepEqual(stintVoteWarnings(nec, covered, AT), ['Jet’s acting ends 13/12. Close before then, or Smokey votes for North instead.']);
  assert.deepEqual(stintVoteWarnings({ ...nec, closesAt: lastDay }, covered, AT), [], 'closing on his last day is fine');
  // The sitting VP recorded Acting President casts it as VP once the stint ends.
  const vp = world({ without: ['smokey-president'], seats: [stint('jet-acting-president', 'jet', 'north', 'president', { appointedBy: 'crank' })] });
  assert.deepEqual(stintVoteWarnings(nec, vp, AT), []);
  const nobody = world({ without: ['smokey-president', 'jet-vp'], seats: [stint('ned-acting-president', 'ned', 'north', 'president', { actingVote: 'v-acting' })] });
  assert.deepEqual(stintVoteWarnings(nec, nobody, AT), ['Ned’s acting ends 13/12. Close before then, or Ned can’t vote.']);
  // A board vote: Crank, acting in North's empty Treasurer seat with no seat of his own, loses his ballot.
  const board = input({ chapterId: 'north', quorum: 3, closesAt: later });
  const crank = world({ without: ['crank-rc'], seats: [stint('crank-acting-treasurer', 'crank', 'north', 'treasurer')] });
  assert.deepEqual(stintVoteWarnings(board, crank, AT), ['Crank’s acting ends 13/12. Close before then, or Crank can’t vote.']);
  assert.deepEqual(stintVoteWarnings({ ...board, closesAt: lastDay }, crank, AT), []);
  const seated = world({ seats: [stint('crank-acting-treasurer', 'crank', 'north', 'treasurer')] });
  assert.deepEqual(stintVoteWarnings(board, seated, AT), [], 'his own seat keeps his ballot');
  assert.deepEqual(stintVoteWarnings(board, covered, AT), [], 'a cover takes no ballot away');
});
