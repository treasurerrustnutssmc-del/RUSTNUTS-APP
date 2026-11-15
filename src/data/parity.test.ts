// Runs the shared who-can-do-what cases (supabase/tests/parity.json) against the demo.
// `npm run test:db` runs the very same cases against the real database rules, and checks the
// database refuses with exactly the demo's message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_OFF, BUS_CLASH, BUS_PAST_START, bookedStraightAway, NOT_BUS_BOOKER, NOT_BUS_CANCELLER, NOT_BUS_MANAGER,
} from '../domain/bus';
import { roadRulesStatus } from '../domain/roadRules';
import { BRIEFED_AT, demoAnswer, fixture, fixtureData, parityToday, resolveCase } from './parityFixture.testkit';

test('the shared case list has cases', () => {
  assert.ok(fixture.cases.length >= 30);
});

test('every briefing case says which version it was made on', () => {
  const briefed = new Set((fixture.briefings ?? []).map((b) => b.ride));
  for (const c of fixture.cases.filter((x) => x.action === 'saveBriefing' || x.action === 'readBriefing')) {
    assert.ok('seen' in c && (c.seen === null || typeof c.seen === 'string'), `"${c.name}" has no seen`);
  }
  // The version-check cases are there: both refusals, and a read of the version stored.
  const named = (action: string, ride: (r: string) => boolean, seen: (s: unknown) => boolean, allowed: boolean) =>
    fixture.cases.some((c) => c.action === action && ride(String(c.ride)) && seen(c.seen) && c.allowed === allowed);
  const old = (s: unknown) => s === null || (typeof s === 'string' && Date.parse(s) < Date.parse(BRIEFED_AT) - 1);
  assert.ok(named('readBriefing', (r) => briefed.has(r), old, false), 'Got it on an older version');
  assert.ok(named('readBriefing', (r) => briefed.has(r), (s) => s === BRIEFED_AT, true), 'Got it on the version stored');
  assert.ok(named('saveBriefing', (r) => briefed.has(r), (s) => s === null, false), 'a save opened when there was none');
  assert.ok(named('saveBriefing', (r) => briefed.has(r), (s) => typeof s === 'string' && old(s), false), 'a save on an older version');
});

test('the Road Rules cases cover publishing and signing, with and without versions', () => {
  const rules = fixture.cases.filter((c) => c.action === 'publishRoadRules' || c.action === 'signRoadRules');
  for (const c of rules.filter((x) => x.action === 'publishRoadRules')) {
    assert.ok(typeof c.seen === 'number', `"${c.name}" says which version the editor opened on`);
  }
  for (const c of rules.filter((x) => x.action === 'signRoadRules')) {
    assert.ok(typeof c.version === 'number', `"${c.name}" says which version is on screen`);
  }
  const has = (action: string, test: (c: (typeof rules)[number]) => boolean) => rules.some((c) => c.action === action && test(c));
  assert.ok((fixture.roadRules ?? []).length >= 2, 'the fixture has versions');
  assert.ok(has('publishRoadRules', (c) => c.allowed && !c.noRoadRules), 'a publish on top of the current version');
  assert.ok(has('publishRoadRules', (c) => c.allowed && c.noRoadRules === true), 'a first version');
  // A clash: opened on a number that isn't the current (highest) one, whatever the numbers are.
  const current = Math.max(0, ...(fixture.roadRules ?? []).map((v) => v.number));
  assert.ok(has('publishRoadRules', (c) => !c.allowed && !c.noRoadRules && c.seen !== current), 'a clash');
  assert.ok(has('signRoadRules', (c) => c.allowed), 'a sign-off');
  assert.ok(has('signRoadRules', (c) => !c.allowed && c.noRoadRules === true), 'nothing to sign yet');
});

test('the Rusty Bus cases cover the spec’s eleven, with days counted from today', () => {
  const today = parityToday();
  const data = fixtureData([], today);
  const bus = fixture.cases.filter((c) => ['bookBus', 'decideBus', 'cancelBus'].includes(String(c.action)));
  for (const c of bus.filter((x) => x.action === 'bookBus')) {
    // Fixed dates would go stale: the database's today is the real Melbourne date.
    assert.ok(!('first' in c) && !('last' in c), `"${c.name}" counts its days from today`);
    assert.ok('firstDays' in c && 'lastDays' in c, `"${c.name}" has its days`);
  }
  for (const b of fixture.busBookings ?? []) {
    assert.ok(typeof b.firstDays === 'number' && typeof b.lastDays === 'number', `${b.key} counts its days from today`);
  }
  const me = (c: (typeof bus)[number]) => data.members.find((m) => m.id === c.as) ?? null;
  const straight = (c: (typeof bus)[number]) => {
    const r = resolveCase(c, today) as Record<string, unknown>;
    const input = {
      firstDay: String(r.first ?? ''), lastDay: String(r.last ?? ''), purpose: r.purpose as never, rideId: null, driverId: null, notes: '',
    };
    return bookedStraightAway(me(c), input, today, data);
  };
  const has = (action: string, what: string, test: (c: (typeof bus)[number]) => boolean) =>
    assert.ok(bus.some((c) => c.action === action && test(c)), what);
  const says = (message: string) => (c: (typeof bus)[number]) => !c.allowed && demoAnswer(c) === message;
  has('bookBus', 'book: a member asking', (c) => c.allowed && !straight(c));
  has('bookBus', 'book: a recovery booked straight away', (c) => c.allowed && c.purpose === 'recovery' && straight(c));
  has('bookBus', 'book: a clash on straight away', (c) => straight(c) && says(BUS_CLASH)(c));
  has('bookBus', 'book: a past start', says(BUS_PAST_START));
  // The spec's "recovery in 3 days" waits, so it may be asked for over a Booked day.
  const overBooked = (c: (typeof bus)[number]) =>
    (fixture.busBookings ?? []).some(
      (b) => b.status === 'approved' && b.firstDays <= Number(c.lastDays) && Number(c.firstDays) <= b.lastDays,
    );
  has('bookBus', 'book: a recovery in three days waits over a Booked day', (c) =>
    c.allowed && c.purpose === 'recovery' && c.firstDays === 3 && !straight(c) && overBooked(c));
  has('bookBus', 'book: an FNG refused', (c) => me(c)?.status === 'fng' && says(NOT_BUS_BOOKER)(c));
  has('decideBus', 'decide: a yes', (c) => c.allowed && c.yes === true);
  has('decideBus', 'decide: a clashing yes', (c) => c.yes === true && says(BUS_CLASH)(c));
  has('decideBus', 'decide: a non-manager', says(NOT_BUS_MANAGER));
  const bookedBy = (key: unknown) => (fixture.busBookings ?? []).find((b) => b.key === key)?.bookedBy;
  has('cancelBus', 'cancel: by the booker', (c) => c.allowed && bookedBy(c.booking) === c.as);
  has('cancelBus', 'cancel: by a stranger', says(NOT_BUS_CANCELLER));
  has('cancelBus', 'cancel: already off', says(ALREADY_OFF));
});

test('the Going gate cases: unsigned and expired refused, due soon, Maybe, Legacy and nothing published allowed, and crew', () => {
  const today = parityToday();
  const data = fixtureData([], today);
  const state = (key: string | null) => roadRulesStatus(data.members.find((m) => m.id === key)!, data, today).state;
  const cases = fixture.cases.filter((c) => c.action === 'rsvp' || c.action === 'crew');
  const has = (action: string, test: (c: (typeof cases)[number]) => boolean, what: string) =>
    assert.ok(cases.some((c) => c.action === action && test(c)), what);
  const going = (c: (typeof cases)[number]) => c.answer === 'going' && !c.noRoadRules;
  has('rsvp', (c) => going(c) && state(c.as) === 'unsigned' && !c.allowed, 'Going while unsigned, refused');
  has('rsvp', (c) => going(c) && state(c.as) === 'expired' && !c.allowed, 'Going while expired, refused');
  has('rsvp', (c) => going(c) && state(c.as) === 'due_soon' && c.allowed, 'Going while due soon, allowed');
  has('rsvp', (c) => c.answer === 'maybe' && state(c.as) === 'unsigned' && c.allowed, 'Maybe while unsigned, allowed');
  has('rsvp', (c) => c.answer === 'going' && c.noRoadRules === true && c.allowed, 'Going with nothing published, allowed');
  const legacy = (key: string | null) => data.members.find((m) => m.id === key)?.status === 'legacy';
  has('rsvp', (c) => going(c) && legacy(c.as) && c.allowed, 'Going as Legacy, allowed');
  const target = (c: (typeof cases)[number]) => state(c.member as string);
  has('crew', (c) => !c.noRoadRules && target(c) === 'unsigned' && c.as !== c.member && !c.allowed, 'crewing an unsigned member, refused');
  has('crew', (c) => !c.noRoadRules && target(c) === 'expired' && !c.allowed, 'crewing an expired member, refused');
  has('crew', (c) => !c.noRoadRules && target(c) === 'due_soon' && c.allowed, 'crewing a due-soon member, allowed');
});

// Acting roles
test('a case that names its refusal gets exactly it from the demo, or the case list is wrong', () => {
  const lapsed = fixture.cases.find((c) => c.name === 'A lapsed acting VP gets no board ballot');
  assert.ok(lapsed, 'the smoke case is there');
  const said = demoAnswer(lapsed);
  assert.ok(said !== null && /^Quorum must be between/.test(said), `the quorum refusal: ${said}`);
  assert.equal(demoAnswer({ ...lapsed, refusal: said }), said);
  assert.throws(() => demoAnswer({ ...lapsed, refusal: 'Some other reason.' }), /should refuse with "Some other reason\."/);
  assert.throws(() => demoAnswer({ ...lapsed, quorum: 3, refusal: said }), /allowed it/);
});

test('a refusal a case names goes in `refusal`: on a case that isn’t about a chat message, `message` is a mistake', () => {
  const lapsed = fixture.cases.find((c) => c.name === 'A lapsed acting VP gets no board ballot')!;
  assert.throws(() => demoAnswer({ ...lapsed, message: demoAnswer(lapsed) }), /`refusal`/);
  // The chat cases keep `message` for the message they act on.
  for (const action of ['chatRemove', 'chatReact', 'chatPin', 'chatReport']) {
    const chat = fixture.cases.find((c) => c.action === action && c.message !== undefined);
    assert.ok(chat, `a ${action} case names its message`);
    assert.doesNotThrow(() => demoAnswer(chat));
  }
});

test('the lapsed acting VP case has an in-date twin that gets the ballot, so the lapse is what refuses it', () => {
  const named = (name: string) => {
    const c = fixture.cases.find((x) => x.name === name);
    assert.ok(c, `"${name}" is there`);
    return c;
  };
  const lapsed = named('A lapsed acting VP gets no board ballot');
  const inDate = named('An acting VP in date gets a board ballot');
  const { name: _l, allowed: _la, with: lapsedRows, ...lapsedRest } = lapsed;
  const { name: _i, allowed: _ia, with: inDateRows, ...inDateRest } = inDate;
  assert.deepEqual(inDateRest, lapsedRest, 'the same case otherwise');
  assert.deepEqual(inDateRows, lapsedRows?.map((r) => ({ ...r, actingUntilDays: 0 })), 'the same row, acting until today');
  assert.equal(lapsed.allowed, false);
  assert.equal(inDate.allowed, true);
  // The row is what lets it through: without it, the quorum is refused.
  assert.notEqual(demoAnswer({ ...inDate, with: undefined }), null);
});

test('the cases run every acting extra the database inserts: a linked row, a cover request, a carried acting vote and an NEC vote', () => {
  const cases = fixture.cases;
  assert.ok(cases.some((c) => c.with?.some((r) => r.requestedBy && r.actingVote)), 'a row confirmed from a request, with its vote');
  assert.ok(cases.some((c) => c.withRequests?.some((x) => x.covers)), 'an open cover request');
  assert.ok(
    cases.some((c) => c.withVotes?.some((v) => v.actingRequest && v.result && v.voted?.length)),
    'a closed acting vote with ballots',
  );
  assert.ok(cases.some((c) => c.withVotes?.some((v) => v.electorate === 'nec' && !v.result)), 'an open NEC vote');
});

test('fixtureData adds a case’s extra rows, requests and votes as the database gets them', () => {
  const today = '2026-11-15';
  const data = fixtureData([], today, {
    with: [{
      key: 'x-vp', member: 'spanner', chapter: 'west', role: 'vice_president', startedDays: -2, actingUntilDays: 20,
      why: 'No VP since the ACM', appointedBy: 'torque', requestedBy: 'rusty', actingVote: 'x-vote',
    }, { key: 'x-old', member: 'hal', chapter: 'west', role: 'sergeant_at_arms', startedDays: -40, actingUntilDays: -10, endedDays: -9, why: 'Away' }],
    withRequests: [{
      key: 'x-ask', chapter: 'west', role: 'secretary', member: 'hal', covers: 'torque-secretary', untilDays: 20, why: 'Torque overseas',
      requestedBy: 'rusty',
    }],
    withVotes: [{
      key: 'x-vote', chapter: 'west', electorate: 'chapter_board', threshold: 'majority', subject: 'spanner', role: 'vice_president',
      actingRequest: 'x-vp', electors: ['torque', 'rusty', 'penny'], voted: ['torque', 'rusty'], result: 'carried', closedDays: -3,
    }, { key: 'x-nec', chapter: null, electorate: 'nec', threshold: 'majority', electors: ['smokey', 'rusty'], voted: ['rusty'] }],
  });
  assert.deepEqual(data.positions.find((p) => p.id === 'x-vp'), {
    id: 'x-vp', memberId: 'spanner', chapterId: 'west', role: 'vice_president', startedOn: '2026-11-13', endedOn: null,
    actingUntil: '2026-12-05', covers: null, actingWhy: 'No VP since the ACM', actingVote: 'x-vote', actingRequestId: 'x-vp',
    appointedBy: 'torque', endedReason: null,
  });
  const old = data.positions.find((p) => p.id === 'x-old');
  assert.equal(old?.endedOn, '2026-11-06');
  assert.equal(old?.endedReason, 'lapsed');
  const requests = data.actingRequests ?? [];
  assert.deepEqual(
    requests.map(({ createdAt: _c, closedAt, ...r }) => ({ ...r, closed: closedAt !== null })),
    [
      {
        id: 'x-ask', chapterId: 'west', role: 'secretary', memberId: 'hal', covers: 'torque-secretary', until: '2026-12-05',
        why: 'Torque overseas', requestedBy: 'rusty', outcome: null, closed: false,
      },
      {
        id: 'x-vp', chapterId: 'west', role: 'vice_president', memberId: 'spanner', covers: null, until: '2026-12-05',
        why: 'No VP since the ACM', requestedBy: 'rusty', outcome: 'confirmed', closed: true,
      },
    ],
  );
  const vote = data.votes.find((v) => v.id === 'x-vote')!;
  assert.equal(vote.actingRequestId, 'x-vp');
  assert.equal(vote.subjectMemberId, 'spanner');
  assert.equal(vote.subjectRole, 'vice_president');
  assert.equal(vote.quorum, 3);
  assert.equal(vote.result, 'carried');
  assert.deepEqual(vote.electorIds, ['penny', 'rusty', 'torque']);
  assert.deepEqual(vote.votedIds, ['rusty', 'torque']);
  assert.deepEqual(vote.ballots, [{ memberId: 'rusty', choice: 'yes' }, { memberId: 'torque', choice: 'yes' }]);
  assert.equal(Date.parse(vote.closesAt) - Date.parse(vote.openedAt), 7 * 86_400_000);
  assert.equal(vote.closedAt, vote.closesAt);
  assert.ok(Date.parse(vote.closesAt) < Date.now());
  assert.deepEqual(vote.electorChapters, {});
  const nec = data.votes.find((v) => v.id === 'x-nec')!;
  assert.equal(nec.closedAt, null);
  assert.equal(nec.result, null);
  assert.ok(Date.parse(nec.closesAt) > Date.now());
  assert.deepEqual(nec.electorChapters, { smokey: 'north', rusty: 'west' });
  // A case with no extras gets the shared data as it is.
  assert.equal(fixtureData([], today).positions.some((p) => p.id === 'x-vp'), false);
});

for (const c of fixture.cases) {
  test(`demo: ${c.name} → ${c.allowed ? 'allowed' : 'refused'}`, () => {
    const refusal = demoAnswer(c);
    if (c.allowed) assert.equal(refusal, null, `refused: ${refusal}`);
    else assert.notEqual(refusal, null, 'was allowed');
  });
}
