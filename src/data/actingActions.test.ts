// The demo's acting writers (src/data/actingActions.ts) and the writers that end rows over acting,
// each writing what the database's RPC writes (supabase/migrations/20270870000000_acting_roles.sql
// §4, §5): who appointed it, the request and vote behind it, why each row ended, and each change
// logged. The shared route cases (supabase/tests/parity.json) check who may do each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRM_NOT_HOLDER, laterWhoCover, NO_REQUEST, NOT_YOURSELF, REPLACE_NEEDS_END,
} from '../domain/access';
import { endPositionRows, HOLDER_SEAT_ENDED } from '../domain/acting';
import type { ActingRequest, ChapterProposal, ClubData, Member, Position, PositionRole, Vote } from '../domain/types';
import { ACTING_VOTE_OPEN, castNecCast } from '../domain/votes';
import {
  ACTING_ACTIONS, appointActing, confirmActing, openActingVote, requestActing, requestCover, runActingAction, setActingUntil,
  withdrawActingRequest,
} from './actingActions';
import { settleChapter } from './adminActions';
import { renewAuditor } from './auditActions';
import { castBallot, openVote } from './businessActions';
import { NotAllowedError } from './clubContext';
import { appoint, deleteMyAccount, endTerm, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoStory.testkit';

// North: Smokey (President), Jet (VP), Crank (Road Captain), Lou (National Secretary), Ned and Gus
// (no seat). West: Rusty (President), Torque (Secretary), Penny (Treasurer), Spanner, Hal, Gravel and
// Kim (National Auditor). Sam is the National Chairman.
const AT = '2026-11-15';
const NOW = '2026-11-15T01:00:00.000Z';
const UNTIL = '2026-12-13';
const RIDERS: [string, string][] = [
  ['smokey', 'north'], ['jet', 'north'], ['crank', 'north'], ['lou', 'north'], ['ned', 'north'], ['gus', 'north'], ['sam', 'north'],
  ['rusty', 'west'], ['torque', 'west'], ['penny', 'west'], ['spanner', 'west'], ['hal', 'west'], ['gravel', 'west'], ['kim', 'west'],
];
const rider = (id: string, chapterId: string): Member => ({
  id, chapterId, fullName: `${id[0].toUpperCase()}${id.slice(1)} Rider`, roadName: null, status: 'full', approval: 'approved',
  joinedOn: '2023-01-01', patchedOn: '2023-06-01', fngStartedOn: null, bio: null, sharePhone: false, appliedOn: '2023-01-01', onHiatus: false,
});
const seat = (id: string, memberId: string, chapterId: string | null, role: PositionRole, over: Partial<Position> = {}): Position => ({
  id, memberId, chapterId, role, startedOn: '2026-08-01', endedOn: null, ...over,
});
const stint = (id: string, memberId: string, chapterId: string, role: PositionRole, over: Partial<Position> = {}): Position =>
  seat(id, memberId, chapterId, role, { startedOn: '2026-11-05', actingUntil: UNTIL, actingWhy: 'No one since the ACM', appointedBy: 'smokey', ...over });
const SEATS: Position[] = [
  seat('smokey-president', 'smokey', 'north', 'president'),
  seat('jet-vp', 'jet', 'north', 'vice_president'),
  seat('crank-rc', 'crank', 'north', 'road_captain'),
  seat('lou-nec-secretary', 'lou', null, 'nec_secretary'),
  seat('sam-nec-chair', 'sam', null, 'nec_chair'),
  seat('rusty-president', 'rusty', 'west', 'president'),
  seat('torque-secretary', 'torque', 'west', 'secretary'),
  seat('penny-treasurer', 'penny', 'west', 'treasurer'),
  seat('kim-auditor', 'kim', null, 'nec_auditor', { startedOn: '2025-12-01' }),
];
const JET_COVERS = stint('jet-covers-smokey', 'jet', 'north', 'president', { covers: 'smokey-president', actingWhy: 'Smokey overseas', appointedBy: 'crank' });
const FIVE: Position[] = [seat('ned-secretary', 'ned', 'north', 'secretary'), seat('gus-treasurer', 'gus', 'north', 'treasurer')];

interface World { seats?: Position[]; without?: string[]; requests?: ActingRequest[]; votes?: Vote[]; proposals?: ChapterProposal[] }
const world = (w: World = {}): ClubData => ({
  ...DEMO_DATA,
  chapters: [
    { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
    { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
  ],
  members: RIDERS.map(([id, ch]) => rider(id, ch)),
  positions: [...SEATS, ...(w.seats ?? [])].filter((p) => !w.without?.includes(p.id)),
  privates: [], bikes: [], registrations: [], emergencyContacts: [], rsvps: [], crew: [], rides: [], meetings: [],
  votes: w.votes ?? [], actingRequests: w.requests ?? [], actingChanges: [], chapterProposals: w.proposals ?? [],
});
const ctx = (data: ClubData, me: string): DemoCtx => ({ data, me: data.members.find((m) => m.id === me) ?? null, today: AT, now: NOW });
const row = (data: ClubData, id: string): Position => {
  const found = data.positions.find((p) => p.id === id);
  if (!found) throw new Error(`no position ${id}`);
  return found;
};
const added = (before: ClubData, after: ClubData): Position[] => after.positions.filter((p) => !before.positions.some((q) => q.id === p.id));
const refuses = (fn: () => unknown, words: string) =>
  assert.throws(fn, (e: unknown) => e instanceof NotAllowedError && e.message === words, `refused with "${words}"`);
/** Smokey asks for Jet to cover his President seat until UNTIL. */
const ask = (id: string, over: Partial<ActingRequest> = {}): ActingRequest => ({
  id, chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: UNTIL, why: 'Smokey overseas',
  requestedBy: 'smokey', createdAt: '2026-11-14T01:00:00.000Z', closedAt: null, outcome: null, ...over,
});
/** A North board-majority vote on Jet as President, opened 8 days ago and carried yesterday. */
const boardVote = (id: string, over: Partial<Vote> = {}): Vote => ({
  id, chapterId: 'north', meetingId: null, subjectMemberId: 'jet', subjectRole: 'president', question: 'Jet acts as President?', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, openedAt: '2026-11-07T01:00:00.000Z',
  closesAt: '2026-11-14T01:00:00.000Z', closedAt: '2026-11-14T01:00:00.000Z', result: 'carried', castingVote: null,
  tally: { yes: 3, no: 0, abstain: 0 }, electorIds: [], votedIds: [], ballots: [], createdBy: 'crank', ...over,
});

test('appointActing records the stint from today, with its why and who recorded it', () => {
  const before = world();
  const after = appointActing(ctx(before, 'smokey'), 'crank', 'north', 'treasurer', UNTIL, '  No Treasurer since the ACM ');
  const [stintRow] = added(before, after);
  assert.deepEqual({ ...stintRow, id: 'x' }, {
    id: 'x', memberId: 'crank', chapterId: 'north', role: 'treasurer', startedOn: AT, endedOn: null, actingUntil: UNTIL, covers: null,
    actingWhy: 'No Treasurer since the ACM', actingVote: null, actingRequestId: null, appointedBy: 'smokey', endedReason: null,
  });
  refuses(() => appointActing(ctx(before, 'crank'), 'crank', 'north', 'treasurer', UNTIL, 'Me'), NOT_YOURSELF);
});

test('requestCover and requestActing leave a request open, and nothing moves yet', () => {
  const before = world({ seats: FIVE });
  const asked = requestCover(ctx(before, 'smokey'), 'smokey-president', 'jet', UNTIL, ' Smokey overseas ');
  assert.equal(asked.positions, before.positions, 'no row yet');
  const [cover] = asked.actingRequests ?? [];
  assert.deepEqual({ ...cover, id: 'x' }, {
    id: 'x', chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: UNTIL, why: 'Smokey overseas',
    requestedBy: 'smokey', createdAt: NOW, closedAt: null, outcome: null,
  });
  const proposed = requestActing(ctx(before, 'crank'), 'jet', 'north', 'president', 'smokey-president', UNTIL, 'Smokey can’t be reached');
  assert.equal(proposed.actingRequests?.[0].requestedBy, 'crank');
  assert.equal(proposed.actingRequests?.[0].covers, 'smokey-president');
  refuses(() => requestCover(ctx(before, 'smokey'), 'smokey-president', 'smokey', UNTIL, 'Away'), NOT_YOURSELF);
});

test('confirmActing seats the cover, closes the request, sets actingVote for a voted one', () => {
  const agreed = world({ requests: [ask('smokey-asks-jet')] });
  const after = confirmActing(ctx(agreed, 'crank'), 'smokey-asks-jet');
  const [cover] = added(agreed, after);
  assert.deepEqual({ ...cover, id: 'x' }, {
    id: 'x', memberId: 'jet', chapterId: 'north', role: 'president', startedOn: AT, endedOn: null, actingUntil: UNTIL,
    covers: 'smokey-president', actingWhy: 'Smokey overseas', actingVote: null, actingRequestId: 'smokey-asks-jet', appointedBy: 'crank',
    endedReason: null,
  });
  assert.deepEqual(after.actingRequests?.[0], { ...ask('smokey-asks-jet'), closedAt: NOW, outcome: 'confirmed' });
  refuses(() => confirmActing(ctx(agreed, 'smokey'), 'smokey-asks-jet'), CONFIRM_NOT_HOLDER);
  refuses(() => confirmActing(ctx(after, 'ned'), 'smokey-asks-jet'), NO_REQUEST);
  // Crank asked, so it went to a board vote, which carried yesterday.
  const voted = world({
    seats: FIVE,
    requests: [ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' })],
    votes: [boardVote('v-acting', { actingRequestId: 'crank-asks-jet' })],
  });
  const seated = added(voted, confirmActing(ctx(voted, 'ned'), 'crank-asks-jet'));
  assert.equal(seated[0].actingVote, 'v-acting');
  assert.equal(seated[0].appointedBy, 'ned');
});

test('withdrawActingRequest closes it as withdrawn; one the board voted down has already closed', () => {
  const before = world({ requests: [ask('smokey-asks-jet')] });
  const after = withdrawActingRequest(ctx(before, 'jet'), 'smokey-asks-jet');
  assert.equal(after.actingRequests?.[0].outcome, 'withdrawn');
  assert.equal(after.actingRequests?.[0].closedAt, NOW);
  const lost = world({
    seats: FIVE, requests: [ask('crank-asks-jet', { requestedBy: 'crank' })],
    votes: [boardVote('v-acting', { actingRequestId: 'crank-asks-jet', result: 'lost' })],
  });
  refuses(() => withdrawActingRequest(ctx(lost, 'jet'), 'crank-asks-jet'), NO_REQUEST);
});

test('setActingUntil moves the date, keeps the start and logs the change', () => {
  const before = world({ seats: [stint('crank-acting-treasurer', 'crank', 'north', 'treasurer'), JET_COVERS] });
  const after = setActingUntil(ctx(before, 'smokey'), 'crank-acting-treasurer', '2027-01-10');
  const moved = row(after, 'crank-acting-treasurer');
  assert.equal(moved.actingUntil, '2027-01-10');
  assert.equal(moved.startedOn, '2026-11-05');
  assert.deepEqual(after.actingChanges?.map(({ id: _id, ...c }) => c), [{
    positionId: 'crank-acting-treasurer', chapterId: 'north', oldUntil: UNTIL, newUntil: '2027-01-10', changedBy: 'smokey', changedAt: NOW, note: null,
  }]);
  const same = setActingUntil(ctx(before, 'crank'), 'crank-acting-treasurer', UNTIL);
  assert.deepEqual(same.actingChanges, [], 'the same date changes nothing');
  refuses(() => setActingUntil(ctx(before, 'jet'), 'jet-covers-smokey', '2027-01-10'), laterWhoCover('Smokey'));
});

test('a full appoint ends empty-seat acting with replaced', () => {
  const before = world({ seats: [stint('crank-acting-treasurer', 'crank', 'north', 'treasurer')] });
  const after = appoint(ctx(before, 'smokey'), 'crank', 'north', 'treasurer');
  const ended = row(after, 'crank-acting-treasurer');
  assert.equal(ended.endedOn, AT);
  assert.equal(ended.endedReason, 'replaced');
  const [full] = added(before, after);
  assert.equal(full.memberId, 'crank');
  assert.equal(full.actingUntil ?? null, null, 'a full term');
  assert.equal(full.appointedBy, 'smokey');
  refuses(() => appoint(ctx(before, 'jet'), 'ned', 'north', 'treasurer'), REPLACE_NEEDS_END);
  // A non-board role: their own acting ends the same way, and anyone else's stays beside the new holder.
  const tg = world({ seats: [stint('hal-acting-tg', 'hal', 'west', 'tail_gunner', { appointedBy: 'rusty' })] });
  assert.equal(row(appoint(ctx(tg, 'rusty'), 'hal', 'west', 'tail_gunner'), 'hal-acting-tg').endedReason, 'replaced');
  assert.equal(row(appoint(ctx(tg, 'rusty'), 'gravel', 'west', 'tail_gunner'), 'hal-acting-tg').endedOn, null);
  // A stint that lapsed last night closes as lapsed, and the seat is free.
  const lapsed = world({ seats: [stint('ned-acting-vp', 'ned', 'north', 'vice_president', { startedOn: '2026-10-01', actingUntil: '2026-11-14' })], without: ['jet-vp'] });
  const filled = appoint(ctx(lapsed, 'smokey'), 'gus', 'north', 'vice_president');
  assert.equal(row(filled, 'ned-acting-vp').endedReason, 'lapsed');
  assert.equal(row(filled, 'ned-acting-vp').endedOn, AT);
});

test('endTerm records stepped_down, holder_back or removed', () => {
  const before = world({ seats: [JET_COVERS] });
  const reason = (me: string, id: string, data = before) => row(endTerm(ctx(data, me), id), id).endedReason;
  assert.equal(reason('jet', 'jet-covers-smokey'), 'stepped_down');
  assert.equal(reason('smokey', 'jet-covers-smokey'), 'holder_back');
  const voted = world({ seats: [JET_COVERS], votes: [boardVote('v-end-jet')] });
  assert.equal(reason('crank', 'jet-covers-smokey', voted), 'removed');
  assert.equal(row(endTerm(ctx(before, 'jet'), 'jet-covers-smokey'), 'jet-covers-smokey').endedOn, AT);
  // A full term: your own steps down, anyone else's follows a removal vote.
  assert.equal(reason('crank', 'crank-rc'), 'stepped_down');
  const removal = boardVote('v-crank', {
    subjectMemberId: 'crank', subjectRole: 'road_captain', electorate: 'chapter_patched', threshold: 'two_thirds',
  });
  assert.equal(reason('smokey', 'crank-rc', world({ votes: [removal] })), 'removed');
  // The covered holder stepping down takes the cover with them, logged.
  const after = endTerm(ctx(before, 'smokey'), 'smokey-president');
  assert.equal(row(after, 'smokey-president').endedReason, 'stepped_down');
  assert.equal(row(after, 'jet-covers-smokey').endedReason, 'left_board');
  assert.deepEqual(after.actingChanges?.map(({ id: _id, ...c }) => c), [{
    positionId: 'jet-covers-smokey', chapterId: 'north', oldUntil: UNTIL, newUntil: null, changedBy: 'smokey', changedAt: NOW, note: HOLDER_SEAT_ENDED,
  }]);
});

test('endPositionRows with reason forgotten ends a cover of that row; deleting an account writes forgotten', () => {
  const { positions } = endPositionRows([...SEATS, JET_COVERS], 'smokey-president', { reason: 'forgotten', by: null, today: AT });
  assert.equal(positions.find((p) => p.id === 'smokey-president')?.endedReason, 'forgotten');
  assert.equal(positions.find((p) => p.id === 'jet-covers-smokey')?.endedReason, 'left_board');
  const tg = world({ seats: [seat('gravel-tg', 'gravel', 'west', 'tail_gunner')] });
  const gone = row(deleteMyAccount(ctx(tg, 'gravel')), 'gravel-tg');
  assert.equal(gone.endedOn, AT);
  assert.equal(gone.endedReason, 'forgotten');
});

test('renewAuditor writes renewed, and the Chairman seats the new term', () => {
  const vote: Vote = boardVote('v-aud', {
    chapterId: null, subjectMemberId: 'kim', subjectRole: 'nec_auditor', electorate: 'nec', threshold: 'two_thirds', createdBy: 'sam',
  });
  const before = world({ votes: [vote] });
  const after = renewAuditor(ctx(before, 'sam'));
  assert.equal(row(after, 'kim-auditor').endedReason, 'renewed');
  assert.equal(row(after, 'kim-auditor').endedOn, AT);
  const [next] = added(before, after);
  assert.equal(next.appointedBy, 'sam');
  assert.equal(next.startedOn, AT);
});

test('settling a new chapter closes a founder’s stint that lapsed last night first', () => {
  const founders = ['ned', 'gus', 'hal', 'spanner', 'gravel'];
  const proposal: ChapterProposal = {
    id: 'cp1', name: 'Surf Coast', area: 'Geelong', state: 'VIC',
    plan: { location: 'Geelong.', membership: 'Five.', leadership: 'Named.', budget: '$500.', operations: 'Monthly.' },
    founderIds: founders, presidentId: 'ned', saaId: 'gus', status: 'proposed', proposedBy: 'ned', proposedAt: '2026-11-01T00:00:00.000Z',
    voteId: null, decidedBy: null, decidedAt: null, chapterId: null,
  };
  const necVote = boardVote('v-nec', { chapterId: null, subjectMemberId: null, subjectRole: null, electorate: 'nec', createdBy: 'lou' });
  const before = world({
    seats: [stint('ned-acting-secretary', 'ned', 'north', 'secretary', { startedOn: '2026-10-01', actingUntil: '2026-11-14' })],
    votes: [necVote], proposals: [proposal],
  });
  const { data, chapterId } = settleChapter(ctx(before, 'lou'), 'cp1', 'v-nec');
  assert.notEqual(chapterId, null);
  assert.equal(row(data, 'ned-acting-secretary').endedReason, 'lapsed');
  assert.equal(row(data, 'ned-acting-secretary').endedOn, AT);
});

test('the shared cases run the acting writers by name, with their dates resolved', () => {
  assert.deepEqual([...ACTING_ACTIONS].sort(), [
    'appointActing', 'confirmActing', 'openActingVote', 'requestActing', 'requestCover', 'setActingUntil', 'withdrawActingRequest',
  ]);
  const before = world();
  const after = runActingAction(ctx(before, 'smokey'), {
    action: 'appointActing', member: 'crank', chapter: 'north', role: 'treasurer', until: UNTIL, why: 'No Treasurer since the ACM',
  });
  assert.equal(added(before, after)[0].actingUntil, UNTIL);
});

test('openActingVote opens the board’s majority vote on the request, without the stand-in or the holder', () => {
  const before = world({ seats: FIVE, requests: [ask('crank-asks-jet', { requestedBy: 'crank', why: 'Smokey can’t be reached' })] });
  const closesAt = '2026-11-22T08:00:00.000Z';
  const { data, id } = openActingVote(ctx(before, 'crank'), 'crank-asks-jet', 3, closesAt, null);
  const opened = data.votes!.find((v) => v.id === id)!;
  assert.deepEqual({ ...opened, id: 'x' }, {
    id: 'x', chapterId: 'north', meetingId: null, subjectMemberId: 'jet', subjectRole: 'president',
    question: 'Jet acts as President (North) for Smokey until 13/12/2026: Smokey can’t be reached', details: null,
    electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, openedAt: NOW, closesAt, closedAt: null, result: null,
    castingVote: null, tally: null, electorIds: ['crank', 'gus', 'ned'], votedIds: [], ballots: [], createdBy: 'crank',
    actingRequestId: 'crank-asks-jet', electorChapters: {},
  });
  refuses(() => openActingVote(ctx(before, 'crank'), 'crank-asks-jet', 3, '2026-11-16T08:00:00.000Z', null), ACTING_VOTE_OPEN);
  // The shared cases name it with its closing time in days.
  const ran = runActingAction(ctx(before, 'crank'), { action: 'openActingVote', request: 'crank-asks-jet', quorum: 3, days: 7 });
  assert.equal(ran.votes!.at(-1)!.actingRequestId, 'crank-asks-jet');
});

test('openVote writes whose chapter each NEC ballot is, and castBallot passes an uncast one to its chapter’s voter', () => {
  // Sam chairs the NEC, so each chapter's President casts its vote.
  const before = world();
  const { data, id } = openVote(ctx(before, 'lou'), {
    chapterId: null, meetingId: null, subjectMemberId: null, subjectRole: null, question: 'Tuesdays?', details: null,
    electorate: 'nec', threshold: 'majority', secret: false, quorum: 2, closesAt: '2026-11-22T08:00:00.000Z',
  });
  const opened = data.votes!.find((v) => v.id === id)!;
  assert.deepEqual(opened.electorIds, ['rusty', 'smokey']);
  assert.deepEqual(opened.electorChapters, { rusty: 'west', smokey: 'north' });
  // Smokey's seat ends mid-vote, so Jet, North's VP from before it opened, casts its ballot.
  const ended = { ...data, positions: data.positions.map((p) => (p.id === 'smokey-president' ? { ...p, endedOn: AT } : p)) };
  const cast = castBallot(ctx(ended, 'jet'), id, 'yes');
  const after = cast.votes!.find((v) => v.id === id)!;
  assert.deepEqual(after.electorIds, ['jet', 'rusty'], 'the ballot row moves to him');
  assert.deepEqual(after.electorChapters, { jet: 'north', rusty: 'west' });
  assert.deepEqual(after.votedIds, ['jet']);
  assert.deepEqual(after.ballots, [{ memberId: 'jet', choice: 'yes' }]);
  refuses(() => castBallot(ctx(cast, 'jet'), id, 'no'), 'You’ve already voted.');
  // Had Smokey stayed, a cast ballot would stand.
  const stayed = { ...cast, positions: before.positions };
  refuses(() => castBallot(ctx(stayed, 'smokey'), id, 'no'), castNecCast('North'));
});
