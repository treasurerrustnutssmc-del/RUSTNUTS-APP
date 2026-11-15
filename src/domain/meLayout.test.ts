import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { ACTING_COMBINED, ACTING_FAMILY, ACTING_LICENCE_VACANCY, endTermProblem, SMALL_BOARD, withdrawRequestProblem } from './access';
import { coveredNotice, coverNote } from './home';
import { coverConfirmNote, coverPanels, homeCoverPanels, meGroups, standInChoices } from './meLayout';
import type { ActingRequest, ClubData, Member, Position, PositionRole } from './types';

const base = { contacts: 1, bikes: 1, owingCents: 0, onHiatus: false, roadRules: null };
const byId = (input: Parameters<typeof meGroups>[0]) => Object.fromEntries(meGroups(input).map((g) => [g.id, g]));

test('Me has six groups, in a fixed order', () => {
  assert.deepEqual(meGroups(base).map((g) => g.id), ['year', 'details', 'rules', 'fees', 'settings', 'help']);
});

test('with nothing to do, every group starts closed', () => {
  assert.deepEqual(meGroups(base).filter((g) => g.startsOpen), []);
});

test('no emergency contact opens My details and says so', () => {
  const g = byId({ ...base, contacts: 0 });
  assert.equal(g.details.startsOpen, true);
  assert.equal(g.details.summary, 'No emergency contact yet');
});

test('My details counts contacts and bikes in plain words', () => {
  assert.equal(byId({ ...base, contacts: 1, bikes: 1 }).details.summary, '1 emergency contact, 1 bike');
  assert.equal(byId({ ...base, contacts: 2, bikes: 3 }).details.summary, '2 emergency contacts, 3 bikes');
  assert.equal(byId({ ...base, contacts: 1, bikes: 0 }).details.summary, '1 emergency contact, no bikes');
});

test('Road Rules that need signing open Rules and papers; otherwise it shows where you stand', () => {
  const urgent = byId({ ...base, roadRules: { text: 'Not signed', urgent: true } });
  assert.equal(urgent.rules.startsOpen, true);
  assert.equal(urgent.rules.summary, 'Road Rules: not signed');
  const fine = byId({ ...base, roadRules: { text: 'Signed until 02/11/2027', urgent: false } });
  assert.equal(fine.rules.startsOpen, false);
  assert.equal(fine.rules.summary, 'Road Rules: signed until 02/11/2027');
  assert.equal(byId(base).rules.summary, 'Club documents and policies');
});

test('money owing opens Fees; paid up and on hiatus read plainly', () => {
  const owing = byId({ ...base, owingCents: 12500 });
  assert.equal(owing.fees.startsOpen, true);
  assert.equal(owing.fees.summary, '$125.00 owing');
  assert.equal(byId(base).fees.summary, 'All paid up');
  assert.equal(byId({ ...base, onHiatus: true }).fees.summary, 'On hiatus: no new fees');
});

// ---------------------------------------------------------------------------
// Acting roles, Task 20: Me and Home for cover. North has Smokey (President), Jet (VP) and Crank
// (Road Captain); Ned and Gus have no seat unless a case seats them. Today is 15/11/2026.
// ---------------------------------------------------------------------------

const AT = '2026-11-15';
const UNTIL = '2026-12-13';
const rider = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'north', fullName: `${id[0].toUpperCase()}${id.slice(1)} Rider`, roadName: `${id[0].toUpperCase()}${id.slice(1)}`, status: 'full',
  approval: 'approved', joinedOn: '2023-01-01', patchedOn: '2025-06-01', fngStartedOn: null, bio: null, sharePhone: false, appliedOn: '2023-01-01',
  onHiatus: false, ...over,
});
const seat = (id: string, memberId: string, role: PositionRole, over: Partial<Position> = {}): Position => ({
  id, memberId, chapterId: 'north', role, startedOn: '2026-08-01', endedOn: null, ...over,
});
const SMOKEY_PRES = seat('smokey-president', 'smokey', 'president');
const SEATS = [SMOKEY_PRES, seat('jet-vp', 'jet', 'vice_president'), seat('crank-rc', 'crank', 'road_captain')];
const JET_COVERS = seat('jet-covers-smokey', 'jet', 'president', {
  startedOn: AT, actingUntil: UNTIL, covers: 'smokey-president', actingWhy: 'Smokey overseas', appointedBy: 'crank',
});
const NED_SEC = seat('ned-secretary', 'ned', 'secretary');
const FIVE = [NED_SEC, seat('gus-treasurer', 'gus', 'treasurer')];
const ask = (over: Partial<ActingRequest> = {}): ActingRequest => ({
  id: 'smokey-asks-jet', chapterId: 'north', role: 'president', memberId: 'jet', covers: 'smokey-president', until: UNTIL,
  why: 'Smokey overseas', requestedBy: 'smokey', createdAt: `${AT}T01:00:00.000Z`, closedAt: null, outcome: null, ...over,
});
const north = (w: { seats?: Position[]; without?: string[]; requests?: ActingRequest[]; members?: Record<string, Partial<Member>> } = {}): ClubData => ({
  ...DEMO_DATA,
  chapters: [{ id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' }],
  members: ['smokey', 'jet', 'crank', 'ned', 'gus'].map((id) => rider(id, w.members?.[id])),
  positions: [...SEATS, ...(w.seats ?? [])].filter((p) => !w.without?.includes(p.id)),
  privates: [], votes: [], meetings: [], crew: [], rides: [], actingRequests: w.requests ?? [], actingChanges: [],
});
const who = (data: ClubData, id: string) => data.members.find((m) => m.id === id)!;

test('a board holder gets ‘Arrange cover while I’m away’', () => {
  const data = north();
  const panels = coverPanels(who(data, 'smokey'), data, AT);
  assert.equal(panels.length, 1, 'one panel per full board seat');
  const [panel] = panels;
  assert.equal(panel.kind, 'arrange');
  assert.equal(panel.title, 'Arrange cover while I’m away');
  assert.equal(panel.seat.id, 'smokey-president');
  if (panel.kind !== 'arrange') return;
  assert.equal(panel.summary, 'President (North) · Jet (VP) can stand in');
  // A cover runs four weeks unless changed, and three months at most (from today).
  assert.equal(panel.until, UNTIL);
  assert.equal(panel.untilHint, 'Last acting day. Up to 15/02/2027.');
  assert.equal(panel.whyHint, 'Every member can read this. Keep health details out.');
  // Crank's Road Captain seat is a board seat too; Ned has no seat, so nothing to cover.
  assert.deepEqual(coverPanels(who(data, 'crank'), data, AT).map((p) => [p.kind, p.seat.id]), [['arrange', 'crank-rc']]);
  assert.deepEqual(coverPanels(who(data, 'ned'), data, AT), []);
  // Only a full seat is covered: a stint, or a non-board role, gets no panel.
  const stint = north({ seats: [seat('ned-acting-sec', 'ned', 'secretary', { startedOn: AT, actingUntil: UNTIL, actingWhy: 'No Secretary', appointedBy: 'smokey' }), seat('gus-tg', 'gus', 'tail_gunner')] });
  assert.deepEqual(coverPanels(who(stint, 'ned'), stint, AT), []);
  assert.deepEqual(coverPanels(who(stint, 'gus'), stint, AT), []);
});

test('standInChoices gives ‘Jet (VP)’ first (only the VP for a President)', () => {
  const data = north();
  assert.deepEqual(standInChoices(who(data, 'smokey'), SMOKEY_PRES, data, AT), [{ value: 'jet', label: 'Jet (VP)' }]);
  // Any board member may cover another seat: the VP first, then by seat.
  const five = north({ seats: FIVE });
  assert.deepEqual(standInChoices(who(five, 'ned'), NED_SEC, five, AT).map((c) => c.label), ['Jet (VP)', 'Smokey (PRES)', 'Gus (TREAS)', 'Crank (RC)']);
  // The panel's one-line summary counts them, so it stays on one line at 360 wide.
  assert.equal((coverPanels(who(five, 'ned'), five, AT)[0] as { summary?: string }).summary, 'Secretary (North) · 4 can stand in');
  // Only the ones the seat allows: on hiatus, or already acting, they're left out.
  const busy = north({ seats: [...FIVE, seat('gus-acting-saa', 'gus', 'sergeant_at_arms', { startedOn: AT, actingUntil: UNTIL, actingWhy: 'No SAA', appointedBy: 'smokey' })], members: { crank: { onHiatus: true } } });
  assert.deepEqual(standInChoices(who(busy, 'ned'), NED_SEC, busy, AT).map((c) => c.value), ['jet', 'smokey']);
});

test('the covered holder gets coveredNotice and an ‘I’m back’ ConfirmButton', () => {
  const data = north({ seats: [JET_COVERS] });
  const [panel] = coverPanels(who(data, 'smokey'), data, AT);
  assert.equal(panel.kind, 'covered');
  if (panel.kind !== 'covered') return;
  assert.equal(panel.title, 'Your seat is covered');
  assert.equal(panel.cover.id, 'jet-covers-smokey');
  assert.equal(panel.notice, coveredNotice(SMOKEY_PRES, JET_COVERS, data));
  assert.deepEqual(panel.button, { label: 'I’m back', confirmLabel: 'Yes, I’m back', confirmNote: 'This ends Jet’s acting today.' });
  // The ending is the holder's own: endTermProblem lets them end the cover (holder_back).
  assert.equal(endTermProblem(who(data, 'smokey'), JET_COVERS, data, AT), null);
  // Home shows only this panel; once the cover lapses the seat is Smokey's to cover again.
  assert.deepEqual(homeCoverPanels(who(data, 'smokey'), data, AT).map((p) => p.kind), ['covered']);
  assert.deepEqual(homeCoverPanels(who(north(), 'smokey'), north(), AT), []);
  assert.equal(coverPanels(who(data, 'smokey'), data, '2026-12-14')[0].kind, 'arrange');
});

test('a board of two gets the 8.6 refer-to-NEC line instead', () => {
  const two = north({ without: ['crank-rc'] });
  const [panel] = coverPanels(who(two, 'smokey'), two, AT);
  assert.equal(panel.kind, 'blocked');
  assert.equal(panel.title, 'Arrange cover while I’m away');
  if (panel.kind !== 'blocked') return;
  assert.equal(panel.line, SMALL_BOARD);
  assert.equal(panel.summary, 'President (North) · Refer it to the NEC (8.6)');
  assert.ok(!('choices' in panel), 'no stand-ins to pick');
  // A board of one too.
  const one = north({ without: ['crank-rc', 'jet-vp'] });
  assert.equal((coverPanels(who(one, 'smokey'), one, AT)[0] as { line?: string }).line, SMALL_BOARD);
});

test('the note is coverNote plus actingWarnings (9.6, 9.7, 9.5)', () => {
  const data = north();
  // The VP acting for the President combines nothing (8.2): what moves, then 9.6 and 9.7.
  assert.equal(
    coverConfirmNote(SMOKEY_PRES, who(data, 'jet'), UNTIL, data, AT),
    [coverNote(SMOKEY_PRES, who(data, 'jet'), UNTIL, data), ACTING_FAMILY, ACTING_LICENCE_VACANCY].join('\n\n'),
  );
  // Crank, already on the board as Road Captain, combines duties to cover Ned's Secretary seat (9.5).
  const five = north({ seats: FIVE });
  assert.equal(
    coverConfirmNote(NED_SEC, who(five, 'crank'), UNTIL, five, AT),
    [coverNote(NED_SEC, who(five, 'crank'), UNTIL, five), ACTING_FAMILY, ACTING_LICENCE_VACANCY, ACTING_COMBINED].join('\n\n'),
  );
});

test('the holder’s open request shows Withdraw request', () => {
  const data = north({ requests: [ask()] });
  const [panel] = coverPanels(who(data, 'smokey'), data, AT);
  assert.equal(panel.kind, 'asked');
  if (panel.kind !== 'asked') return;
  assert.equal(panel.title, 'Cover asked for your seat');
  assert.equal(panel.request.id, 'smokey-asks-jet');
  assert.equal(panel.line, 'You asked for Jet to cover as President (North) until 13/12/2026: Smokey overseas. A third board member confirms the cover you asked for (9.5).');
  assert.deepEqual(panel.button, { label: 'Withdraw request', confirmLabel: 'Yes, withdraw it' });
  assert.equal(withdrawRequestProblem(who(data, 'smokey'), ask(), data, AT), null);
  // Someone else asked for a cover of the seat (a board vote): the holder can still withdraw it.
  const voted = north({ requests: [ask({ id: 'crank-asks-jet', requestedBy: 'crank', why: 'Smokey can’t be reached' })] });
  const [other] = coverPanels(who(voted, 'smokey'), voted, AT);
  assert.equal(other.kind, 'asked');
  if (other.kind !== 'asked') return;
  assert.equal(other.line, 'Crank asked for Jet to act as President (North) for you until 13/12/2026: Smokey can’t be reached. If you’re available, withdraw it.');
  // A closed request is gone, and the seat can be covered again.
  const closed = north({ requests: [ask({ closedAt: `${AT}T02:00:00.000Z`, outcome: 'withdrawn' })] });
  assert.equal(coverPanels(who(closed, 'smokey'), closed, AT)[0].kind, 'arrange');
});
