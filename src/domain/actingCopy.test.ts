// Manage member › Positions for acting (docs/superpowers/specs/2026-11-15-acting-roles-design.md,
// "Screens"): the Acting / Full term pair, the seats offered, the Until and Why fields, what each
// acting seat lets the viewer do, the confirm text, and the route-3 steps on the away holder's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA, STORY_TODAY } from '../data/demoStory.testkit';
import { actingWarnings, necBallotsWait, SMALL_BOARD } from './access';
import { melbourneInstant } from './business';
import { addDays } from './dates';
import type { ActingRequest, ClubData, Member, Position, Vote } from './types';
import {
  actingSeatLabel,
  actingSeatOptions,
  APPOINT_KIND_LABEL,
  appointChoices,
  arrangeCover,
  backNote,
  boardVoteStep,
  confirmText,
  coverLine,
  doneMessage,
  endVoteBlock,
  pageRequests,
  replaceNote,
  stintNote,
  TERM_ACTION,
  termActionsFor,
  termLine,
  untilHint,
  WHY_HINT,
  whyLabel,
} from './actingCopy';

const today = STORY_TODAY; // 25/10/2026
const who = (data: ClubData, id: string): Member => {
  const m = data.members.find((x) => x.id === id);
  if (!m) throw new Error(`no member ${id}`);
  return m;
};
const row = (data: ClubData, id: string): Position => {
  const p = data.positions.find((x) => x.id === id);
  if (!p) throw new Error(`no position ${id}`);
  return p;
};
const d = DEMO_DATA;
const [smokey, jet, crank, rusty, spanner, ace, torque, diesel] = ['m-smokey', 'm-jet', 'm-crank', 'm-rusty', 'm-spanner', 'm-ace', 'm-torque', 'm-diesel'].map((id) => who(d, id));
/** The demo's stint: Crank, Acting Treasurer (North), from 27/09/2026 to 22/11/2026, recorded by Smokey. */
const crankActing = row(d, 'p-19');

/** Jet (North's VP) covers Smokey's President seat, recorded by Crank. */
const jetCovers: Position = {
  id: 'p-jet-covers', memberId: 'm-jet', chapterId: 'ch-north', role: 'president', startedOn: addDays(today, -10), endedOn: null,
  actingUntil: addDays(today, 20), covers: 'p-9', actingWhy: 'Smokey overseas', actingVote: null, actingRequestId: null,
  appointedBy: 'm-crank', endedReason: null,
};
const covered: ClubData = { ...d, positions: [...d.positions.filter((p) => p.id !== 'p-19'), jetCovers] };
/** West with its President seat empty (Rusty's row ended): no VP, so anyone as President needs a board vote. */
const westNoPresident: ClubData = { ...d, positions: d.positions.map((p) => (p.id === 'p-1' ? { ...p, endedOn: addDays(today, -20) } : p)) };

const vote = (id: string, over: Partial<Vote>): Vote => ({
  id, chapterId: 'ch-north', meetingId: null, subjectMemberId: null, subjectRole: null, question: 'A question', details: null,
  electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 2, openedAt: `${addDays(today, -6)}T00:00:00.000Z`,
  closesAt: `${addDays(today, 1)}T08:00:00.000Z`, closedAt: null, result: null, castingVote: null, tally: null,
  electorIds: ['m-smokey', 'm-jet'], votedIds: [], ballots: [], createdBy: 'm-smokey', actingRequestId: null, electorChapters: {}, ...over,
});
const request = (id: string, over: Partial<ActingRequest>): ActingRequest => ({
  id, chapterId: 'ch-west', role: 'president', memberId: 'm-torque', covers: 'p-1', until: addDays(today, 28), why: 'Rusty in hospital',
  requestedBy: 'm-diesel', createdAt: `${today}T00:00:00.000Z`, closedAt: null, outcome: null, ...over,
});

// --- The Appoint pair, the seats, and the fields ------------------------------------------------

test('appointChoices: Acting and Full term, with Acting the default for a board seat', () => {
  const both = appointChoices({ acting: ['secretary', 'tail_gunner'], full: ['secretary', 'tail_gunner'] });
  assert.deepEqual(both.options, [
    { value: 'acting', label: 'Acting' },
    { value: 'full', label: 'Full term (elected at a meeting)' },
  ]);
  assert.equal(both.initial, 'acting', 'an empty board seat is filled by acting until the ACM (9.8)');
  assert.equal(APPOINT_KIND_LABEL.full, 'Full term (elected at a meeting)');
  const club = appointChoices({ acting: ['tail_gunner'], full: ['tail_gunner'] });
  assert.equal(club.initial, 'full', 'a non-board role is the board’s appointment (9.2)');
  assert.deepEqual(appointChoices({ acting: [], full: ['tail_gunner'] }).options.map((o) => o.value), ['full']);
  assert.deepEqual(appointChoices({ acting: ['secretary'], full: [] }), { options: [{ value: 'acting', label: 'Acting' }], initial: 'acting' });
});

test('actingSeatLabel says when a seat needs a board vote', () => {
  assert.equal(actingSeatLabel('president', true), 'President (needs a board vote)');
  assert.equal(actingSeatLabel('treasurer', false), 'Treasurer');
});

test('actingSeatOptions lists the empty seats this person could act in, from the viewer’s standing', () => {
  const seats = actingSeatOptions(smokey, jet, d, today);
  const roles = seats.map((s) => s.role);
  assert.ok(roles.includes('secretary') && roles.includes('sergeant_at_arms'), 'North’s empty board seats');
  assert.ok(roles.includes('tail_gunner'), 'a non-board role takes acting beside its holders');
  assert.ok(!roles.includes('president'), 'Smokey holds it: arrange a cover instead');
  assert.ok(!roles.includes('treasurer'), 'Crank is already acting there');
  assert.ok(!roles.includes('vice_president'), 'Jet already holds it');
  assert.ok(!roles.includes('nec_secretary'), 'acting is for chapter roles');
  assert.ok(seats.every((s) => !s.needsVote && s.label === actingSeatLabel(s.role, false)));
  assert.deepEqual(actingSeatOptions(jet, jet, d, today), [], 'nobody records themselves');
  assert.deepEqual(actingSeatOptions(spanner, jet, d, today), [], 'only North’s board records acting there');
  // West has no President and no VP, so Diesel as Acting President goes to a board vote (route 3).
  const west = actingSeatOptions(torque, diesel, westNoPresident, today);
  assert.deepEqual(west.find((s) => s.role === 'president'), { role: 'president', needsVote: true, label: 'President (needs a board vote)' });
});

test('whyLabel asks why not the VP when someone else would act as President', () => {
  assert.equal(whyLabel(crank, 'ch-north', 'president', d), 'Why not Jet (VP)?');
  assert.equal(whyLabel(jet, 'ch-north', 'president', d), 'Why');
  assert.equal(whyLabel(jet, 'ch-north', 'secretary', d), 'Why');
  assert.equal(whyLabel(diesel, 'ch-west', 'president', westNoPresident), 'Why', 'West has no VP');
});

test('the Until and Why hints', () => {
  assert.equal(untilHint('2026-12-13'), 'Last acting day. Up to 13/12/2026.');
  // The button stays off until a Why is typed, and the red line waits for typing, so the hint says it's needed.
  assert.equal(WHY_HINT, 'Required. Every member can read this. Keep health details out.');
});

test('replaceNote: seating the acting person in full ends their acting', () => {
  assert.equal(replaceNote(crank, 'ch-north', 'treasurer', d), 'This ends Crank’s acting.');
  assert.equal(replaceNote(jet, 'ch-north', 'treasurer', d), null, 'Jet isn’t acting there');
  assert.equal(replaceNote(crank, 'ch-north', 'road_captain', d), null, 'his Road Captain seat is a full term');
  assert.equal(replaceNote(jet, 'ch-north', 'president', covered), null, 'a cover isn’t ended by a full appointment');
});

test('doneMessage names the acting title and the until date', () => {
  assert.equal(doneMessage(crank, 'treasurer', '2026-12-13'), 'Crank is Acting Treasurer until 13/12/2026.');
});

// --- An acting seat on the Positions card -------------------------------------------------------

test('termLine: an acting seat shows Acting until, a full term its end', () => {
  assert.deepEqual(termLine(crankActing, today), { label: 'Acting until', value: '22/11/2026' });
  assert.equal(termLine(row(d, 'p-11'), today)?.label, 'Term');
  assert.ok(termLine(row(d, 'p-11'), today)?.value.startsWith('Ends '));
  assert.equal(termLine(row(d, 'p-13'), today), null, 'Founder has no term');
});

test('stintNote and coverLine say why, and who covers whom', () => {
  assert.equal(stintNote(crankActing, d), 'Why: No Treasurer since the ACM');
  assert.equal(stintNote(jetCovers, covered), 'For Smokey: Smokey overseas');
  assert.equal(stintNote(row(d, 'p-11'), d), null);
  assert.equal(coverLine(row(covered, 'p-9'), covered), `Jet covers this seat until ${'14/11/2026'}.`);
  assert.equal(coverLine(row(d, 'p-9'), d), null);
});

// That an acting seat never offers "Start removal vote" is the Positions card's branch to
// ActingActions, pinned in src/screens/actingPositions.test.ts.
test('termActionsFor: the acting person and another board member', () => {
  const { changeDate, stepDown, startEndVote } = TERM_ACTION;
  assert.deepEqual(termActionsFor(crankActing, crank, d, today), [changeDate, stepDown]);
  assert.deepEqual(termActionsFor(crankActing, jet, d, today), [changeDate, startEndVote]);
  assert.deepEqual(termActionsFor(crankActing, smokey, d, today), [changeDate, startEndVote]);
  assert.deepEqual(termActionsFor(crankActing, spanner, d, today), [], 'off North’s board');
  assert.deepEqual(termActionsFor(crankActing, rusty, d, today), [], 'NEC officers have no part');
  assert.deepEqual(termActionsFor(crankActing, ace, d, today), [], 'North’s Officer and the Auditor: not on the board');
  assert.deepEqual(termActionsFor(row(d, 'p-11'), jet, d, today), [], 'a full term keeps its own buttons');
});

test('termActionsFor: the covered holder takes the seat back, and moves the date', () => {
  const { changeDate, stepDown, startEndVote, back } = TERM_ACTION;
  assert.equal(back, 'I’m back');
  // The holder can bring an agreed cover forward or keep it going ("still away"), so Change date shows too.
  assert.deepEqual(termActionsFor(jetCovers, smokey, covered, today), [changeDate, back]);
  assert.deepEqual(termActionsFor(jetCovers, jet, covered, today), [changeDate, stepDown]);
  assert.deepEqual(termActionsFor(jetCovers, crank, covered, today), [startEndVote], 'only Smokey moves an agreed cover’s date');
});

test('termActionsFor follows the vote to end acting: see it while open, end it once carried', () => {
  const { changeDate, seeEndVote, endActing } = TERM_ACTION;
  const end = (over: Partial<Vote>) => vote('v-end', {
    subjectMemberId: 'm-crank', subjectRole: 'treasurer', electorIds: ['m-smokey', 'm-jet'], ...over,
  });
  const open = { ...d, votes: [...(d.votes ?? []), end({})] };
  assert.deepEqual(termActionsFor(crankActing, jet, open, today), [changeDate, seeEndVote]);
  const carried = { ...d, votes: [...(d.votes ?? []), end({ closedAt: `${addDays(today, -1)}T08:00:00.000Z`, result: 'carried', votedIds: ['m-smokey', 'm-jet'] })] };
  assert.deepEqual(termActionsFor(crankActing, jet, carried, today), [changeDate, endActing]);
});

test('endVoteBlock: a board too small to vote on ending acting says so instead of offering the vote (8.6)', () => {
  // North is three: without Crank, Smokey and Jet are two.
  assert.equal(endVoteBlock(crankActing, d, today), SMALL_BOARD);
  // West is five: Chook acting as VP leaves all five to vote.
  const chookActs: Position = { ...crankActing, id: 'p-chook-vp', memberId: 'm-chook', chapterId: 'ch-west', role: 'vice_president', appointedBy: 'm-rusty' };
  const west = { ...d, positions: [...d.positions, chookActs] };
  assert.equal(endVoteBlock(chookActs, west, today), null);
});

test('backNote: what I’m back ends, naming the stand-in', () => {
  assert.equal(backNote(jetCovers, covered), 'Jet’s acting ends today, and the seat’s duties come back to you.');
  const gone = { ...covered, members: covered.members.filter((m) => m.id !== 'm-jet') };
  assert.equal(backNote(jetCovers, gone), 'The acting ends today, and the seat’s duties come back to you.');
});

test('termActionsFor: on the last day the acting person can only step down', () => {
  const lastDay = { ...crankActing, actingUntil: today };
  const data = { ...d, positions: d.positions.map((p) => (p.id === 'p-19' ? lastDay : p)) };
  assert.deepEqual(termActionsFor(lastDay, crank, data, today), [TERM_ACTION.stepDown]);
});

// --- The confirm text repeats the warnings ------------------------------------------------------

test('confirmText repeats actingWarnings on Appoint', () => {
  const until = addDays(today, 28);
  const text = confirmText({ route: 'record', target: jet, chapterId: 'ch-north', role: 'secretary', until }, d, today);
  const warnings = actingWarnings(jet, 'ch-north', 'secretary', null, until, d, today);
  assert.ok(warnings.length >= 2, 'family (9.6) and combined duties (9.5) at least');
  assert.ok(text.startsWith('Jet acts as Secretary (North) from today until 22/11/2026.'), text);
  for (const w of warnings) assert.ok(text.includes(w), `repeats: ${w}`);
});

test('confirmText repeats actingWarnings on Arrange cover (board vote), as a voted cover', () => {
  const until = addDays(today, 20);
  // An open NEC vote whose North ballot Smokey hasn't cast: a voted President cover leaves it waiting.
  const nec = vote('v-nec', { chapterId: null, electorate: 'nec', electorIds: ['m-smokey', 'm-rusty'], electorChapters: { 'm-smokey': 'ch-north', 'm-rusty': 'ch-west' } });
  const data = { ...d, votes: [...(d.votes ?? []), nec] };
  const seat = row(data, 'p-9');
  const text = confirmText({ route: 'propose', target: jet, chapterId: 'ch-north', role: 'president', covers: seat, until }, data, today);
  assert.ok(text.startsWith('Nothing changes until North’s board votes yes and a board member confirms it.'), text);
  for (const w of actingWarnings(jet, 'ch-north', 'president', seat, until, data, today, true)) assert.ok(text.includes(w), `repeats: ${w}`);
  assert.ok(text.includes(necBallotsWait('North', 1)), 'Jet is the sitting VP, but a cover Crank asks for is voted');
});

// --- Arrange cover (board vote), then the board vote, on the away holder's page ------------------

test('arrangeCover lists the board members who could cover, labelled by their seat', () => {
  const rustyPresident = row(d, 'p-1');
  const west = arrangeCover(diesel, rustyPresident, d, today);
  assert.ok(west);
  assert.equal(west.blocked, null);
  // Torque and Gravel could; Sparks keeps West's books (9.5); Diesel doesn't propose himself.
  assert.deepEqual(west.standIns, [
    { value: 'm-torque', label: 'Torque (SEC)' },
    { value: 'm-gravel', label: 'Gravel (SAA)' },
  ]);
  assert.equal(arrangeCover(rusty, rustyPresident, d, today), null, 'the holder arranges their own cover from Me');
  assert.equal(arrangeCover(spanner, rustyPresident, d, today), null, 'only West’s board proposes acting');
  assert.equal(arrangeCover(diesel, row(d, 'p-7'), d, today), null, 'only board seats are covered');
  assert.equal(arrangeCover(crank, row(covered, 'p-9'), covered, today), null, 'Smokey’s seat is covered already');
  // North’s board is three: without the stand-in and the holder there aren’t three left to vote (8.6).
  assert.deepEqual(arrangeCover(crank, row(d, 'p-9'), d, today), { standIns: [], blocked: SMALL_BOARD });
});

test('the away holder’s page lists open requests about them, then the board vote’s next step', () => {
  const asked = request('ar-torque', {});
  const data = { ...d, actingRequests: [asked] };
  assert.deepEqual(pageRequests(rusty, data).map((r) => r.id), ['ar-torque'], 'the holder’s seat');
  assert.deepEqual(pageRequests(torque, data).map((r) => r.id), ['ar-torque'], 'the stand-in');
  assert.deepEqual(pageRequests(diesel, data), []);
  const now = `${today}T01:00:00.000Z`;
  const closesAt = melbourneInstant(addDays(today, 7), '19:00')!;
  assert.deepEqual(boardVoteStep(diesel, asked, data, now), {
    kind: 'start', quorum: 3, closesAt, note: 'It closes on 01/11/2026 at 7:00 pm, and needs 3 of its 3 voters.', last: null,
  });
  assert.equal(boardVoteStep(torque, asked, data, now), null, 'the stand-in doesn’t open it');
  const opened = { ...data, votes: [...(d.votes ?? []), vote('v-acting', { chapterId: 'ch-west', actingRequestId: 'ar-torque' })] };
  assert.deepEqual(boardVoteStep(torque, asked, opened, now), { kind: 'see', voteId: 'v-acting' }, 'anyone on the page can follow it');
  const closed = { ...data, actingRequests: [{ ...asked, closedAt: now, outcome: 'withdrawn' as const }] };
  assert.deepEqual(pageRequests(rusty, closed), []);
});

test('boardVoteStep: a vote without quorum leaves the request open for another vote', () => {
  const asked = request('ar-torque', {});
  const now = `${today}T01:00:00.000Z`;
  const closesAt = melbourneInstant(addDays(today, 7), '19:00')!;
  const closed = (over: Partial<Vote>) => vote('v-closed', {
    chapterId: 'ch-west', actingRequestId: 'ar-torque', closedAt: `${addDays(today, -1)}T08:00:00.000Z`, ...over,
  });
  // A vote set up to fail can't sink the request (spec, "Requests"): Diesel can start the next one.
  const noQuorum = { ...d, actingRequests: [asked], votes: [...(d.votes ?? []), closed({ result: 'no_quorum' })] };
  assert.deepEqual(boardVoteStep(diesel, asked, noQuorum, now), {
    kind: 'start', quorum: 3, closesAt, note: 'It closes on 01/11/2026 at 7:00 pm, and needs 3 of its 3 voters.',
    last: 'Board vote closed 24/10/2026: No quorum.',
  });
  // An open one after it is the one to follow.
  const reopened = { ...noQuorum, votes: [...noQuorum.votes, vote('v-again', { chapterId: 'ch-west', actingRequestId: 'ar-torque' })] };
  assert.deepEqual(boardVoteStep(diesel, asked, reopened, now), { kind: 'see', voteId: 'v-again' });
  // A carried one, in the last 90 days, is followed to its confirm.
  const carried = { ...d, actingRequests: [asked], votes: [...(d.votes ?? []), closed({ result: 'carried', votedIds: ['m-diesel', 'm-gravel', 'm-sparks'] })] };
  assert.deepEqual(boardVoteStep(diesel, asked, carried, now), { kind: 'see', voteId: 'v-closed' });
});
