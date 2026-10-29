import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import {
  ALREADY_INVITED,
  BAD_ANSWER,
  BAD_BIKES,
  BAD_EVENT_DATE,
  CLUB_EXISTS,
  CLUB_GONE,
  CLUB_NO_NAME,
  CLUB_OFF,
  CLUB_OFF_ALREADY,
  EVENT_NO_TITLE,
  EVENT_PASSED,
  INVITE_GONE,
  INVITE_OFF,
  INVITE_OFF_ALREADY,
  NO_CALENDAR_LABEL,
  NOT_CLUB_EDITOR,
  NOT_INVITE_EDITOR,
  NOT_INVITE_MANAGER,
  NOT_OUR_RIDE,
  NOT_RIDE_INVITER,
  RIDE_CANCELLED,
  RIDE_GONE,
  RIDE_OTHER_DAY,
  RIDE_PASSED,
  RIDE_TAKEN,
  RIDE_WRONG_LABEL,
  answerProblem,
  archiveClubProblem,
  archiveInviteProblem,
  calendarState,
  canAnswer,
  cleanClub,
  clubProblem,
  inviteInProblem,
  inviteOutProblem,
  invitationText,
  invitesIn,
  invitesOutByRide,
  invitesForRide,
  replyText,
  waitingCount,
  type ClubInvite,
  type OtherClub,
} from './invites';
import type { ClubData, Member } from './types';

const TODAY = '2026-10-29';
const data: ClubData = DEMO_DATA;
const who = (id: string): Member => data.members.find((m) => m.id === id) as Member;
const rusty = who('m-rusty'); // West President, NEC
const diesel = who('m-diesel'); // West Road Captain
const spanner = who('m-spanner'); // West Tail Gunner: no say over invites
const crank = who('m-crank'); // North Road Captain
const pending: Member = { ...spanner, id: 'm-new', approval: 'pending' };

const clubs: OtherClub[] = [
  { id: 'oc-1', name: 'Dodgy Brothers MC', town: 'Geelong', contact: 'Smithy 0400 000 000', note: null, addedBy: 'm-spanner',
    addedAt: '2026-10-01T00:00:00.000Z', archivedAt: null },
  { id: 'oc-2', name: 'Old Gold Riders', town: null, contact: null, note: null, addedBy: 'm-rusty',
    addedAt: '2026-10-01T00:00:00.000Z', archivedAt: '2026-10-02T00:00:00.000Z' },
];

const invite = (i: Partial<ClubInvite> & Pick<ClubInvite, 'id'>): ClubInvite => ({
  direction: 'in', clubId: 'oc-1', chapterId: 'ch-west', rideId: null, title: 'Toy Run', eventOn: '2026-11-29', place: 'Werribee',
  details: null, answer: 'waiting', calendarLabel: null, bikes: null, note: null, addedBy: 'm-spanner',
  addedAt: '2026-10-20T00:00:00.000Z', answeredBy: null, answeredAt: null, archivedAt: null, ...i,
});

const invites: ClubInvite[] = [
  invite({ id: 'in-waiting' }),
  invite({ id: 'in-yes', answer: 'yes', calendarLabel: 'non_nuts', answeredBy: 'm-rusty', answeredAt: '2026-10-21T00:00:00.000Z' }),
  invite({ id: 'in-north', chapterId: 'ch-north', addedBy: 'm-crank' }),
  invite({ id: 'in-club', chapterId: null }),
  invite({ id: 'in-off', archivedAt: '2026-10-22T00:00:00.000Z' }),
  invite({ id: 'out-xmas', direction: 'out', rideId: 'r-4', chapterId: null, title: null, eventOn: null, place: null, addedBy: 'm-rusty' }),
];

const inInput = (o: Partial<Parameters<typeof inviteInProblem>[1]> = {}) => ({
  id: null, clubId: 'oc-1', chapterId: 'ch-west' as string | null, title: 'Toy Run', eventOn: '2026-11-29', place: '', details: '',
  rideId: null as string | null, ...o,
});

// ---------------------------------------------------------------------------------------------
// Clubs

test('any approved member adds a club; names are trimmed and must be new', () => {
  const add = { id: null, name: '  Hume Hwy Cruisers ', town: '', contact: '', note: '' };
  assert.equal(clubProblem(spanner, add, clubs, data), null);
  assert.deepEqual(cleanClub(add), { name: 'Hume Hwy Cruisers', town: null, contact: null, note: null });
  assert.equal(clubProblem(null, add, clubs, data), 'Sign in first.');
  assert.equal(clubProblem(pending, add, clubs, data), 'Only approved members can do that.');
  assert.equal(clubProblem(spanner, { ...add, name: '  ' }, clubs, data), CLUB_NO_NAME);
  assert.equal(clubProblem(spanner, { ...add, name: 'dodgy brothers mc ' }, clubs, data), CLUB_EXISTS);
  // A club taken off the list doesn't block its name coming back.
  assert.equal(clubProblem(spanner, { ...add, name: 'Old Gold Riders' }, clubs, data), null);
  assert.equal(clubProblem(spanner, { ...add, name: 'x'.repeat(81) }, clubs, data), 'Keep the name to 80 characters at most.');
  assert.equal(clubProblem(spanner, { ...add, town: 'x'.repeat(61) }, clubs, data), 'Keep the town to 60 characters at most.');
  assert.equal(clubProblem(spanner, { ...add, contact: 'x'.repeat(201) }, clubs, data), 'Keep how to reach them to 200 characters at most.');
  assert.equal(clubProblem(spanner, { ...add, note: 'x'.repeat(301) }, clubs, data), 'Keep the note to 300 characters at most.');
});

test('a club is changed by whoever added it or a ride manager', () => {
  const change = { id: 'oc-1', name: 'Dodgy Brothers MC', town: 'Geelong', contact: '', note: 'Good blokes' };
  assert.equal(clubProblem(spanner, change, clubs, data), null, 'who added it');
  assert.equal(clubProblem(crank, change, clubs, data), null, 'a road captain');
  assert.equal(clubProblem(who('m-throttle'), change, clubs, data), NOT_CLUB_EDITOR);
  assert.equal(clubProblem(rusty, { ...change, id: 'oc-x' }, clubs, data), CLUB_GONE);
  assert.equal(clubProblem(rusty, { ...change, id: 'oc-2', name: 'Old Gold Riders' }, clubs, data), CLUB_OFF);
  // Keeping its own name isn't a clash with itself.
  assert.equal(clubProblem(rusty, { ...change, name: 'DODGY BROTHERS MC' }, clubs, data), null);
});

test('taking a club off', () => {
  assert.equal(archiveClubProblem(diesel, 'oc-1', clubs, data), null);
  assert.equal(archiveClubProblem(who('m-throttle'), 'oc-1', clubs, data), NOT_CLUB_EDITOR);
  assert.equal(archiveClubProblem(rusty, 'oc-x', clubs, data), CLUB_GONE);
  assert.equal(archiveClubProblem(rusty, 'oc-2', clubs, data), CLUB_OFF_ALREADY);
});

// ---------------------------------------------------------------------------------------------
// Invites in

test('any approved member passes on an invite', () => {
  assert.equal(inviteInProblem(spanner, inInput(), clubs, invites, data, TODAY), null);
  assert.equal(inviteInProblem(spanner, inInput({ chapterId: null }), clubs, invites, data, TODAY), null, 'for the whole club');
  assert.equal(inviteInProblem(null, inInput(), clubs, invites, data, TODAY), 'Sign in first.');
  assert.equal(inviteInProblem(pending, inInput(), clubs, invites, data, TODAY), 'Only approved members can do that.');
  assert.equal(inviteInProblem(spanner, inInput({ clubId: 'oc-x' }), clubs, invites, data, TODAY), CLUB_GONE);
  assert.equal(inviteInProblem(spanner, inInput({ clubId: 'oc-2' }), clubs, invites, data, TODAY), CLUB_OFF);
  assert.equal(inviteInProblem(spanner, inInput({ chapterId: 'ch-x' }), clubs, invites, data, TODAY), 'No such chapter.');
  assert.equal(inviteInProblem(spanner, inInput({ title: ' ' }), clubs, invites, data, TODAY), EVENT_NO_TITLE);
  assert.equal(inviteInProblem(spanner, inInput({ title: 'x'.repeat(81) }), clubs, invites, data, TODAY), 'Keep the name to 80 characters at most.');
  assert.equal(inviteInProblem(spanner, inInput({ eventOn: '2026-02-30' }), clubs, invites, data, TODAY), BAD_EVENT_DATE);
  assert.equal(inviteInProblem(spanner, inInput({ eventOn: '' }), clubs, invites, data, TODAY), BAD_EVENT_DATE);
  assert.equal(inviteInProblem(spanner, inInput({ eventOn: '2026-10-28' }), clubs, invites, data, TODAY), EVENT_PASSED);
  assert.equal(inviteInProblem(spanner, inInput({ eventOn: TODAY }), clubs, invites, data, TODAY), null, 'today is fine');
  assert.equal(inviteInProblem(spanner, inInput({ place: 'x'.repeat(121) }), clubs, invites, data, TODAY), 'Keep the place to 120 characters at most.');
  assert.equal(inviteInProblem(spanner, inInput({ details: 'x'.repeat(1001) }), clubs, invites, data, TODAY), 'Keep the details to 1,000 characters at most.');
});

test('an incoming invite links to a Supported or Non-Nuts ride on its day', () => {
  // r-3 is the demo Toy Run (Non-Nuts), 29/11/2026 in Melbourne; r-6 is supported, 17/01/2027.
  assert.equal(inviteInProblem(diesel, inInput({ rideId: 'r-3' }), clubs, invites, data, TODAY), null);
  assert.equal(inviteInProblem(diesel, inInput({ rideId: 'r-x' }), clubs, invites, data, TODAY), RIDE_GONE);
  assert.equal(inviteInProblem(diesel, inInput({ rideId: 'r-1' }), clubs, invites, data, TODAY), RIDE_WRONG_LABEL);
  assert.equal(inviteInProblem(diesel, inInput({ rideId: 'r-6' }), clubs, invites, data, TODAY), RIDE_OTHER_DAY);
  const cancelled = { ...data, rides: data.rides.map((r) => (r.id === 'r-3' ? { ...r, cancelledAt: '2026-10-01T00:00:00.000Z' } : r)) };
  assert.equal(inviteInProblem(diesel, inInput({ rideId: 'r-3' }), clubs, invites, cancelled, TODAY), RIDE_CANCELLED);
});

test('changing an incoming invite: its managers, or whoever passed it on while it waits', () => {
  assert.equal(inviteInProblem(spanner, inInput({ id: 'in-waiting' }), clubs, invites, data, TODAY), null, 'passed it on');
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-waiting' }), clubs, invites, data, TODAY), null, 'West road captain');
  assert.equal(inviteInProblem(crank, inInput({ id: 'in-waiting' }), clubs, invites, data, TODAY), NOT_INVITE_EDITOR, 'North RC on a West invite');
  assert.equal(inviteInProblem(spanner, inInput({ id: 'in-yes' }), clubs, invites, data, TODAY), NOT_INVITE_EDITOR, 'answered now');
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-yes' }), clubs, invites, data, TODAY), null);
  assert.equal(inviteInProblem(crank, inInput({ id: 'in-club', chapterId: null }), clubs, invites, data, TODAY), null, 'whole club: any RC');
  assert.equal(inviteInProblem(rusty, inInput({ id: 'in-x' }), clubs, invites, data, TODAY), INVITE_GONE);
  assert.equal(inviteInProblem(rusty, inInput({ id: 'in-off' }), clubs, invites, data, TODAY), INVITE_OFF);
  assert.equal(inviteInProblem(rusty, inInput({ id: 'out-xmas' }), clubs, invites, data, TODAY), INVITE_GONE, 'not an incoming one');
  // Moving it to another chapter needs a say over that chapter too.
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-waiting', chapterId: 'ch-north' }), clubs, invites, data, TODAY), NOT_INVITE_EDITOR);
  // A date that has passed may stay as it was.
  const old = [...invites, invite({ id: 'in-old', eventOn: '2026-10-01' })];
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-old', eventOn: '2026-10-01' }), clubs, old, data, TODAY), null);
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-old', eventOn: '2026-10-02' }), clubs, old, data, TODAY), EVENT_PASSED);
});

// ---------------------------------------------------------------------------------------------
// Invites out

test('the ride’s managers invite another club to one of the club’s own rides', () => {
  const out = (o: Partial<Parameters<typeof inviteOutProblem>[1]> = {}) => ({ rideId: 'r-1', clubId: 'oc-1', note: '', ...o });
  assert.equal(inviteOutProblem(diesel, out(), clubs, invites, data, TODAY), null, 'West RC, West ride');
  assert.equal(inviteOutProblem(crank, out({ rideId: 'r-4', clubId: 'oc-1' }), clubs, [], data, TODAY), null, 'any RC, club ride');
  assert.equal(inviteOutProblem(null, out(), clubs, invites, data, TODAY), 'Sign in first.');
  assert.equal(inviteOutProblem(diesel, out({ rideId: 'r-x' }), clubs, invites, data, TODAY), RIDE_GONE);
  assert.equal(inviteOutProblem(diesel, out({ rideId: 'r-3' }), clubs, invites, data, TODAY), NOT_OUR_RIDE);
  assert.equal(inviteOutProblem(diesel, out({ rideId: 'r-5' }), clubs, invites, data, TODAY), RIDE_CANCELLED);
  assert.equal(inviteOutProblem(diesel, out(), clubs, invites, data, '2026-11-09'), RIDE_PASSED);
  assert.equal(inviteOutProblem(spanner, out(), clubs, invites, data, TODAY), NOT_RIDE_INVITER);
  assert.equal(inviteOutProblem(crank, out(), clubs, invites, data, TODAY), NOT_RIDE_INVITER, 'North RC, West ride');
  assert.equal(inviteOutProblem(diesel, out({ clubId: 'oc-x' }), clubs, invites, data, TODAY), CLUB_GONE);
  assert.equal(inviteOutProblem(diesel, out({ clubId: 'oc-2' }), clubs, invites, data, TODAY), CLUB_OFF);
  assert.equal(inviteOutProblem(rusty, out({ rideId: 'r-4' }), clubs, invites, data, TODAY), ALREADY_INVITED);
  assert.equal(inviteOutProblem(diesel, out({ note: 'x'.repeat(301) }), clubs, invites, data, TODAY), 'Keep the note to 300 characters at most.');
  // Once that invite is taken off, the club can be asked again.
  const off = invites.map((i) => (i.id === 'out-xmas' ? { ...i, archivedAt: '2026-10-25T00:00:00.000Z' } : i));
  assert.equal(inviteOutProblem(rusty, out({ rideId: 'r-4' }), clubs, off, data, TODAY), null);
});

// ---------------------------------------------------------------------------------------------
// Answers and taking off

test('answering for the club', () => {
  const a = (o: Partial<Parameters<typeof answerProblem>[1]> = {}) => ({ id: 'in-waiting', answer: 'yes', label: 'supported', bikes: null, note: '', ...o });
  assert.equal(answerProblem(diesel, a(), invites, data), null);
  assert.equal(answerProblem(spanner, a(), invites, data), NOT_INVITE_MANAGER, 'passing it on isn’t answering it');
  assert.equal(answerProblem(crank, a(), invites, data), NOT_INVITE_MANAGER);
  assert.equal(answerProblem(diesel, a({ id: 'in-x' }), invites, data), INVITE_GONE);
  assert.equal(answerProblem(diesel, a({ id: 'in-off' }), invites, data), INVITE_OFF);
  assert.equal(answerProblem(diesel, a({ answer: 'maybe' }), invites, data), BAD_ANSWER);
  assert.equal(answerProblem(diesel, a({ label: null }), invites, data), NO_CALENDAR_LABEL);
  assert.equal(answerProblem(diesel, a({ label: 'west' }), invites, data), NO_CALENDAR_LABEL);
  assert.equal(answerProblem(diesel, a({ answer: 'no', label: null }), invites, data), null, 'no label on a no');
  assert.equal(answerProblem(diesel, a({ answer: 'waiting', label: null }), invites, data), null, 'back to waiting');
  assert.equal(answerProblem(diesel, a({ note: 'x'.repeat(301) }), invites, data), 'Keep the note to 300 characters at most.');
  // Outgoing: the ride's managers record the other club's reply.
  assert.equal(answerProblem(crank, a({ id: 'out-xmas', label: null, bikes: 12 }), invites, data), null);
  assert.equal(answerProblem(crank, a({ id: 'out-xmas', label: null, bikes: 0 }), invites, data), BAD_BIKES);
  assert.equal(answerProblem(crank, a({ id: 'out-xmas', label: null, bikes: 501 }), invites, data), BAD_BIKES);
  assert.equal(answerProblem(crank, a({ id: 'out-xmas', label: null, bikes: 2.5 }), invites, data), BAD_BIKES);
  assert.equal(answerProblem(spanner, a({ id: 'out-xmas', label: null }), invites, data), NOT_INVITE_MANAGER);
  assert.equal(canAnswer(diesel, invites[0], data), true);
  assert.equal(canAnswer(spanner, invites[0], data), false);
});

test('taking an invite off', () => {
  assert.equal(archiveInviteProblem(spanner, 'in-waiting', invites, data), null, 'passed it on, still waiting');
  assert.equal(archiveInviteProblem(spanner, 'in-yes', invites, data), NOT_INVITE_EDITOR);
  assert.equal(archiveInviteProblem(diesel, 'in-yes', invites, data), null);
  assert.equal(archiveInviteProblem(spanner, 'out-xmas', invites, data), NOT_INVITE_EDITOR);
  assert.equal(archiveInviteProblem(rusty, 'in-x', invites, data), INVITE_GONE);
  assert.equal(archiveInviteProblem(rusty, 'in-off', invites, data), INVITE_OFF_ALREADY);
});

// ---------------------------------------------------------------------------------------------
// The calendar and the lists

test('an accepted invite waits for its event on the club calendar, with rides to link', () => {
  const yes = invites.find((i) => i.id === 'in-yes') as ClubInvite;
  const state = calendarState(yes, invites, data.rides);
  assert.equal(state.kind, 'add');
  assert.equal(state.kind === 'add' && state.label, 'Non-Nuts Events');
  assert.deepEqual(state.kind === 'add' && state.suggestions.map((r) => r.id), ['r-3']);
  // Once one invite holds that ride, another isn't offered it.
  const linked = invites.map((i) => (i.id === 'in-yes' ? { ...i, rideId: 'r-3' } : i));
  const s2 = calendarState({ ...yes, id: 'in-yes-2' }, linked, data.rides);
  assert.deepEqual(s2.kind === 'add' && s2.suggestions, []);
  assert.deepEqual(calendarState({ ...yes, rideId: 'r-3' }, linked, data.rides), { kind: 'linked', rideId: 'r-3' });
  assert.equal(calendarState(invites[0], invites, data.rides).kind, 'none', 'waiting: nothing yet');
});

test('the lists: incoming by date (waiting first), outgoing by ride, and what a manager has to answer', () => {
  const list = invitesIn(invites, TODAY);
  assert.deepEqual(list.upcoming.map((i) => i.id), ['in-waiting', 'in-north', 'in-club', 'in-yes']);
  assert.deepEqual(list.earlier, []);
  const byRide = invitesOutByRide(invites, data.rides, TODAY);
  assert.deepEqual(byRide.map((g) => [g.ride.id, g.invites.map((i) => i.id)]), [['r-4', ['out-xmas']]]);
  assert.equal(waitingCount(diesel, invites, data, TODAY), 2, 'West waiting + whole club');
  assert.equal(waitingCount(crank, invites, data, TODAY), 2, 'North + whole club');
  assert.equal(waitingCount(spanner, invites, data, TODAY), 0);
  assert.deepEqual(invitesForRide('r-4', invites).map((i) => i.id), ['out-xmas']);
});

test('share texts never mention the app', () => {
  const ride = data.rides.find((r) => r.id === 'r-1')!;
  const text = invitationText(ride, clubs[0], data.chapters);
  assert.equal(
    text,
    'G’day Dodgy Brothers MC. Rustnuts SMC West would love you to join us for West breakfast run, Sun 08/11/2026 8:30 am, ' +
      'Caltex Laverton North. Let us know if you’re coming and roughly how many bikes. Cheers, Rustnuts SMC.',
  );
  const club = data.rides.find((r) => r.id === 'r-4')!;
  assert.match(invitationText(club, clubs[0], data.chapters), /^G’day Dodgy Brothers MC\. Rustnuts SMC would love you/);
  const yes = invites.find((i) => i.id === 'in-yes')!;
  assert.equal(
    replyText(yes, clubs[0], data.chapters),
    'G’day Dodgy Brothers MC, thanks for the invite to Toy Run on Sun 29/11/2026. Rustnuts SMC West will be there. See you on the day.',
  );
  assert.equal(
    replyText({ ...yes, answer: 'no' }, clubs[0], data.chapters),
    'G’day Dodgy Brothers MC, thanks for the invite to Toy Run on Sun 29/11/2026. Rustnuts SMC West can’t make this one, but we hope it’s a ripper.',
  );
  assert.equal(
    replyText({ ...yes, answer: 'waiting', chapterId: null }, clubs[0], data.chapters),
    'G’day Dodgy Brothers MC, thanks for the invite to Toy Run on Sun 29/11/2026. We’ll let you know soon. Rustnuts SMC.',
  );
  for (const t of [text, replyText(yes, clubs[0], data.chapters)]) assert.doesNotMatch(t, /app/i);
});

test('review fixes: a missing adder gives nobody rights, an archived club and a past linked ride keep their invites', () => {
  const orphanClub: OtherClub = { ...clubs[0], id: 'oc-3', name: 'Orphan MC', addedBy: null };
  assert.equal(clubProblem(who('m-throttle'), { id: 'oc-3', name: 'Orphan MC', town: '', contact: '', note: '' }, [...clubs, orphanClub], data), NOT_CLUB_EDITOR);
  const orphan = invite({ id: 'in-orphan', addedBy: null });
  assert.equal(archiveInviteProblem(who('m-throttle'), 'in-orphan', [orphan], data), NOT_INVITE_EDITOR);
  // The club is off the list: the invite can still be changed while its club stays the same.
  const offClub = invite({ id: 'in-gold', clubId: 'oc-2' });
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-gold', clubId: 'oc-2' }), clubs, [offClub], data, TODAY), null);
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-waiting', clubId: 'oc-2' }), clubs, invites, data, TODAY), CLUB_OFF);
  // A linked ride the calendar no longer has (it's past) stays linked.
  const linked = invite({ id: 'in-past', rideId: 'r-gone', eventOn: '2026-10-01', answer: 'yes', calendarLabel: 'supported' });
  assert.equal(inviteInProblem(diesel, inInput({ id: 'in-past', eventOn: '2026-10-01', rideId: 'r-gone' }), clubs, [linked], data, TODAY), null);
  // One incoming invite per calendar ride.
  const holder = invite({ id: 'in-holder', rideId: 'r-3', answer: 'yes', calendarLabel: 'non_nuts' });
  assert.equal(inviteInProblem(diesel, inInput({ rideId: 'r-3' }), clubs, [holder], data, TODAY), RIDE_TAKEN);
  // Outgoing replies are recorded after the ride too: the chapter decides, not the (dropped) ride.
  const after = invite({ id: 'out-past', direction: 'out', rideId: 'r-gone', title: null, eventOn: null, chapterId: 'ch-west' });
  assert.equal(canAnswer(diesel, after, data), true);
});
