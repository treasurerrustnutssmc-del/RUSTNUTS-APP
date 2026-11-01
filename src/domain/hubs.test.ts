import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEDS_LIMITS, GROUP_FULL, groupBedsTaken, HUB_LOCKED, HUB_TEXT_TOO_LONG, hubCounts, hubListText, MEMBERS_ONLY, NO_HUB, NOT_HUB_MANAGER,
  NOT_REGISTERED, BAD_CLOSING_DAY, REGISTER_TOO_LONG, REGISTRATIONS_CLOSED, registerProblem, saveHubProblem, visibleRegistrations, withdrawHubProblem,
  type HubInput, type RegisterInput,
} from './hubs';
import { AFTER_DAY, BEFORE, member, planningClub, who } from './planning.testkit';
import type { HubRegistration, RideHub } from './types';

const hubInput: HubInput = { membersOnly: true, closesOn: null, beds: null, accommodation: '', notes: '' };
const hub = (over: Partial<RideHub> = {}): RideHub => ({
  rideId: 'r-club', membersOnly: true, closesOn: null, beds: null, accommodation: '', notes: '', updatedBy: 'sec', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
});
const reg = (memberId: string, over: Partial<HubRegistration> = {}): HubRegistration => ({
  rideId: 'r-club', memberId, staying: 'group', pillion: false, shareWith: '', notes: '', registeredAt: '2026-10-02T00:00:00.000Z', withdrawnAt: null, ...over,
});
const regInput = (over: Partial<RegisterInput> = {}): RegisterInput => ({ staying: 'group', pillion: false, shareWith: '', notes: '', ...over });

test('running a hub: in the database’s order', () => {
  const data = planningClub();
  const club = data.rides.find((r) => r.id === 'r-club');
  const sec = who(data, 'sec');
  assert.equal(saveHubProblem(null, club, hubInput, data, BEFORE), 'Sign in first.');
  assert.equal(saveHubProblem(sec, undefined, hubInput, data, BEFORE), 'No such ride.');
  assert.equal(saveHubProblem(sec, data.rides.find((r) => r.id === 'r-off'), hubInput, data, BEFORE), 'That ride was cancelled.');
  assert.equal(saveHubProblem(sec, club, hubInput, data, AFTER_DAY), HUB_LOCKED);
  assert.equal(saveHubProblem(who(data, 'rc'), club, hubInput, data, BEFORE), NOT_HUB_MANAGER);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, beds: 0 }, data, BEFORE), BEDS_LIMITS);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, beds: 501 }, data, BEFORE), BEDS_LIMITS);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, beds: 2.5 }, data, BEFORE), BEDS_LIMITS);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, accommodation: 'x'.repeat(1001) }, data, BEFORE), HUB_TEXT_TOO_LONG);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, notes: 'x'.repeat(1001) }, data, BEFORE), HUB_TEXT_TOO_LONG);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, closesOn: '2026-10-31' }, data, BEFORE), BAD_CLOSING_DAY);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, closesOn: '2026-11-09' }, data, BEFORE), BAD_CLOSING_DAY);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, closesOn: '2026-11-01' }, data, BEFORE), null);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, closesOn: '2026-11-08' }, data, BEFORE), null);
  // A closing day that has already passed can stay as it is while the rest changes.
  const closed = planningClub({ rideHubs: [hub({ closesOn: '2026-10-20' })] });
  assert.equal(saveHubProblem(sec, club, { ...hubInput, closesOn: '2026-10-20', notes: 'Bring a swag' }, closed, BEFORE), null);
  assert.equal(saveHubProblem(sec, club, { ...hubInput, beds: 40 }, data, BEFORE), null);
});

test('registering: in the database’s order, with members only, closing and group beds', () => {
  const base = planningClub();
  const club = base.rides.find((r) => r.id === 'r-club')!;
  const today = '2026-11-01';
  const check = (me: string, input: RegisterInput, data = planningClub({ rideHubs: [hub()] }), now = BEFORE, day = today) =>
    registerProblem(who(data, me), data.rides.find((r) => r.id === club.id), input, data, now, day);
  assert.equal(registerProblem(who(base, 'rider'), undefined, regInput(), base, BEFORE, today), 'No such ride.');
  assert.equal(check('rider', regInput(), base), NO_HUB);
  assert.equal(check('rider', regInput(), undefined, '2026-11-07T21:30:00.000Z'), REGISTRATIONS_CLOSED);
  assert.equal(check('rider', regInput(), planningClub({ rideHubs: [hub({ closesOn: '2026-10-31' })] })), REGISTRATIONS_CLOSED);
  assert.equal(check('rider', regInput(), planningClub({ rideHubs: [hub({ closesOn: '2026-11-01' })] })), null);
  assert.equal(check('sup', regInput()), MEMBERS_ONLY);
  assert.equal(check('fng', regInput()), null);
  assert.equal(check('nomad', regInput()), null);
  assert.equal(check('sup', regInput(), planningClub({ rideHubs: [hub({ membersOnly: false })] })), null);
  assert.equal(check('rider', regInput({ shareWith: 'x'.repeat(81) })), REGISTER_TOO_LONG);
  assert.equal(check('rider', regInput({ notes: 'x'.repeat(201) })), REGISTER_TOO_LONG);
  // Three beds; rc and a pillion take two.
  const tight = planningClub({ rideHubs: [hub({ beds: 3 })], hubRegistrations: [reg('rc', { pillion: true }), reg('tg', { staying: 'own' }), reg('off', { withdrawnAt: '2026-10-05T00:00:00.000Z' })] });
  assert.equal(check('rider', regInput({ pillion: true }), tight), GROUP_FULL);
  assert.equal(check('rider', regInput(), tight), null);
  assert.equal(check('rider', regInput({ staying: 'camping', pillion: true }), tight), null);
  assert.equal(check('rc', regInput({ pillion: true }), tight), null); // your own registration isn't counted twice
});

test('withdrawing: until the start, whatever the closing day', () => {
  const data = planningClub({ rideHubs: [hub({ closesOn: '2026-10-01' })], hubRegistrations: [reg('rc'), reg('tg', { withdrawnAt: '2026-10-05T00:00:00.000Z' })] });
  const club = data.rides.find((r) => r.id === 'r-club');
  assert.equal(withdrawHubProblem(who(data, 'tg'), club, data, BEFORE), NOT_REGISTERED);
  assert.equal(withdrawHubProblem(who(data, 'rc'), club, data, BEFORE), null);
  assert.equal(withdrawHubProblem(who(data, 'rc'), club, data, '2026-11-07T21:30:00.000Z'), REGISTRATIONS_CLOSED);
});

test('the counts and the shared list', () => {
  const data = planningClub({
    rideHubs: [hub({ beds: 10, accommodation: 'Bright Motel' })],
    hubRegistrations: [
      reg('rc', { pillion: true, shareWith: 'TG' }),
      reg('tg', { staying: 'own' }),
      reg('off', { staying: 'camping', notes: 'Vego' }),
      reg('rider', { staying: 'day' }),
      reg('nomad', { withdrawnAt: '2026-10-05T00:00:00.000Z' }),
    ],
  });
  assert.deepEqual(hubCounts('r-club', data), { riders: 4, pillions: 1, group: 1, own: 1, camping: 1, day: 1 });
  const text = hubListText(who(data, 'sec'), data.rides.find((r) => r.id === 'r-club')!, data);
  assert.match(text, /^Coffee run · Sun 08\/11\/2026/);
  assert.match(text, /4 riders, 1 pillion/);
  assert.match(text, /With the group \(2 of 10 beds\)\n- rc Rider \+ pillion, sharing with TG/);
  assert.match(text, /Camping\n- off Rider: Vego/);
  assert.doesNotMatch(text, /nomad/);
});

test('who sees the registrations: your own, all of them for the ride’s managers, and your chapter’s members for its board', () => {
  const base = planningClub();
  const data = planningClub({
    members: [...base.members, member('ninth', { chapterId: 'north' })],
    rideHubs: [hub(), hub({ rideId: 'r-west' })],
    hubRegistrations: [reg('rc', { pillion: true }), reg('tg', { staying: 'own' }), reg('rc', { rideId: 'r-west' }), reg('ninth', { rideId: 'r-west' })],
  });
  const ids = (me: string, rideId: string) => visibleRegistrations(who(data, me), rideId, data).map((r) => r.memberId);
  assert.deepEqual(ids('rc', 'r-club'), ['rc'], 'your own');
  assert.deepEqual(ids('rider', 'r-club'), [], 'nobody else’s');
  assert.deepEqual(ids('sec', 'r-club'), ['rc', 'tg'], 'the ride’s managers see them all');
  assert.deepEqual(ids('northsec', 'r-club'), ['rc', 'tg'], 'any board runs a whole-club ride');
  assert.deepEqual(ids('auditor', 'r-club'), [], 'the Auditor runs no rides');
  assert.deepEqual(ids('sec', 'r-west'), ['rc', 'ninth'], 'West’s board runs West’s ride');
  assert.deepEqual(ids('northsec', 'r-west'), ['ninth'], 'North’s board sees its own member there');
  assert.deepEqual(ids('chair', 'r-west'), ['rc', 'ninth'], 'the national roles run every ride');
  assert.deepEqual(visibleRegistrations(null, 'r-club', data), []);
  assert.deepEqual(visibleRegistrations(who(data, 'applicant'), 'r-club', data), []);
  const west = data.rides.find((r) => r.id === 'r-west')!;
  assert.match(hubListText(who(data, 'northsec'), west, data), /ninth Rider/);
  assert.doesNotMatch(hubListText(who(data, 'northsec'), west, data), /rc Rider/);
});

test('the numbers come from the database’s counts when they’re here; your own beds aren’t counted against you', () => {
  const counts = {
    rideId: 'r-club', hubRiders: 4, hubPillions: 1, hubGroup: 2, hubOwn: 1, hubCamping: 1, hubDay: 0, hubGroupBeds: 3,
    charityRiding: 0, charityPillions: 0, charityGuests: 0, charityHelping: 0, charityPeople: 0,
    websiteRiding: 0, websitePillions: 0, websiteGuests: 0, websiteHelping: 0, websitePeople: 0,
  };
  const data = planningClub({ rideHubs: [hub({ beds: 4 })], hubRegistrations: [reg('rider', { pillion: true })], signupCounts: [counts] });
  assert.deepEqual(hubCounts('r-club', data), { riders: 4, pillions: 1, group: 2, own: 1, camping: 1, day: 0 });
  assert.equal(groupBedsTaken('r-club', data), 3);
  const club = data.rides.find((r) => r.id === 'r-club')!;
  assert.equal(registerProblem(who(data, 'rider'), club, regInput({ pillion: true }), data, BEFORE, '2026-11-01'), null, 'one bed held by others, two wanted, four beds');
  assert.equal(registerProblem(who(data, 'tg'), club, regInput({ pillion: true }), data, BEFORE, '2026-11-01'), GROUP_FULL, 'three held, two wanted');
  assert.equal(registerProblem(who(data, 'tg'), club, regInput(), data, BEFORE, '2026-11-01'), null, 'three held, one wanted');
  const other = { ...data, signupCounts: [{ ...counts, rideId: 'r-west' }] };
  assert.deepEqual(hubCounts('r-club', other), { riders: 1, pillions: 1, group: 1, own: 0, camping: 0, day: 0 }, 'no counts for this ride: the rows');
  assert.equal(groupBedsTaken('r-club', other), 2);
});
