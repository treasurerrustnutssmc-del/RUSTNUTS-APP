import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_DATA, STORY_TODAY } from '../data/demoStory.testkit';
import { accessLevel, actingWarnings } from './access';
import {
  boardGroups, boardRequests, closeRequestNote, boardScope, needsYou, needsYouTarget, requestActions, requestConfirmNote, requestLine, requestNext, scopeText, stintLine, stintsDue,
  stintTone, termsDue, vpFallbackLine,
} from './boardLayout';
import { addDays } from './dates';
import type { ActingRequest, ClubData, Member, Position, Vote } from './types';

const none = { pending: 0, alerts: 0, noContact: 0, fngs: 0 };

test('nothing is listed under Needs you when nothing is waiting', () => {
  assert.deepEqual(needsYou(none), []);
});

test('Needs you lists only what has a count, most urgent first, in plain words', () => {
  assert.deepEqual(needsYou({ pending: 2, alerts: 3, noContact: 0, fngs: 1 }), [
    { kind: 'pending', group: 'approvals', text: '2 people waiting for approval' },
    { kind: 'alerts', group: 'people', text: '3 regos, licences or first aid certificates due' },
    { kind: 'fngs', group: 'people', text: '1 FNG review' },
  ]);
});

test('singular and plural read correctly', () => {
  assert.deepEqual(needsYou({ ...none, pending: 1 })[0].text, '1 person waiting for approval');
  assert.deepEqual(needsYou({ ...none, noContact: 1 })[0].text, '1 member without an emergency contact');
  assert.deepEqual(needsYou({ ...none, noContact: 4 })[0].text, '4 members without an emergency contact');
  assert.deepEqual(needsYou({ ...none, alerts: 1 })[0].text, '1 rego, licence or first aid certificate due');
  assert.deepEqual(needsYou({ ...none, fngs: 3 })[0].text, '3 FNG reviews');
});

test('the groups come in a fixed order, and only the ones with something open start expanded', () => {
  const quiet = boardGroups(none);
  assert.deepEqual(quiet.map((g) => g.id), ['approvals', 'people', 'meetings', 'money', 'website']);
  assert.deepEqual(quiet.filter((g) => g.startsOpen), []);
  const busy = boardGroups({ pending: 2, alerts: 1, noContact: 0, fngs: 0 });
  assert.deepEqual(busy.filter((g) => g.startsOpen).map((g) => g.id), ['approvals', 'people']);
  const onlyFngs = boardGroups({ ...none, fngs: 2 });
  assert.deepEqual(onlyFngs.filter((g) => g.startsOpen).map((g) => g.id), ['people']);
});

test('each group says in one line what is inside, with counts where there are any', () => {
  const g = Object.fromEntries(boardGroups({ pending: 0, alerts: 1, noContact: 2, fngs: 3 }).map((x) => [x.id, x.summary]));
  assert.equal(g.approvals, 'Nobody waiting');
  assert.equal(g.people, '1 due, 2 without a contact, 3 FNG reviews');
  assert.equal(g.meetings, 'Attendance and check-ins');
  assert.equal(g.money, 'Chapter fees');
  assert.equal(g.website, 'Enquiries, news, visits and app feedback');
  assert.equal(boardGroups(none).find((x) => x.id === 'people')!.summary, 'Nothing due');
});

// Acting (docs/superpowers/specs/2026-11-15-acting-roles-design.md): an Acting President takes part
// in NEC business but sees no other chapter's board, and a stint isn't a term.

const member = (id: string): Member => DEMO_DATA.members.find((m) => m.id === id)!;
/** Jet (North's VP) covers Smokey's President seat. */
const jetCovers: Position = {
  id: 'p-jet-covers', memberId: 'm-jet', chapterId: 'ch-north', role: 'president', startedOn: '2026-10-15', endedOn: null,
  actingUntil: '2026-11-14', covers: 'p-9', actingWhy: 'Smokey overseas', appointedBy: 'm-crank',
};

test('the Board tab covers every chapter only for those who see every chapter, not every national level', () => {
  const covered = [...DEMO_DATA.positions, jetCovers];
  assert.equal(boardScope(member('m-rusty'), covered), null, 'the National Chairman sees every chapter');
  assert.equal(boardScope(member('m-smokey'), covered), 'ch-north');
  assert.equal(accessLevel(member('m-jet'), covered), 'national', 'an Acting President is on the NEC');
  assert.equal(boardScope(member('m-jet'), covered), 'ch-north', 'but sees only North’s board');
});

test('Attendance and terms lists terms ending or ended, never a stint', () => {
  const due = termsDue(DEMO_DATA.positions, null, STORY_TODAY).map((p) => p.id);
  assert.ok(due.includes('p-18'), 'the Auditor’s twelve months end within 60 days');
  assert.ok(!due.includes('p-19'), 'Crank’s stint ends on its until date: it isn’t a term to re-elect');
  assert.deepEqual(termsDue(DEMO_DATA.positions, 'ch-north', STORY_TODAY).map((p) => p.id), []);
});

// --- Task 19: the Board tab's requests and 11.2 line, and the stints in "Attendance and terms" ----

const at = (data: ClubData, id: string): Position => data.positions.find((p) => p.id === id)!;
const NOW = `${STORY_TODAY}T01:00:00.000Z`;
const [smokey, jet, crank, rusty, torque, diesel, sparks, spanner, ace] =
  ['m-smokey', 'm-jet', 'm-crank', 'm-rusty', 'm-torque', 'm-diesel', 'm-sparks', 'm-spanner', 'm-ace'].map(member);
const ask = (id: string, over: Partial<ActingRequest>): ActingRequest => ({
  id, chapterId: 'ch-north', role: 'president', memberId: 'm-jet', covers: 'p-9', until: '2026-12-13', why: 'Smokey overseas',
  requestedBy: 'm-smokey', createdAt: `${STORY_TODAY}T00:00:00.000Z`, closedAt: null, outcome: null, ...over,
});
/** Smokey asks for Jet (VP) to cover his seat: an agreed cover, which a third board member confirms. */
const smokeyAsks = ask('ar-smokey', {});
/** Diesel asks for Torque to cover Rusty, who can't be asked: a voted cover (route 3). */
const dieselAsks = ask('ar-diesel', {
  chapterId: 'ch-west', memberId: 'm-torque', covers: 'p-1', until: addDays(STORY_TODAY, 28), why: 'Rusty in hospital', requestedBy: 'm-diesel',
});
const withRequests = (...requests: ActingRequest[]): ClubData => ({ ...DEMO_DATA, actingRequests: requests });
const actingVote = (id: string, over: Partial<Vote>): Vote => ({
  id, chapterId: 'ch-west', meetingId: null, subjectMemberId: null, subjectRole: null, question: 'A question', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, openedAt: `${addDays(STORY_TODAY, -6)}T00:00:00.000Z`,
  closesAt: `${addDays(STORY_TODAY, 1)}T08:00:00.000Z`, closedAt: null, result: null, castingVote: null, tally: null,
  electorIds: ['m-diesel', 'm-sparks', 'm-gravel'], votedIds: [], ballots: [], createdBy: 'm-diesel', actingRequestId: 'ar-diesel',
  electorChapters: {}, ...over,
});

test('requestLine: an agreed cover and a voted request, as the Board tab shows them', () => {
  // A chapter seat always names its chapter, so an All chapters Board tab says whose seat it is.
  assert.equal(requestLine(smokeyAsks, DEMO_DATA), 'Smokey asked for Jet to cover as President (North) until 13/12/2026: Smokey overseas');
  assert.equal(
    requestLine(ask('ar-crank', { requestedBy: 'm-crank', why: 'Smokey can’t be reached' }), DEMO_DATA),
    'Crank asked for Jet to act as President (North) until 13/12/2026: Smokey can’t be reached',
  );
  assert.equal(
    requestLine(ask('ar-empty', { chapterId: 'ch-west', memberId: 'm-torque', covers: null, why: 'No President since the ACM', requestedBy: 'm-diesel' }), DEMO_DATA),
    'Diesel asked for Torque to act as President (West) until 13/12/2026: No President since the ACM',
  );
});

test('requestNext: Confirm cover for a third board member; nothing for the holder, the stand-in or anyone off the board', () => {
  const data = withRequests(smokeyAsks);
  assert.deepEqual(requestNext(smokeyAsks, crank, data, NOW), { kind: 'confirm', label: 'Confirm cover' });
  for (const m of [smokey, jet, spanner, rusty]) assert.equal(requestNext(smokeyAsks, m, data, NOW), null, m.roadName ?? m.id);
});

test('requestNext: a voted request starts its board vote, follows it, then Confirm acting once it carries', () => {
  const data = withRequests(dieselAsks);
  const start = requestNext(dieselAsks, diesel, data, NOW);
  assert.equal(start?.kind, 'start');
  assert.equal(start?.label, 'Start the board vote');
  assert.equal(requestNext(dieselAsks, torque, data, NOW), null, 'the stand-in doesn’t open it');
  const open = { ...data, votes: [...(DEMO_DATA.votes ?? []), actingVote('v-open', {})] };
  assert.deepEqual(requestNext(dieselAsks, sparks, open, NOW), { kind: 'see', label: 'See the board vote', voteId: 'v-open' });
  assert.equal(requestNext(dieselAsks, spanner, open, NOW), null, 'off the board: nothing to follow here');
  const carried = {
    ...data,
    votes: [...(DEMO_DATA.votes ?? []), actingVote('v-carried', {
      closedAt: `${addDays(STORY_TODAY, -1)}T08:00:00.000Z`, result: 'carried', votedIds: ['m-diesel', 'm-sparks', 'm-gravel'],
    })],
  };
  assert.deepEqual(requestNext(dieselAsks, diesel, carried, NOW), { kind: 'confirm', label: 'Confirm acting' });
  assert.equal(requestNext(dieselAsks, torque, carried, NOW)?.kind, 'see', 'the stand-in can’t confirm their own acting');
});

test('closeRequestNote: closing a request changes nothing about the seat, and stops an open vote on it seating anyone', () => {
  assert.equal(closeRequestNote(dieselAsks, withRequests(dieselAsks)), 'This closes the request. Nothing about the seat changes.');
  const voting = { ...withRequests(dieselAsks), votes: [...(DEMO_DATA.votes ?? []), actingVote('v-open', {})] };
  assert.equal(closeRequestNote(dieselAsks, voting), 'This closes the request, so the board’s open vote on it can’t seat anyone. Nothing about the seat changes.');
});

test('requestActions: Withdraw request for the holder and the requester (until a vote opens), Decline for the stand-in', () => {
  const agreed = withRequests(smokeyAsks);
  assert.deepEqual(requestActions(smokeyAsks, smokey, agreed, STORY_TODAY), ['Withdraw request']);
  assert.deepEqual(requestActions(smokeyAsks, jet, agreed, STORY_TODAY), ['Decline']);
  assert.deepEqual(requestActions(smokeyAsks, crank, agreed, STORY_TODAY), [], 'another board member');
  assert.deepEqual(requestActions(smokeyAsks, spanner, agreed, STORY_TODAY), []);
  const voted = withRequests(dieselAsks);
  assert.deepEqual(requestActions(dieselAsks, diesel, voted, STORY_TODAY), ['Withdraw request']);
  assert.deepEqual(requestActions(dieselAsks, rusty, voted, STORY_TODAY), ['Withdraw request'], 'the holder');
  assert.deepEqual(requestActions(dieselAsks, torque, voted, STORY_TODAY), ['Decline']);
  const open = { ...voted, votes: [...(DEMO_DATA.votes ?? []), actingVote('v-open', {})] };
  assert.deepEqual(requestActions(dieselAsks, diesel, open, STORY_TODAY), [], 'no one board member undoes a running vote (8.2)');
  assert.deepEqual(requestActions(dieselAsks, rusty, open, STORY_TODAY), ['Withdraw request']);
});

test('boardRequests: the open requests someone has a step on, and none once closed or lapsed', () => {
  const data = withRequests(smokeyAsks, dieselAsks);
  assert.deepEqual(boardRequests(crank, data, NOW).map((r) => r.id), ['ar-smokey']);
  assert.deepEqual(boardRequests(smokey, data, NOW).map((r) => r.id), ['ar-smokey']);
  assert.deepEqual(boardRequests(diesel, data, NOW).map((r) => r.id), ['ar-diesel']);
  assert.deepEqual(boardRequests(spanner, data, NOW), []);
  assert.deepEqual(boardRequests(ace, data, NOW), [], 'Ace isn’t on North’s board');
  // Seated on North's board, the Auditor still confirms no President cover (11.8); anyone else in that seat would.
  const secretary = (memberId: string): ClubData => ({
    ...data, positions: [...data.positions, { id: 'p-x-sec', memberId, chapterId: 'ch-north', role: 'secretary', startedOn: '2026-01-01', endedOn: null }],
  });
  assert.deepEqual(boardRequests(ace, secretary('m-ace'), NOW), [], 'the Auditor stays out');
  assert.ok(boardRequests(sparks, secretary('m-sparks'), NOW).some((r) => r.id === 'ar-smokey'), 'Sparks, in the same seat, confirms it');
  const closed = withRequests({ ...smokeyAsks, closedAt: NOW, outcome: 'withdrawn' });
  assert.deepEqual(boardRequests(crank, closed, NOW), []);
  const lapsed = withRequests({ ...smokeyAsks, until: addDays(STORY_TODAY, -1) });
  assert.deepEqual(boardRequests(crank, lapsed, NOW), [], 'a request past its until date has lapsed');
});

test('requestConfirmNote: what confirming does, then the warnings again', () => {
  const data = withRequests(smokeyAsks);
  const note = requestConfirmNote(smokeyAsks, data, STORY_TODAY);
  const warnings = actingWarnings(jet, 'ch-north', 'president', at(data, 'p-9'), '2026-12-13', data, STORY_TODAY, false);
  assert.ok(warnings.length > 0);
  assert.equal(note, ['Jet acts as President (North) for Smokey from today until 13/12/2026.', ...warnings].join('\n\n'));
});

/** North with Smokey's President seat empty: Jet, the sitting VP, casts North's NEC vote through the fallback. */
const northNoPresident: ClubData = {
  ...DEMO_DATA, positions: DEMO_DATA.positions.map((p) => (p.id === 'p-9' ? { ...p, endedOn: addDays(STORY_TODAY, -20) } : p)),
};

test('vpFallbackLine: the 11.2 line for the chapter’s board, with Make Jet Acting President where it can be recorded', () => {
  const text = 'Jet casts North’s NEC vote without being formally Acting President (11.2)';
  assert.deepEqual(vpFallbackLine('ch-north', crank, northNoPresident, STORY_TODAY), { text, button: 'Make Jet Acting President', memberId: 'm-jet' });
  assert.deepEqual(vpFallbackLine('ch-north', jet, northNoPresident, STORY_TODAY), { text, button: null, memberId: 'm-jet' }, 'nobody records themselves');
  assert.equal(vpFallbackLine('ch-north', spanner, northNoPresident, STORY_TODAY), null, 'only the chapter’s board sees it');
  assert.equal(vpFallbackLine('ch-north', rusty, northNoPresident, STORY_TODAY), null, 'nor another chapter’s board');
  assert.equal(vpFallbackLine('ch-north', crank, DEMO_DATA, STORY_TODAY), null, 'Smokey sits: no fallback');
  // The Auditor in a North board seat sees the line but doesn't record a President (11.8).
  const auditorOnBoard: ClubData = {
    ...northNoPresident,
    positions: [...northNoPresident.positions, { id: 'p-ace-sec', memberId: 'm-ace', chapterId: 'ch-north', role: 'secretary', startedOn: '2026-01-01', endedOn: null }],
  };
  assert.deepEqual(vpFallbackLine('ch-north', ace, auditorOnBoard, STORY_TODAY), { text, button: null, memberId: 'm-jet' });
  // Once Jet is Acting President, his President row casts the vote and the line goes.
  const recorded: ClubData = {
    ...northNoPresident,
    positions: [...northNoPresident.positions, {
      id: 'p-jet-pres', memberId: 'm-jet', chapterId: 'ch-north', role: 'president', startedOn: STORY_TODAY, endedOn: null,
      actingUntil: addDays(STORY_TODAY, 30), covers: null, actingWhy: 'No President since Smokey stood down', appointedBy: 'm-crank',
    }],
  };
  assert.equal(vpFallbackLine('ch-north', crank, recorded, STORY_TODAY), null);
});

test('stintLine: an empty seat’s next steps, a cover’s hand-back day', () => {
  const crankStint = at(DEMO_DATA, 'p-19');
  assert.equal(crankStint.actingUntil, addDays(STORY_TODAY, 28));
  assert.equal(
    stintLine(crankStint, DEMO_DATA),
    'Acting until 22/11/2026: hold the election at the ACM, change the date or let it end. If Crank stands, the VP or an elected person chairs that vote (9.9, 10.9).',
  );
  const cover = { ...jetCovers, actingUntil: '2026-12-13' };
  assert.equal(stintLine(cover, { ...DEMO_DATA, positions: [...DEMO_DATA.positions, cover] }), 'Smokey takes back the seat on 14/12/2026.');
  // A non-board role is the board's own appointment (9.2), so no ACM election.
  const tailGunner: Position = {
    id: 'p-gravel-tg', memberId: 'm-gravel', chapterId: 'ch-west', role: 'tail_gunner', startedOn: STORY_TODAY, endedOn: null,
    actingUntil: '2026-12-13', covers: null, actingWhy: 'Spanner’s knee', appointedBy: 'm-rusty',
  };
  assert.equal(stintLine(tailGunner, DEMO_DATA), 'Acting until 13/12/2026: appoint someone, change the date or let it end.');
});

test('stintTone: warning colour in the last 7 days', () => {
  const until = (days: number): Position => ({ ...at(DEMO_DATA, 'p-19'), actingUntil: addDays(STORY_TODAY, days) });
  assert.equal(stintTone(until(8), STORY_TODAY), null);
  assert.equal(stintTone(until(7), STORY_TODAY), 'warning', 'from the day the phone says it ends in a week');
  assert.equal(stintTone(until(1), STORY_TODAY), 'warning');
  assert.equal(stintTone(until(0), STORY_TODAY), 'warning', 'the last acting day');
  const term = DEMO_DATA.positions.find((p) => p.actingUntil == null && p.endedOn === null)!;
  assert.equal(stintTone(term, STORY_TODAY), null, 'a full term isn’t a stint');
});

test('Attendance and terms lists stints apart: open ones in scope, soonest until first', () => {
  assert.deepEqual(stintsDue(DEMO_DATA.positions, null).map((p) => p.id), ['p-19']);
  assert.deepEqual(stintsDue(DEMO_DATA.positions, 'ch-north').map((p) => p.id), ['p-19']);
  assert.deepEqual(stintsDue(DEMO_DATA.positions, 'ch-west'), []);
  const soon = { ...jetCovers, actingUntil: addDays(STORY_TODAY, 3) };
  assert.deepEqual(stintsDue([...DEMO_DATA.positions, soon], 'ch-north').map((p) => p.id), ['p-jet-covers', 'p-19']);
  const ended = { ...soon, endedOn: STORY_TODAY, endedReason: 'stepped_down' as const };
  assert.deepEqual(stintsDue([...DEMO_DATA.positions, ended], 'ch-north').map((p) => p.id), ['p-19'], 'an ended stint is gone');
});

test('scopeText: the club-wide first sentence stays; the second says whose board you sit on', () => {
  assert.equal(scopeText(rusty, DEMO_DATA), 'You sit on the NEC, so you see every chapter’s board records. You sit on West’s board.');
  const noSeat: ClubData = { ...DEMO_DATA, positions: DEMO_DATA.positions.map((p) => (p.id === 'p-1' ? { ...p, endedOn: addDays(STORY_TODAY, -1) } : p)) };
  assert.equal(scopeText(rusty, noSeat), 'You sit on the NEC, so you see every chapter’s board records. Each chapter’s board runs its own business.');
  // "Act" is a defined term now (Acting), so a board member's line says where they sit.
  assert.equal(scopeText(crank, DEMO_DATA), 'You sit on North’s board.');
  // Covering Smokey, Jet is on the NEC but sees North's board alone, so his line is one chapter's.
  const covered = { ...DEMO_DATA, positions: [...DEMO_DATA.positions, jetCovers] };
  assert.equal(scopeText(jet, covered), 'You sit on North’s board.');
});

// Jeff, 15 Nov: every red Needs-you row opens the place where it gets dealt with.
test('one member to see opens that member, at the part that needs fixing', () => {
  assert.deepEqual(needsYouTarget('alerts', ['m1']), { to: 'member', memberId: 'm1', focus: 'ride-ready' });
  // Two alerts for the same member (licence and rego) are still one member to see.
  assert.deepEqual(needsYouTarget('alerts', ['m1', 'm1']), { to: 'member', memberId: 'm1', focus: 'ride-ready' });
  assert.deepEqual(needsYouTarget('noContact', ['m2']), { to: 'member', memberId: 'm2', focus: 'contacts' });
});

test('one FNG review opens that FNG review', () => {
  assert.deepEqual(needsYouTarget('fngs', ['m3']), { to: 'fng', memberId: 'm3' });
});

test('several members open the list on the Board that names each of them', () => {
  assert.deepEqual(needsYouTarget('alerts', ['m1', 'm2']), { to: 'list', kind: 'alerts' });
  assert.deepEqual(needsYouTarget('noContact', ['m1', 'm2']), { to: 'list', kind: 'noContact' });
  assert.deepEqual(needsYouTarget('fngs', ['m1', 'm2']), { to: 'list', kind: 'fngs' });
});

test('approvals are decided on the Board itself, so they always open that list', () => {
  assert.deepEqual(needsYouTarget('pending', ['m1']), { to: 'list', kind: 'pending' });
  assert.deepEqual(needsYouTarget('pending', ['m1', 'm2']), { to: 'list', kind: 'pending' });
});
