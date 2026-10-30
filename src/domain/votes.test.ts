import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import type { Vote } from './types';
import {
  canSeeVote,
  castProblem,
  chairOf,
  chaptersRepresented,
  closeProblem,
  decide,
  defaultQuorum,
  electorsFor,
  lacksChapters,
  NEC_SEATS_ONLY,
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
  assert.equal(castProblem(m('m-torque'), undefined, NOW), 'No such vote.');
  assert.equal(castProblem(m('m-spanner'), vote(), NOW), 'You’re not on this vote.');
  assert.equal(castProblem(m('m-torque'), vote({ votedIds: ['m-torque'] }), NOW), 'You’ve already voted.');
  assert.equal(castProblem(m('m-torque'), vote({ closedAt: NOW }), NOW), 'That vote has closed.');
  assert.equal(castProblem(m('m-torque'), vote(), LATER), 'That vote has closed.', 'past its closing time');
  assert.equal(castProblem(m('m-torque'), vote(), NOW), null);
  // The electorate was taken when the vote opened, so a later change of status doesn't take the ballot away.
  assert.equal(castProblem({ ...m('m-torque'), status: 'legacy' }, vote(), NOW), null);
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
