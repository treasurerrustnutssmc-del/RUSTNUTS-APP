import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import type { Vote } from './types';
import {
  canSeeVote,
  castProblem,
  chairOf,
  closeProblem,
  decide,
  defaultQuorum,
  electorsFor,
  openVoteProblem,
  ruleLine,
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
  chapterId: 'ch-west', meetingId: null, subjectMemberId: null, question: 'Buy a new gazebo?', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, closesAt: LATER, ...over,
});

const vote = (over: Partial<Vote> = {}): Vote => ({
  id: 'v-1', chapterId: 'ch-west', meetingId: null, subjectMemberId: null, question: 'Buy a new gazebo?', details: null,
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
  assert.ok(electorsFor('chapter_patched', 'ch-north', d).includes('m-ratchet'), 'Nomads are patched');
  assert.equal(electorsFor('club_patched', null, d).length, 12);
  assert.deepEqual(electorsFor('nec', null, d), ['m-rusty', 'm-smokey']);
});

test('the default quorum is more than half', () => {
  assert.equal(defaultQuorum(5), 3);
  assert.equal(defaultQuorum(4), 3);
  assert.equal(defaultQuorum(1), 1);
});

test('the chair', () => {
  assert.equal(chairOf('ch-west', P), 'm-rusty');
  assert.equal(chairOf('ch-north', P), 'm-smokey');
  assert.equal(chairOf(null, P), 'm-rusty', 'the National Chairman');
  assert.equal(chairOf('ch-west', P.filter((p) => p.role !== 'president')), null);
});

test('deciding a result', () => {
  const t = (yes: number, no: number, abstain = 0) => ({ yes, no, abstain });
  assert.deepEqual(decide('majority', 3, t(3, 2), null), { result: 'carried', tied: false });
  assert.deepEqual(decide('majority', 3, t(2, 3), null), { result: 'lost', tied: false });
  assert.deepEqual(decide('two_thirds', 3, t(4, 2), null), { result: 'carried', tied: false });
  assert.deepEqual(decide('two_thirds', 3, t(3, 2), null), { result: 'lost', tied: false });
  assert.deepEqual(decide('unanimous', 3, t(5, 0, 1), null), { result: 'carried', tied: false }, 'abstaining doesn’t block');
  assert.deepEqual(decide('unanimous', 3, t(4, 1), null), { result: 'lost', tied: false });
  assert.deepEqual(decide('unanimous', 3, t(0, 0, 4), null), { result: 'lost', tied: false }, 'all abstain is lost');
  assert.deepEqual(decide('majority', 5, t(2, 1, 1), null), { result: 'no_quorum', tied: false }, 'abstentions count to quorum');
  assert.deepEqual(decide('majority', 3, t(2, 2), null), { result: 'lost', tied: true });
  assert.deepEqual(decide('majority', 3, t(2, 2), 'yes'), { result: 'carried', tied: true });
  assert.deepEqual(decide('majority', 3, t(2, 2), 'no'), { result: 'lost', tied: true });
  assert.deepEqual(decide('two_thirds', 3, t(2, 2), null), { result: 'lost', tied: false }, 'only a majority vote can tie');
  assert.deepEqual(decide('majority', 3, t(0, 0, 3), null), { result: 'lost', tied: false }, 'nothing for or against is lost, not tied');
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
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 1 }), empty, NOW), null, 'a board of one can still vote');
  const noBoard = { ...d, positions: P.filter((p) => p.chapterId !== 'ch-north') };
  assert.equal(openVoteProblem(m('m-rusty'), input({ chapterId: 'ch-north', quorum: 1 }), noBoard, NOW), 'Nobody can vote in that electorate yet.');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 0 }), d, NOW), 'Quorum must be between 1 and 5.');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 6 }), d, NOW), 'Quorum must be between 1 and 5.');
  assert.equal(openVoteProblem(m('m-torque'), input({ quorum: 2.5 }), d, NOW), 'Quorum must be between 1 and 5.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: NOW }), d, NOW), 'Pick a closing time in the future.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: '' }), d, NOW), 'Pick a closing time in the future.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: '2026-12-24T02:00:00.001Z' }), d, NOW), 'Votes can stay open for 60 days at most.');
  assert.equal(openVoteProblem(m('m-torque'), input({ closesAt: '2026-12-23T02:00:00.000Z' }), d, NOW), null, 'exactly 60 days is fine');
  assert.equal(openVoteProblem(m('m-torque'), input(), d, NOW), null);
  assert.equal(openVoteProblem(m('m-smokey'), input({ chapterId: null, electorate: 'club_patched', quorum: 7 }), d, NOW), null);
});

test('a patch vote is unanimous among the chapter’s patched members, about one of its FNGs', () => {
  const patch = (over: Partial<VoteInput> = {}) =>
    input({ subjectMemberId: 'm-throttle', electorate: 'chapter_patched', threshold: 'unanimous', quorum: 4, ...over });
  assert.equal(openVoteProblem(m('m-torque'), patch(), d, NOW), null);
  const wrongSubject = 'A patch vote is for an approved FNG of that chapter.';
  assert.equal(openVoteProblem(m('m-torque'), patch({ subjectMemberId: 'm-lefty' }), d, NOW), wrongSubject, 'North FNG');
  assert.equal(openVoteProblem(m('m-torque'), patch({ subjectMemberId: 'm-spanner' }), d, NOW), wrongSubject, 'already Full');
  assert.equal(openVoteProblem(m('m-torque'), patch({ subjectMemberId: 'm-nobody' }), d, NOW), wrongSubject);
  const wrongRule = 'A patch vote is unanimous, among the chapter’s patched members.';
  assert.equal(openVoteProblem(m('m-torque'), patch({ threshold: 'majority' }), d, NOW), wrongRule);
  assert.equal(openVoteProblem(m('m-torque'), patch({ electorate: 'chapter_board', quorum: 3 }), d, NOW), wrongRule);
  assert.equal(openVoteProblem(m('m-smokey'), patch({ chapterId: null, electorate: 'club_patched' }), d, NOW), wrongSubject, 'patch votes belong to a chapter');
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
  const tie = 'It’s a tie. The chair closes it with the casting vote.';
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, null, d, LATER), tie);
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, 'yes', d, LATER), tie, 'only the chair casts');
  assert.equal(closeProblem(m('m-rusty'), tied, tiedBallots, null, d, LATER), tie);
  assert.equal(closeProblem(m('m-rusty'), tied, tiedBallots, 'yes', d, LATER), null);
  assert.equal(
    closeProblem(m('m-rusty'), vote(), { yes: 3, no: 1, abstain: 0 }, 'yes', d, LATER),
    'There’s no tie, so no casting vote.',
  );
  const noChair = { ...d, positions: P.filter((p) => !(p.role === 'president' && p.chapterId === 'ch-west')) };
  assert.equal(closeProblem(m('m-torque'), tied, tiedBallots, null, noChair, LATER), null, 'with no chair a tie is lost');
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
  assert.equal(ruleLine(vote({ threshold: 'unanimous' })), 'Unanimous · Quorum 3 of 5');
});
