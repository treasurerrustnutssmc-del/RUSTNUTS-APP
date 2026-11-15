import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clubwidePositions,
  coverOf,
  dutyPositions,
  endPositionRows,
  heldPositions,
  lapsedOwnRows,
  msUntilNextClubDay,
  necVoterFor,
  settleActing,
} from './acting';
import { melbourneDate } from './rides';
import { DEMO_DATA } from '../data/demoStory.testkit';
import type { ActingRequest, ClubData, Position, Vote } from './types';

// North: Smokey is President, Jet the VP, Crank the Road Captain. West: Rusty is President.
const row = (over: Partial<Position> & Pick<Position, 'id' | 'memberId' | 'role'>): Position => ({
  chapterId: 'north',
  startedOn: '2025-08-16',
  endedOn: null,
  ...over,
});
const smokeyPresident = row({ id: 'smokey-president', memberId: 'smokey', role: 'president' });
const jetVp = row({ id: 'jet-vp', memberId: 'jet', role: 'vice_president' });
const crankRc = row({ id: 'crank-rc', memberId: 'crank', role: 'road_captain' });
const jetCoversSmokey = row({
  id: 'jet-covers-smokey', memberId: 'jet', role: 'president', startedOn: '2026-11-15',
  actingUntil: '2026-12-13', covers: 'smokey-president', actingWhy: 'Smokey overseas', appointedBy: 'crank',
});
const north = [smokeyPresident, jetVp, crankRc];
const club = (positions: Position[], over: Partial<ClubData> = {}): ClubData => ({ ...DEMO_DATA, positions, ...over });
const ids = (rows: Position[]) => rows.map((p) => p.id).sort();

test('settle closes a stint the day after its until date', () => {
  const crankActingTreasurer = row({
    id: 'crank-acting-treasurer', memberId: 'crank', role: 'treasurer', startedOn: '2026-11-15',
    actingUntil: '2026-12-13', actingWhy: 'No Treasurer since the ACM',
  });
  const data = club([...north, crankActingTreasurer]);
  const onTheDay = settleActing(data, '2026-12-13').positions.find((p) => p.id === 'crank-acting-treasurer');
  assert.equal(onTheDay?.endedOn, null, 'still acting on its until date');
  const dayAfter = settleActing(data, '2026-12-14').positions.find((p) => p.id === 'crank-acting-treasurer');
  assert.equal(dayAfter?.endedOn, '2026-12-14');
  assert.equal(dayAfter?.endedReason, 'lapsed');
});

test('settle keeps the data object and unchanged row objects when nothing lapses', () => {
  assert.equal(settleActing(DEMO_DATA, '2026-11-15'), DEMO_DATA, 'no acting rows: the same object');
  const lapsing = row({
    id: 'hal-acting-vp', memberId: 'hal', chapterId: 'west', role: 'vice_president', startedOn: '2026-10-01',
    actingUntil: '2026-11-14', actingWhy: 'No VP since the ACM',
  });
  const data = club([...north, lapsing]);
  const settled = settleActing(data, '2026-11-15');
  assert.notEqual(settled, data);
  assert.equal(settled.positions[0], smokeyPresident, 'an untouched row keeps its object');
  assert.equal(settled.positions[2], crankRc);
  assert.equal(data.positions[3].endedOn, null, 'the stored rows are left as they were');
  const again = settleActing(settled, '2026-11-15');
  assert.equal(again, settled, 'settling settled rows changes nothing');
});

test('an old saved copy without acting fields settles unchanged', () => {
  // A copy saved before acting existed: rows have only the six old fields, and no request lists.
  const old: ClubData = { ...DEMO_DATA, positions: north.map((p) => ({ ...p })) };
  delete (old as Partial<ClubData>).actingRequests;
  delete (old as Partial<ClubData>).actingChanges;
  assert.equal(settleActing(old, '2026-11-15'), old);
});

test('settle closes lapsed acting requests', () => {
  const request = (over: Partial<ActingRequest> & Pick<ActingRequest, 'id'>): ActingRequest => ({
    chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: '2026-12-13',
    why: 'Smokey overseas', requestedBy: 'crank', createdAt: '2026-11-14T22:00:00.000Z', closedAt: null, outcome: null, ...over,
  });
  const open = request({ id: 'open' });
  const pastUntil = request({ id: 'past-until', until: '2026-11-14', createdAt: '2026-11-10T22:00:00.000Z' });
  // Made 9am 18/10/2026 in Melbourne: 28 days old on 15/11/2026. One made a day later is 27 days old.
  const old = request({ id: 'old', until: '2027-01-31', createdAt: '2026-10-17T22:00:00.000Z' });
  const youngEnough = request({ id: 'young', until: '2027-01-31', createdAt: '2026-10-18T22:00:00.000Z' });
  const confirmed = request({ id: 'done', until: '2026-11-01', closedAt: '2026-10-20T01:00:00.000Z', outcome: 'confirmed' });
  const data = club(north, { actingRequests: [open, pastUntil, old, youngEnough, confirmed] });
  const settled = settleActing(data, '2026-11-15').actingRequests ?? [];
  const byId = new Map(settled.map((r) => [r.id, r]));
  assert.equal(byId.get('open'), open, 'an open request in date is left alone');
  assert.equal(byId.get('young'), youngEnough, '27 days old is still open');
  assert.equal(byId.get('done'), confirmed, 'a closed request keeps its outcome');
  assert.equal(byId.get('past-until')?.outcome, 'lapsed');
  // It lapsed at Melbourne midnight after its until date (summer time, UTC+11).
  assert.equal(byId.get('past-until')?.closedAt, '2026-11-14T13:00:00.000Z');
  assert.equal(byId.get('old')?.outcome, 'lapsed');
  assert.equal(byId.get('old')?.closedAt, '2026-11-14T13:00:00.000Z');
});

test('settle closes a request whose acting vote was lost as rejected; no quorum leaves it open', () => {
  const request = (id: string): ActingRequest => ({
    id, chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: '2026-12-13',
    why: 'Smokey overseas', requestedBy: 'crank', createdAt: '2026-11-10T22:00:00.000Z', closedAt: null, outcome: null,
  });
  const vote = (id: string, actingRequestId: string, result: Vote['result']): Vote => ({
    id, chapterId: 'north', meetingId: null, subjectMemberId: 'jet', subjectRole: 'president', question: id, details: null,
    electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 2, openedAt: '2026-11-11T00:00:00.000Z',
    closesAt: '2026-11-14T00:00:00.000Z', closedAt: result ? '2026-11-14T00:00:00.000Z' : null, result, castingVote: null,
    tally: null, electorIds: [], votedIds: [], ballots: [], createdBy: null, actingRequestId,
  });
  const data = club(north, {
    actingRequests: [request('lost-one'), request('no-quorum-one'), request('open-vote-one')],
    votes: [vote('v1', 'lost-one', 'lost'), vote('v2', 'lost-one', null), vote('v3', 'no-quorum-one', 'no_quorum'), vote('v4', 'open-vote-one', null)],
  });
  const settled = new Map((settleActing(data, '2026-11-15').actingRequests ?? []).map((r) => [r.id, r]));
  assert.equal(settled.get('lost-one')?.outcome, 'rejected', 'a lost vote rejects it, even beside an open one');
  assert.equal(settled.get('lost-one')?.closedAt, '2026-11-14T00:00:00.000Z');
  assert.equal(settled.get('no-quorum-one')?.outcome, null);
  assert.equal(settled.get('open-vote-one')?.outcome, null);
});

test('Melbourne midnight in both daylight states', () => {
  // Summer time starts 4/10/2026: that day is 23 hours long.
  assert.equal(msUntilNextClubDay('2026-10-03T14:00:00.000Z'), 82_800_000);
  // Summer time ends 4/4/2027: that day is 25 hours long.
  assert.equal(msUntilNextClubDay('2027-04-03T13:00:00.000Z'), 90_000_000);
  assert.equal(msUntilNextClubDay('2026-11-15T12:59:00.000Z'), 60_000, 'a minute before midnight in summer time');
  assert.equal(melbourneDate('2026-10-03T13:59:59.000Z'), '2026-10-03');
  assert.equal(melbourneDate('2026-10-04T14:00:00.000Z'), '2026-10-05');
  assert.equal(melbourneDate('2026-10-03T14:00:00.000Z'), '2026-10-04');
});

test('the four readings', () => {
  const positions = [...north, jetCoversSmokey];
  assert.deepEqual(ids(heldPositions('smokey', positions)), ['smokey-president'], 'a covered President still holds the seat');
  assert.deepEqual(ids(dutyPositions('smokey', positions)), [], 'but has none of its duties');
  assert.deepEqual(ids(dutyPositions('jet', positions)), ['jet-covers-smokey', 'jet-vp']);
  assert.deepEqual(ids(clubwidePositions('jet', positions)), ['jet-vp'], 'nothing club-wide comes from acting');
  assert.deepEqual(ids(clubwidePositions('smokey', positions)), []);
  assert.equal(coverOf(smokeyPresident, positions), jetCoversSmokey);
  assert.equal(coverOf(jetVp, positions), null);
  // Without the cover, every reading is the open rows.
  assert.deepEqual(ids(dutyPositions('smokey', north)), ['smokey-president']);
  assert.deepEqual(ids(clubwidePositions('smokey', north)), ['smokey-president']);
  // An ended cover gives the duties back.
  const ended = { ...jetCoversSmokey, endedOn: '2026-11-20', endedReason: 'holder_back' as const };
  assert.deepEqual(ids(dutyPositions('smokey', [...north, ended])), ['smokey-president']);
  assert.equal(coverOf(smokeyPresident, [...north, ended]), null);
});

test('the covered row ending ends the cover (left_board)', () => {
  const { positions, changes } = endPositionRows([...north, jetCoversSmokey], 'smokey-president', {
    reason: 'stepped_down', by: 'smokey', today: '2026-11-20', now: '2026-11-20T01:00:00.000Z',
  });
  const byId = new Map(positions.map((p) => [p.id, p]));
  assert.equal(byId.get('smokey-president')?.endedOn, '2026-11-20');
  assert.equal(byId.get('smokey-president')?.endedReason, 'stepped_down');
  assert.equal(byId.get('jet-covers-smokey')?.endedOn, '2026-11-20');
  assert.equal(byId.get('jet-covers-smokey')?.endedReason, 'left_board');
  assert.equal(byId.get('jet-vp'), jetVp, 'other rows keep their objects');
  assert.deepEqual(
    changes.map(({ id: _id, ...c }) => c),
    [{
      positionId: 'jet-covers-smokey', chapterId: 'north', oldUntil: '2026-12-13', newUntil: null, changedBy: 'smokey',
      changedAt: '2026-11-20T01:00:00.000Z', note: 'Holder’s seat ended',
    }],
  );
  assert.equal(typeof changes[0].id, 'string');
});

test('the stand-in’s last board seat ending ends the cover (left_board)', () => {
  const how = { reason: 'stepped_down' as const, by: 'jet', today: '2026-11-20', now: '2026-11-20T01:00:00.000Z' };
  const ended = endPositionRows([...north, jetCoversSmokey], 'jet-vp', how);
  const cover = ended.positions.find((p) => p.id === 'jet-covers-smokey');
  assert.equal(cover?.endedOn, '2026-11-20');
  assert.equal(cover?.endedReason, 'left_board');
  assert.deepEqual(ended.changes.map((c) => [c.positionId, c.note]), [['jet-covers-smokey', 'Stand-in left the board']]);
  // A second board seat keeps a voted cover going.
  const jetSecretary = row({ id: 'jet-secretary', memberId: 'jet', role: 'secretary' });
  const votedCover = { ...jetCoversSmokey, actingVote: 'v-cover' };
  const kept = endPositionRows([...north, jetSecretary, votedCover], 'jet-vp', how);
  assert.equal(kept.positions.find((p) => p.id === 'jet-covers-smokey')?.endedOn, null);
  assert.deepEqual(kept.changes, []);
  // A President cover agreed with no vote rested on Jet being the VP (8.2), so it goes with that row.
  const agreed = endPositionRows([...north, jetSecretary, jetCoversSmokey], 'jet-vp', how);
  assert.equal(agreed.positions.find((p) => p.id === 'jet-covers-smokey')?.endedReason, 'left_board');
  // Crank, the Road Captain, covering the Secretary keeps it while he has another board seat.
  const louSecretary = row({ id: 'lou-secretary', memberId: 'lou', role: 'secretary' });
  const crankCoversLou = row({
    id: 'crank-covers-lou', memberId: 'crank', role: 'secretary', startedOn: '2026-11-15', actingUntil: '2026-12-13',
    covers: 'lou-secretary', actingWhy: 'Lou in hospital', actingVote: 'v-lou',
  });
  const crankSaa = row({ id: 'crank-saa', memberId: 'crank', role: 'sergeant_at_arms' });
  const two = endPositionRows([...north, louSecretary, crankSaa, crankCoversLou], 'crank-rc', how);
  assert.equal(two.positions.find((p) => p.id === 'crank-covers-lou')?.endedOn, null);
  const last = endPositionRows([...north, louSecretary, crankCoversLou], 'crank-rc', how);
  assert.equal(last.positions.find((p) => p.id === 'crank-covers-lou')?.endedReason, 'left_board');
  // A non-board role ending takes nothing with it.
  const jetTailGunner = row({ id: 'jet-tg', memberId: 'jet', role: 'tail_gunner' });
  const tg = endPositionRows([...north, jetTailGunner, jetCoversSmokey], 'jet-tg', how);
  assert.equal(tg.positions.find((p) => p.id === 'jet-covers-smokey')?.endedOn, null);
});

test('a no-vote Acting President’s VP row ending ends the stint (left_board); a voted one stays', () => {
  const how = { reason: 'stepped_down' as const, by: 'jet', today: '2026-11-20', now: '2026-11-20T01:00:00.000Z' };
  const smokeyEnded = { ...smokeyPresident, endedOn: '2026-11-01', endedReason: 'stepped_down' as const };
  const jetActingPresident = row({
    id: 'jet-acting-president', memberId: 'jet', role: 'president', startedOn: '2026-11-02', actingUntil: '2027-02-14',
    actingWhy: 'No President since Smokey stepped down', appointedBy: 'crank',
  });
  const noVote = endPositionRows([smokeyEnded, jetVp, crankRc, jetActingPresident], 'jet-vp', how);
  const stint = noVote.positions.find((p) => p.id === 'jet-acting-president');
  assert.equal(stint?.endedReason, 'left_board');
  assert.deepEqual(noVote.changes.map((c) => [c.positionId, c.note]), [['jet-acting-president', 'Stand-in left the board']]);
  const voted = endPositionRows([smokeyEnded, jetVp, crankRc, { ...jetActingPresident, actingVote: 'v-acting' }], 'jet-vp', how);
  assert.equal(voted.positions.find((p) => p.id === 'jet-acting-president')?.endedOn, null);
});

test('a cover already past its date closes as lapsed when its seat ends, unlogged', () => {
  const pastDate = { ...jetCoversSmokey, actingUntil: '2026-11-18' };
  const { positions, changes } = endPositionRows([...north, pastDate], 'smokey-president', {
    reason: 'stepped_down', by: 'smokey', today: '2026-11-20', now: '2026-11-20T01:00:00.000Z',
  });
  const cover = positions.find((p) => p.id === 'jet-covers-smokey');
  assert.equal(cover?.endedOn, '2026-11-19');
  assert.equal(cover?.endedReason, 'lapsed');
  assert.deepEqual(changes, []);
});

test('an early end is never before the row started', () => {
  const tomorrow = row({ id: 'gus-saa', memberId: 'gus', role: 'sergeant_at_arms', startedOn: '2026-11-21' });
  const { positions } = endPositionRows([tomorrow], 'gus-saa', { reason: 'stepped_down', by: 'gus', today: '2026-11-20' });
  assert.equal(positions[0].endedOn, '2026-11-21');
  const ended = endPositionRows(positions, 'gus-saa', { reason: 'removed', by: 'smokey', today: '2026-11-22' });
  assert.equal(ended.positions[0].endedReason, 'stepped_down', 'an ended row is left as it was');
});

test('lapsedOwnRows is true only when a settle ends the viewer’s own row', () => {
  const crankActingTreasurer = row({
    id: 'crank-acting-treasurer', memberId: 'crank', role: 'treasurer', startedOn: '2026-11-01',
    actingUntil: '2026-11-14', actingWhy: 'No Treasurer since the ACM',
  });
  const raw = club([...north, crankActingTreasurer]);
  assert.equal(lapsedOwnRows(raw, '2026-11-15', 'crank'), true);
  assert.equal(lapsedOwnRows(raw, '2026-11-14', 'crank'), false, 'not before it lapses');
  assert.equal(lapsedOwnRows(raw, '2026-11-15', 'smokey'), false, 'someone else’s stint');
  assert.equal(lapsedOwnRows(raw, '2026-11-15', null), false, 'nobody signed in');
  const settled = settleActing(raw, '2026-11-15');
  assert.equal(lapsedOwnRows(settled, '2026-11-15', 'crank'), false, 'already settled');
});

test('necVoterFor: an Acting President counts; an Acting VP and a VP’s stand-in don’t; the VP fallback stays', () => {
  assert.equal(necVoterFor('north', north), 'smokey');
  assert.equal(necVoterFor('north', [...north, jetCoversSmokey]), 'jet', 'the President’s stand-in casts it');
  const smokeyEnded = { ...smokeyPresident, endedOn: '2026-11-01', endedReason: 'stepped_down' as const };
  assert.equal(necVoterFor('north', [smokeyEnded, jetVp, crankRc]), 'jet', 'no President: the VP');
  const crankActingPresident = row({
    id: 'crank-acting-president', memberId: 'crank', role: 'president', startedOn: '2026-11-02', actingUntil: '2027-02-14',
    actingWhy: 'No President since the ACM', actingVote: 'v-acting',
  });
  assert.equal(necVoterFor('north', [smokeyEnded, jetVp, crankRc, crankActingPresident]), 'crank', 'an Acting President before the VP');
  const halActingVp = row({
    id: 'hal-acting-vp', memberId: 'hal', chapterId: 'west', role: 'vice_president', startedOn: '2026-11-02',
    actingUntil: '2027-02-14', actingWhy: 'No VP since the ACM',
  });
  assert.equal(necVoterFor('west', [halActingVp]), null, 'an Acting VP doesn’t cast it');
  const crankCoversJet = row({
    id: 'crank-covers-jet', memberId: 'crank', role: 'vice_president', startedOn: '2026-11-15', actingUntil: '2026-12-13',
    covers: 'jet-vp', actingWhy: 'Jet overseas',
  });
  assert.equal(necVoterFor('north', [smokeyEnded, jetVp, crankRc, crankCoversJet]), null, 'nor does a VP’s stand-in, nor the covered VP');
  // The President who chairs the NEC leaves it to the VP (11.2).
  const smokeyChair = row({ id: 'smokey-chair', memberId: 'smokey', chapterId: null, role: 'nec_chair' });
  assert.equal(necVoterFor('north', [...north, smokeyChair]), 'jet');
  assert.equal(necVoterFor('west', north), null);
});
