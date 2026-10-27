import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_ANSWERED, ALREADY_ASKED, ALREADY_THAT_SPOT, answerSwapProblem, askSwapProblem, CREW_CHANGED, NOT_FOR_YOU, NOT_ON_CREW, NO_SWAP,
  NOTE_TOO_LONG, NOT_ASKER, openAsksFor, PICK_SOMEONE_ELSE, swapIsCurrent, withdrawSwapProblem,
} from './swaps';
import { AFTER_DAY, BEFORE, member, planningClub, who } from './planning.testkit';
import type { CrewSwap } from './types';

const swap = (over: Partial<CrewSwap> = {}): CrewSwap => ({
  id: 's1', rideId: 'r-west', askedBy: 'rc', role: 'road_captain', askedTo: 'rider', theirRole: null, note: '', state: 'asked',
  askedAt: '2026-10-20T00:00:00.000Z', answeredAt: null, ...over,
});

test('asking: in the database’s order', () => {
  const data = planningClub({ members: [...planningClub().members, member('hal', { onHiatus: true })], rsvps: [...planningClub().rsvps, { rideId: 'r-west', memberId: 'nomad', answer: 'no', updatedAt: '' }] });
  const west = data.rides.find((r) => r.id === 'r-west');
  const ask = (me: string, to: string, note = '', d = data, now = BEFORE) => askSwapProblem(who(d, me), d.rides.find((r) => r.id === 'r-west'), to, note, d, now);
  assert.equal(askSwapProblem(null, west, 'rider', '', data, BEFORE), 'Sign in first.');
  assert.equal(askSwapProblem(who(data, 'rc'), undefined, 'rider', '', data, BEFORE), 'No such ride.');
  assert.equal(askSwapProblem(who(data, 'rc'), data.rides.find((r) => r.id === 'r-off'), 'rider', '', data, BEFORE), 'That ride was cancelled.');
  assert.equal(ask('rc', 'rider', '', data, AFTER_DAY), 'The crew can’t change after the ride day.');
  assert.equal(ask('rider', 'sec'), NOT_ON_CREW);
  assert.equal(ask('rc', 'rc'), PICK_SOMEONE_ELSE);
  assert.equal(ask('rc', 'nobody'), 'That member no longer exists.');
  assert.equal(ask('rc', 'fng'), 'Only Full and Nomad members can crew a ride.');
  assert.equal(ask('rc', 'hal'), 'Members on hiatus can’t crew a ride.');
  assert.equal(ask('tg', 'off'), 'Tail Gunners need a current first aid certificate on file.'); // off has no first aid
  assert.equal(ask('rc', 'nomad'), 'They said they can’t make it.');
  assert.equal(ask('off', 'tg'), 'Tail Gunners need a current first aid certificate on file.'); // the trade: off can't be TG
  assert.equal(ask('rc', 'rider', 'x'.repeat(201)), NOTE_TOO_LONG);
  assert.equal(ask('rc', 'rider', ' Work came up '), null);
  assert.equal(ask('rc', 'off'), null); // a trade
  assert.equal(ask('rc', 'rider', '', planningClub({ crewSwaps: [swap({ askedTo: 'sec' })] })), ALREADY_ASKED);
  assert.equal(ask('rc', 'rider', '', planningClub({ crewSwaps: [swap({ askedTo: 'sec', state: 'declined' })] })), null);
  const twoOfficers = planningClub({ crew: [...(planningClub().crew ?? []), { rideId: 'r-west', memberId: 'rider', role: 'officer', assignedBy: null, assignedAt: '' }] });
  assert.equal(ask('off', 'rider', '', twoOfficers), ALREADY_THAT_SPOT);
});

test('answering: only the person asked, while open; a yes re-checks the ride and the crew', () => {
  const open = planningClub({ crewSwaps: [swap()] });
  const answer = (me: string, yes: boolean, d = open, now = BEFORE) => answerSwapProblem(who(d, me), (d.crewSwaps ?? [])[0], yes, d, now);
  assert.equal(answerSwapProblem(who(open, 'rider'), undefined, true, open, BEFORE), NO_SWAP);
  assert.equal(answer('sec', true), NOT_FOR_YOU);
  assert.equal(answer('rider', true, planningClub({ crewSwaps: [swap({ state: 'withdrawn' })] })), ALREADY_ANSWERED);
  assert.equal(answer('rider', true, open, AFTER_DAY), 'The crew can’t change after the ride day.');
  assert.equal(answer('rider', false, open, AFTER_DAY), null); // a no always closes it
  const moved = planningClub({ crewSwaps: [swap()], crew: (planningClub().crew ?? []).map((s) => (s.memberId === 'rc' ? { ...s, role: 'officer' as const } : s)) });
  assert.equal(answer('rider', true, moved), CREW_CHANGED);
  assert.equal(answer('rider', false, moved), null);
  const traded = planningClub({ crewSwaps: [swap({ askedTo: 'off', theirRole: 'tail_gunner' })] });
  assert.equal(answer('off', true, traded), CREW_CHANGED); // off holds Officer, not TG
  assert.equal(answer('rider', true), null);
  assert.equal(swapIsCurrent(swap(), open), true);
  assert.equal(swapIsCurrent(swap(), moved), false);
});

test('withdrawing, and the open asks for someone', () => {
  const data = planningClub({ crewSwaps: [swap(), swap({ id: 's2', askedBy: 'tg', role: 'tail_gunner', askedTo: 'rider', state: 'declined' })] });
  assert.equal(withdrawSwapProblem(who(data, 'rc'), undefined), NO_SWAP);
  assert.equal(withdrawSwapProblem(who(data, 'rider'), data.crewSwaps![0]), NOT_ASKER);
  assert.equal(withdrawSwapProblem(who(data, 'tg'), data.crewSwaps![1]), ALREADY_ANSWERED);
  assert.equal(withdrawSwapProblem(who(data, 'rc'), data.crewSwaps![0]), null);
  assert.deepEqual(openAsksFor('rider', data, BEFORE).map((s) => s.id), ['s1']);
  assert.deepEqual(openAsksFor('rider', data, AFTER_DAY), []);
});
