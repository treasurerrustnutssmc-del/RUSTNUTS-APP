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
  patchVoteFor,
  patchVoteTooEarly,
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
  assert.equal(openVoteProblem(m('m-rusty'), input({ chapterId: 'ch-north', quorum: 1 }), noBoard, NOW), 'Nobody can vote in that electorate yet.');
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
    input({ subjectMemberId: 'm-throttle', electorate: 'chapter_patched', threshold: 'unanimous', secret: true, quorum: 4, ...over });
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

test('the patch vote on a member: the open one, or else the latest result', () => {
  const t = 'm-throttle';
  const lost = vote({ id: 'old', electorate: 'chapter_patched', subjectMemberId: t, closedAt: '2026-05-01T09:00:00.000Z', result: 'lost' });
  const carried = vote({ id: 'new', electorate: 'chapter_patched', subjectMemberId: t, closedAt: '2026-09-01T09:00:00.000Z', result: 'carried' });
  const open = vote({ id: 'open', electorate: 'chapter_patched', subjectMemberId: t });
  const other = vote({ id: 'other', electorate: 'chapter_patched', subjectMemberId: 'm-dylan' });
  assert.equal(patchVoteFor(t, []), null);
  assert.equal(patchVoteFor(t, [lost, other])?.id, 'old');
  assert.equal(patchVoteFor(t, [carried, lost])?.id, 'new', 'latest result');
  assert.equal(patchVoteFor(t, [carried, open, lost])?.id, 'open', 'an open vote comes first');
  assert.equal(patchVoteFor(t, [vote({ id: 'gazebo' })]), null, 'not a vote about anyone');
});
