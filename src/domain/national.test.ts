import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideContributionProblem,
  proposeChapterProblem,
  proposeContributionProblem,
  settleChapterProblem,
  settledStatus,
  shareOut,
  slugOf,
  votingCounts,
  withdrawChapterProblem,
  withdrawContributionProblem,
  type ChapterInput,
} from './national';
import { club, member } from './stage4.testkit';
import type { ChapterProposal, ClubData, Contribution, Vote } from './types';

const vote = (id: string, over: Partial<Vote> = {}): Vote => ({
  id, chapterId: 'west', meetingId: null, subjectMemberId: null, question: 'Fund the national run?', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 1, openedAt: '2026-10-21T00:00:00.000Z',
  closesAt: '2026-10-25T00:00:00.000Z', closedAt: '2026-10-25T00:00:00.000Z', result: 'carried', castingVote: null,
  tally: { yes: 2, no: 0, abstain: 0 }, electorIds: [], votedIds: [], ballots: [], createdBy: null, ...over,
});

const contribution = (over: Partial<Contribution> = {}): Contribution => ({
  id: 'k1', title: 'National run', purpose: 'Patches and a BBQ.', totalCents: 100000, status: 'proposed', proposedBy: 'chair',
  proposedAt: '2026-10-20T00:00:00.000Z', settledAt: null,
  shares: [
    { chapterId: 'north', votingMembers: 3, cents: 33333 },
    { chapterId: 'west', votingMembers: 6, cents: 66667 },
  ],
  decisions: [], ...over,
});

function data(over: Partial<ClubData> = {}): ClubData {
  const base = club();
  return {
    ...base,
    members: [
      ...base.members,
      member('f1'), member('f2'), member('f3'), member('f4'), member('nomad', { status: 'nomad' }),
      member('ninth', { chapterId: 'north' }),
    ],
    votes: [
      vote('west-yes'), vote('west-no', { result: 'lost' }), vote('west-early', { closedAt: '2026-10-19T00:00:00.000Z' }),
      vote('west-open', { closedAt: null, result: null }), vote('north-yes', { chapterId: 'north' }),
      vote('nec-yes', { chapterId: null, electorate: 'nec' }), vote('nec-no', { chapterId: null, electorate: 'nec', result: 'lost' }),
    ],
    contributions: [contribution()],
    ...over,
  };
}
const who = (d: ClubData, id: string) => d.members.find((m) => m.id === id) ?? null;

// ---------------------------------------------------------------------------------------------
// Shares (13.6)

test('Voting Members are approved Full and Nomad members, per chapter', () => {
  const d = data();
  // West: sec, tre, rider, f1–f4, nomad (8); North: northsec, chair, auditor, ninth (4). The FNG,
  // applicants and Legacy don't count.
  assert.deepEqual(votingCounts(d), [
    { chapterId: 'north', votingMembers: 4 },
    { chapterId: 'west', votingMembers: 8 },
  ]);
});

test('shares are to the cent, remainders to the largest fractions, ties by slug', () => {
  assert.deepEqual(shareOut(100000, [{ chapterId: 'a', slug: 'a', votingMembers: 1 }, { chapterId: 'b', slug: 'b', votingMembers: 2 }]), [
    { chapterId: 'a', votingMembers: 1, cents: 33333 },
    { chapterId: 'b', votingMembers: 2, cents: 66667 },
  ]);
  assert.deepEqual(shareOut(101, [{ chapterId: 'n', slug: 'north', votingMembers: 1 }, { chapterId: 'w', slug: 'west', votingMembers: 1 }]), [
    { chapterId: 'n', votingMembers: 1, cents: 51 },
    { chapterId: 'w', votingMembers: 1, cents: 50 },
  ]);
  assert.deepEqual(shareOut(500, [{ chapterId: 'e', slug: 'east', votingMembers: 0 }, { chapterId: 'w', slug: 'west', votingMembers: 3 }]), [
    { chapterId: 'e', votingMembers: 0, cents: 0 },
    { chapterId: 'w', votingMembers: 3, cents: 500 },
  ]);
});

test('the NEC proposes a contribution', () => {
  const d = data();
  const k = (over = {}) => ({ title: 'National run', purpose: 'Patches.', totalCents: 50000, ...over });
  assert.equal(proposeContributionProblem(who(d, 'chair'), k(), d), null);
  assert.equal(proposeContributionProblem(who(d, 'sec'), k(), d), 'Only the NEC can propose a national contribution (13.6).');
  assert.equal(proposeContributionProblem(null, k(), d), 'Sign in first.');
  assert.equal(proposeContributionProblem(who(d, 'chair'), k({ title: ' ' }), d), 'Give it a title.');
  assert.equal(proposeContributionProblem(who(d, 'chair'), k({ title: 'x'.repeat(81) }), d), 'Keep the title to 80 characters at most.');
  assert.equal(proposeContributionProblem(who(d, 'chair'), k({ purpose: '' }), d), 'Say what it’s for.');
  assert.equal(proposeContributionProblem(who(d, 'chair'), k({ purpose: 'x'.repeat(1001) }), d), 'Keep it to 1000 characters at most.');
  assert.equal(proposeContributionProblem(who(d, 'chair'), k({ totalCents: 99 }), d), 'Enter a total from $1 to $100,000.');
  assert.equal(proposeContributionProblem(who(d, 'chair'), k({ totalCents: 10000001 }), d), 'Enter a total from $1 to $100,000.');
  const empty = { ...d, members: d.members.map((m) => ({ ...m, status: 'supporter' as const })) };
  assert.equal(proposeContributionProblem(who(empty, 'chair'), k(), empty), 'There are no Voting Members to share it between.');
});

test('each chapter board records its decision by its closed board vote', () => {
  const d = data();
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'west', 'west-yes', d), null);
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'west', 'west-no', d), null);
  assert.equal(decideContributionProblem(who(d, 'northsec'), 'k1', 'north', 'north-yes', d), null);
  assert.equal(decideContributionProblem(who(d, 'sec'), 'nope', 'west', 'west-yes', d), 'No such contribution.');
  assert.equal(decideContributionProblem(who(d, 'chair'), 'k1', 'west', 'west-yes', d), 'Only that chapter’s board can record its decision.');
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'north', 'north-yes', d), 'Only that chapter’s board can record its decision.');
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'west', 'west-early', d), 'Pick that chapter board’s closed vote on it (13.6).');
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'west', 'west-open', d), 'Pick that chapter board’s closed vote on it (13.6).');
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'west', 'north-yes', d), 'Pick that chapter board’s closed vote on it (13.6).');
  assert.equal(decideContributionProblem(who(d, 'sec'), 'k1', 'west', 'nec-yes', d), 'Pick that chapter board’s closed vote on it (13.6).');
  const decided = data({ contributions: [contribution({ decisions: [{ chapterId: 'west', yes: true, voteId: 'west-yes', recordedBy: 'sec', recordedAt: '2026-10-26T00:00:00.000Z' }] })] });
  assert.equal(decideContributionProblem(who(decided, 'tre'), 'k1', 'west', 'west-no', decided), 'That chapter has already decided.');
  const settled = data({ contributions: [contribution({ status: 'approved' })] });
  assert.equal(decideContributionProblem(who(settled, 'sec'), 'k1', 'west', 'west-yes', settled), 'That contribution is settled.');
});

test('a majority of the chapters approves it; once that can’t happen it isn’t approved', () => {
  const k = contribution();
  const yes = (chapterId: string, y: boolean) => ({ chapterId, yes: y, voteId: 'v', recordedBy: null, recordedAt: '' });
  assert.equal(settledStatus(k), null);
  assert.equal(settledStatus({ ...k, decisions: [yes('west', true)] }), null);
  assert.equal(settledStatus({ ...k, decisions: [yes('west', true), yes('north', true)] }), 'approved');
  assert.equal(settledStatus({ ...k, decisions: [yes('west', false)] }), 'not_approved');
  const three = { ...k, shares: [...k.shares, { chapterId: 'east', votingMembers: 1, cents: 0 }] };
  assert.equal(settledStatus({ ...three, decisions: [yes('west', true), yes('north', false)] }), null);
  assert.equal(settledStatus({ ...three, decisions: [yes('west', true), yes('east', true)] }), 'approved');
  assert.equal(settledStatus({ ...three, decisions: [yes('west', false), yes('east', false)] }), 'not_approved');
});

test('the NEC withdraws an open contribution', () => {
  const d = data();
  assert.equal(withdrawContributionProblem(who(d, 'chair'), 'k1', d), null);
  assert.equal(withdrawContributionProblem(who(d, 'sec'), 'k1', d), 'Only the NEC can withdraw it.');
  const settled = data({ contributions: [contribution({ status: 'withdrawn' })] });
  assert.equal(withdrawContributionProblem(who(settled, 'chair'), 'k1', settled), 'That contribution is settled.');
});

// ---------------------------------------------------------------------------------------------
// New chapters (12.1)

const plan = { location: 'Geelong and the Surf Coast.', membership: 'Six patched riders.', leadership: 'Pres and SAA named.', budget: '$500 start.', operations: 'Monthly meeting, two rides.' };
const chapterInput = (over: Partial<ChapterInput> = {}): ChapterInput => ({
  name: 'Surf Coast', area: 'Geelong', state: 'VIC', plan, founderIds: ['f1', 'f2', 'f3', 'f4', 'nomad'], presidentId: 'f1', saaId: 'f2', ...over,
});

test('the NEC or a founder puts a new chapter forward with five patched founders', () => {
  const d = data();
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput(), d), null);
  assert.equal(proposeChapterProblem(who(d, 'f3'), chapterInput(), d), null);
  assert.equal(proposeChapterProblem(who(d, 'rider'), chapterInput(), d), 'Only the NEC or one of the founders can put it forward.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ name: ' ' }), d), 'Name the chapter.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ name: '!!!' }), d), 'Name the chapter.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ name: 'x'.repeat(41) }), d), 'Keep the name to 40 characters at most.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ name: ' west ' }), d), 'There’s already a chapter called that.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ name: 'West!' }), d), 'There’s already a chapter called that.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ area: '' }), d), 'Say where it’s based.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ area: 'x'.repeat(81) }), d), 'Keep the area to 80 characters at most.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ state: 'XX' }), d), 'Pick a state.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ plan: { ...plan, budget: ' ' } }), d), 'Cover the budget in the proposal (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ plan: { ...plan, location: '' } }), d), 'Cover the location in the proposal (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ plan: { ...plan, operations: 'x'.repeat(2001) } }), d), 'Keep each part to 2000 characters at most.');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ founderIds: ['f1', 'f2', 'f3', 'f4'] }), d), 'A new chapter needs at least five founders (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ founderIds: ['f1', 'f2', 'f3', 'f4', 'f4'] }), d), 'A new chapter needs at least five founders (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ founderIds: ['f1', 'f2', 'f3', 'f4', 'fng'] }), d), 'Founders must be approved Full or Nomad members (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ founderIds: ['f1', 'f2', 'f3', 'f4', 'legacy'] }), d), 'Founders must be approved Full or Nomad members (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ presidentId: 'rider' }), d), 'Pick a founding President and Sergeant-at-Arms from the founders (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ saaId: 'f1' }), d), 'Pick a founding President and Sergeant-at-Arms from the founders (12.1).');
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ saaId: 'nomad' }), d), 'Nomads can’t hold a board seat (9.1).');
});

test('a name an open proposal already uses is taken', () => {
  const d = data({ chapterProposals: [proposal()] });
  assert.equal(proposeChapterProblem(who(d, 'chair'), chapterInput({ name: 'SURF COAST' }), d), 'There’s already a chapter called that.');
  const gone = data({ chapterProposals: [proposal({ status: 'withdrawn' })] });
  assert.equal(proposeChapterProblem(who(gone, 'chair'), chapterInput(), gone), null);
});

test('chapter slugs: lower case, dashes for anything else', () => {
  assert.equal(slugOf('  Surf Coast!  '), 'surf-coast');
  assert.equal(slugOf('Mornington—Peninsula'), 'mornington-peninsula');
  assert.equal(slugOf('***'), '');
});

function proposal(over: Partial<ChapterProposal> = {}): ChapterProposal {
  return {
    id: 'cp1', name: 'Surf Coast', area: 'Geelong', state: 'VIC', plan, founderIds: ['f1', 'f2', 'f3', 'f4', 'nomad'],
    presidentId: 'f1', saaId: 'f2', status: 'proposed', proposedBy: 'f1', proposedAt: '2026-10-20T00:00:00.000Z',
    voteId: null, decidedBy: null, decidedAt: null, chapterId: null, ...over,
  };
}

test('an NEC member settles it by the NEC’s closed vote', () => {
  const d = data({ chapterProposals: [proposal()] });
  assert.equal(settleChapterProblem(who(d, 'chair'), 'cp1', 'nec-yes', d), null);
  assert.equal(settleChapterProblem(who(d, 'chair'), 'cp1', 'nec-no', d), null);
  assert.equal(settleChapterProblem(who(d, 'sec'), 'cp1', 'nec-yes', d), 'Only the NEC can approve a new chapter (12.1).');
  assert.equal(settleChapterProblem(who(d, 'chair'), 'nope', 'nec-yes', d), 'No such proposal.');
  assert.equal(settleChapterProblem(who(d, 'chair'), 'cp1', 'west-yes', d), 'Pick the NEC’s closed vote on it (12.1).');
  const early = data({ chapterProposals: [proposal({ proposedAt: '2026-10-26T00:00:00.000Z' })] });
  assert.equal(settleChapterProblem(who(early, 'chair'), 'cp1', 'nec-yes', early), 'Pick the NEC’s closed vote on it (12.1).');
  const done = data({ chapterProposals: [proposal({ status: 'approved' })] });
  assert.equal(settleChapterProblem(who(done, 'chair'), 'cp1', 'nec-yes', done), 'That proposal is settled.');
});

test('founders still on their old chapter’s board end it first; a founder who left can’t found', () => {
  const held = data({ chapterProposals: [proposal({ founderIds: ['f1', 'f2', 'f3', 'f4', 'sec'] })] });
  assert.equal(settleChapterProblem(who(held, 'chair'), 'cp1', 'nec-yes', held), 'Founders have to end their positions in their old chapter first.');
  // A lost vote needs no checks on the founders.
  assert.equal(settleChapterProblem(who(held, 'chair'), 'cp1', 'nec-no', held), null);
  const left = data({ chapterProposals: [proposal({ founderIds: ['f1', 'f2', 'f3', 'f4', 'legacy'] })] });
  assert.equal(settleChapterProblem(who(left, 'chair'), 'cp1', 'nec-yes', left), 'Founders must be approved Full or Nomad members (12.1).');
});

test('the NEC or whoever proposed it withdraws it', () => {
  const d = data({ chapterProposals: [proposal()] });
  assert.equal(withdrawChapterProblem(who(d, 'f1'), 'cp1', d), null);
  assert.equal(withdrawChapterProblem(who(d, 'chair'), 'cp1', d), null);
  assert.equal(withdrawChapterProblem(who(d, 'f2'), 'cp1', d), 'Only the NEC or whoever put it forward can withdraw it.');
});
