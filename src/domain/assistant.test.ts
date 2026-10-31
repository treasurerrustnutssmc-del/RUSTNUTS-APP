import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiMessage, Proposal } from '../../supabase/functions/_shared/askClub';
import {
  NOT_CONFIRMED, RIDES_CALENDAR, buildSnapshot, calendarLink, cardFor, ideaRecipient, nextMessages, pendingToolIds,
  rideDraftProblem, withReply, type CardCtx, type RideDraft,
} from './assistant';
import { BEFORE, member, planningClub, who } from './planning.testkit';
import type { ClubData } from './types';

// Sun 01/11/2026 11 am Melbourne. The West ride is Sun 08/11/2026 at 8:30 am.
const NOW = BEFORE;
const TODAY = '2026-11-01';

function club(over: Partial<ClubData> = {}): ClubData {
  const base = planningClub();
  return {
    ...base,
    positions: [...base.positions, { id: 'p-rc', memberId: 'rc', chapterId: 'west', role: 'road_captain', startedOn: '2025-01-01', endedOn: null }],
    ...over,
  };
}
const ctx = (meId: string, over: Partial<ClubData> = {}, chats = [{ id: 'chat-west', title: 'West' }]): CardCtx => {
  const data = club(over);
  return { me: who(data, meId), data, chats, now: NOW };
};
const p = (name: Proposal['name'], input: Record<string, unknown>): Proposal => ({ id: 'tu_1', name, input });

test('the snapshot holds the member, rides in the window with their answer, and only their own charges', () => {
  const c = ctx('rider', {
    rides: [
      ...club().rides,
      { id: 'r-far', title: 'Too far', startsAt: '2027-06-01T00:00:00.000Z', endsAt: null, allDay: false, location: null, notes: null, category: 'club', cancelledAt: null },
    ],
    charges: [
      { id: 'c1', memberId: 'rider', chapterId: 'west', fy: 2027, kind: 'annual', description: 'Full fee', amountCents: 36000, dueOn: '2026-12-31', createdAt: NOW, waivedAt: null },
      { id: 'c2', memberId: 'sec', chapterId: 'west', fy: 2027, kind: 'annual', description: 'Full fee', amountCents: 36000, dueOn: '2026-12-31', createdAt: NOW, waivedAt: null },
    ],
  });
  const text = buildSnapshot(c.me, c.data, c.chats, NOW);
  assert.match(text, /^<club_snapshot>\n[\s\S]*\n<\/club_snapshot>$/);
  const snap = JSON.parse(text.replace(/^<club_snapshot>\n/, '').replace(/\n<\/club_snapshot>$/, ''));
  assert.equal(snap.today, 'Sun 01/11/2026 (2026-11-01)');
  assert.equal(snap.me.id, 'rider');
  const west = snap.upcoming_rides.find((r: { id: string }) => r.id === 'r-west');
  assert.equal(west.day, '2026-11-08');
  assert.equal(west.shown, 'Sun 08/11/2026');
  assert.equal(west.start, '08:30');
  assert.equal(west.my_answer, 'going');
  assert.equal(west.going, 4);
  assert.deepEqual(west.crew.map((x: { role: string }) => x.role).sort(), ['Officer', 'Road Captain', 'Tail Gunner']);
  assert.ok(!snap.upcoming_rides.some((r: { id: string }) => r.id === 'r-far'), 'past the 90-day window');
  assert.deepEqual(snap.my_charges, [{ what: 'Full fee', owing: '$360.00', due: '31/12/2026' }]);
  assert.deepEqual(snap.chats, [{ id: 'chat-west', title: 'West' }]);
  assert.equal(buildSnapshot(c.me, c.data, c.chats, NOW), text, 'same inputs, same text');
});

test('rsvp card', () => {
  const c = ctx('sec');
  const card = cardFor(p('rsvp', { ride_id: 'r-west', answer: 'maybe' }), c);
  assert.equal(card.heading, 'MAYBE');
  assert.deepEqual(card.lines, ['Sun 08/11/2026 · 8:30 am', 'Coffee run']);
  assert.equal(card.problem, null);
  assert.deepEqual(card.plan, { kind: 'rsvp', rideId: 'r-west', answer: 'maybe' });
  assert.equal(cardFor(p('rsvp', { ride_id: 'r-west', answer: 'no' }), c).heading, 'CAN’T MAKE IT');
});

test('unknown ids give a problem and no confirm', () => {
  const c = ctx('sec');
  const cases: Proposal[] = [
    p('rsvp', { ride_id: 'r-nope', answer: 'going' }),
    p('join_crew', { ride_id: 'r-nope', role: 'officer' }),
    p('call_ride', { ride_id: 'r-nope', state: 'off', reason: 'Rain', new_day: '' }),
    p('cancel_bus', { booking_id: 'b-nope' }),
    p('hand_bus_keys', { to_member_id: 'nobody', note: '' }),
    p('post_message', { chat_id: 'chat-secret', text: 'hi' }),
    p('rsvp', { ride_id: 'r-west', answer: 'sideways' }),
  ];
  for (const proposal of cases) {
    const card = cardFor(proposal, c);
    assert.ok(card.problem, JSON.stringify(proposal.input));
    assert.equal(card.plan, null, JSON.stringify(proposal.input));
  }
  assert.equal(cardFor(cases[0], c).problem, 'That ride isn’t on the calendar.');
  assert.equal(cardFor(cases[5], c).problem, 'You can’t post in that chat.');
});

test('going needs the Road Rules signed', () => {
  const c = ctx('sec', { roadRules: [{ number: 1, body: 'Ride left.', changes: '', fresh: true, publishedAt: '2026-10-01T00:00:00.000Z', publishedBy: null }] });
  const card = cardFor(p('rsvp', { ride_id: 'r-west', answer: 'going' }), c);
  assert.equal(card.problem, 'Sign the Road Rules first.');
  assert.equal(cardFor(p('rsvp', { ride_id: 'r-west', answer: 'maybe' }), c).problem, null);
});

test('join and leave crew are always for the member asking', () => {
  const c = ctx('rider');
  const join = cardFor(p('join_crew', { ride_id: 'r-west', role: 'officer' }), c);
  assert.equal(join.heading, 'OFFICER');
  assert.deepEqual(join.plan, { kind: 'join_crew', rideId: 'r-west', role: 'officer' });
  assert.equal(cardFor(p('join_crew', { ride_id: 'r-west', role: 'tail_gunner' }), c).problem, 'That spot’s taken.');
  assert.equal(cardFor(p('leave_crew', { ride_id: 'r-west' }), c).problem, 'They’re not on the crew.');
  const leave = cardFor(p('leave_crew', { ride_id: 'r-west' }), ctx('off'));
  assert.equal(leave.heading, 'OFF THE CREW');
  assert.deepEqual(leave.plan, { kind: 'leave_crew', rideId: 'r-west' });
});

test('call_ride card, and only the people who can call a ride get Confirm', () => {
  const card = cardFor(p('call_ride', { ride_id: 'r-west', state: 'postponed', reason: 'Weather', new_day: '2026-11-15' }), ctx('sec'));
  assert.equal(card.heading, 'RIDE’S POSTPONED');
  assert.deepEqual(card.lines, ['Sun 08/11/2026 · 8:30 am', 'Coffee run', 'Weather', 'New day: 15/11/2026', 'It goes in the ride’s chat too.']);
  assert.deepEqual(card.plan, { kind: 'call_ride', rideId: 'r-west', state: 'postponed', reason: 'Weather', newDay: '2026-11-15' });
  assert.equal(cardFor(p('call_ride', { ride_id: 'r-west', state: 'off', reason: 'Rain', new_day: '' }), ctx('rider')).problem,
    'Only the board, ride committee or this ride’s Road Captain can call the ride.');
});

test('book_bus card says whether it waits for a yes', () => {
  const input = { first_day: '2026-11-08', last_day: '2026-11-08', purpose: 'charity_ride', ride_id: 'r-west', driver_id: 'rider', notes: 'Toy run' };
  const card = cardFor(p('book_bus', input), ctx('rider'));
  assert.equal(card.heading, 'RUSTY BUS');
  assert.equal(card.problem, null);
  assert.deepEqual(card.lines, ['08/11/2026', 'Charity ride', 'For: Coffee run', 'Driver: rider', 'Toy run', 'Waits for a yes from the board.']);
  assert.deepEqual(card.plan, {
    kind: 'book_bus',
    input: { firstDay: '2026-11-08', lastDay: '2026-11-08', purpose: 'charity_ride', rideId: 'r-west', driverId: 'rider', notes: 'Toy run' },
  });
  assert.equal(cardFor(p('book_bus', { ...input, ride_id: '' }), ctx('sec')).lines.at(-1), 'Booked straight away.');
  assert.equal(cardFor(p('book_bus', { ...input, first_day: '2026-10-01', last_day: '2026-10-01' }), ctx('rider')).problem, 'Bookings can’t start in the past.');
});

test('bus km and keys cards', () => {
  const km = cardFor(p('log_bus_km', { km: 45210, read_on: '2026-11-01', note: '' }), ctx('rider'));
  assert.equal(km.heading, 'BUS KM');
  assert.deepEqual(km.lines, ['45,210 km', '01/11/2026']);
  assert.deepEqual(km.plan, { kind: 'log_bus_km', input: { km: 45210, readOn: '2026-11-01', bookingId: null, note: '' } });
  assert.equal(cardFor(p('log_bus_km', { km: 1.5, read_on: '2026-11-01', note: '' }), ctx('rider')).problem, 'The odometer is in whole km, up to 2,000,000.');
  const keys = cardFor(p('hand_bus_keys', { to_member_id: 'tg', note: 'At the clubhouse' }), ctx('rider'));
  assert.equal(keys.heading, 'BUS KEYS');
  assert.deepEqual(keys.lines, ['To tg', 'At the clubhouse']);
  assert.deepEqual(keys.plan, { kind: 'hand_bus_keys', toId: 'tg', note: 'At the clubhouse' });
});

test('post_message card', () => {
  const card = cardFor(p('post_message', { chat_id: 'chat-west', text: 'Who’s up for Sunday?' }), ctx('rider'));
  assert.equal(card.heading, 'POST IN WEST');
  assert.deepEqual(card.lines, ['Who’s up for Sunday?']);
  assert.deepEqual(card.plan, { kind: 'post_message', chatId: 'chat-west', text: 'Who’s up for Sunday?' });
  assert.equal(cardFor(p('post_message', { chat_id: 'chat-west', text: '  ' }), ctx('rider')).problem, 'There’s nothing to post.');
});

const DRAFT: RideDraft = { title: 'Daylesford lunch run', date: '2026-11-15', start: '09:00', end: '16:00', location: 'Caroline Springs', notes: 'Lunch at Daylesford', label: 'west' };
const draftInput = (d: RideDraft) => ({ title: d.title, date: d.date, start_time: d.start, end_time: d.end, location: d.location, notes: d.notes, label: d.label });

test('add_ride for a ride runner opens the calendar', () => {
  const card = cardFor(p('add_ride', draftInput(DRAFT)), ctx('sec'));
  assert.equal(card.heading, 'NEW RIDE');
  assert.equal(card.confirm, 'OPEN IN GOOGLE CALENDAR');
  assert.deepEqual(card.lines.slice(0, 4), ['Sun 15/11/2026 · 9:00 am – 4:00 pm', 'Daylesford lunch run', 'From: Caroline Springs', 'West']);
  assert.equal(card.lines.at(-1), 'Check it and press Save in Google Calendar. The app picks it up within 15 minutes.');
  assert.deepEqual(card.plan, { kind: 'open_calendar', url: calendarLink(DRAFT) });
});

test('add_ride for anyone else sends the idea to the Road Captain, else the President', () => {
  const card = cardFor(p('add_ride', draftInput(DRAFT)), ctx('rider'));
  assert.equal(card.confirm, 'SEND TO THE ROAD CAPTAIN');
  assert.equal(card.plan?.kind, 'send_idea');
  assert.equal(card.plan?.kind === 'send_idea' && card.plan.toId, 'rc');
  assert.match(card.plan?.kind === 'send_idea' ? card.plan.text : '', /Daylesford lunch run[\s\S]*Sun 15\/11\/2026/);
  const noRc = club({ positions: [...planningClub().positions, { id: 'p-pres', memberId: 'tre', chapterId: 'west', role: 'president', startedOn: '2025-01-01', endedOn: null }] });
  assert.equal(ideaRecipient(who(noRc, 'rider'), { ...noRc, positions: noRc.positions.filter((x) => x.role !== 'road_captain') })?.id, 'tre');
  const lonely = { ...noRc, positions: [] };
  const none = cardFor(p('add_ride', draftInput(DRAFT)), { me: who(lonely, 'rider'), data: lonely, chats: [], now: NOW });
  assert.equal(none.problem, 'Your chapter has no Road Captain or President in the app to send it to.');
});

test('calendar link uses Melbourne local times', () => {
  const url = new URL(calendarLink(DRAFT));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Daylesford lunch run');
  assert.equal(url.searchParams.get('dates'), '20261115T090000/20261115T160000');
  assert.equal(url.searchParams.get('ctz'), 'Australia/Melbourne');
  assert.equal(url.searchParams.get('location'), 'Caroline Springs');
  assert.equal(url.searchParams.get('details'), 'Lunch at Daylesford\n\nLabel: West');
  assert.equal(url.searchParams.get('src'), RIDES_CALENDAR);
  assert.equal(RIDES_CALENDAR, 'rsmc.ridecommitee@gmail.com');
  // No finish: four hours, kept inside the day.
  assert.equal(new URL(calendarLink({ ...DRAFT, end: '' })).searchParams.get('dates'), '20261115T090000/20261115T130000');
  assert.equal(new URL(calendarLink({ ...DRAFT, start: '21:30', end: '' })).searchParams.get('dates'), '20261115T213000/20261115T235900');
  // All day, across the month's end.
  assert.equal(new URL(calendarLink({ ...DRAFT, date: '2026-11-30', start: '', end: '' })).searchParams.get('dates'), '20261130/20261201');
  assert.equal(new URL(calendarLink({ ...DRAFT, label: 'non_nuts', notes: '' })).searchParams.get('details'), 'Label: Non-Nuts');
  assert.equal(new URL(calendarLink({ ...DRAFT, label: 'rustnuts' })).searchParams.get('details'), 'Lunch at Daylesford\n\nLabel: Rustnuts');
});

test('bad ride drafts', () => {
  assert.equal(rideDraftProblem(DRAFT, TODAY), null);
  assert.equal(rideDraftProblem({ ...DRAFT, title: ' ' }, TODAY), 'Give the ride a title.');
  assert.equal(rideDraftProblem({ ...DRAFT, date: '2026-10-31' }, TODAY), 'That day has passed.');
  assert.equal(rideDraftProblem({ ...DRAFT, date: '2026-02-30' }, TODAY), 'Pick the ride’s day.');
  assert.equal(rideDraftProblem({ ...DRAFT, date: '2027-11-02' }, TODAY), 'Pick a day within 12 months.');
  assert.equal(rideDraftProblem({ ...DRAFT, start: '9am' }, TODAY), 'Times are like 09:30.');
  assert.equal(rideDraftProblem({ ...DRAFT, start: '', end: '16:00' }, TODAY), 'Give a start time with the finish time.');
  assert.equal(rideDraftProblem({ ...DRAFT, end: '08:00' }, TODAY), 'The finish has to be after the start.');
  assert.equal(cardFor(p('add_ride', draftInput({ ...DRAFT, title: '' })), ctx('sec')).plan, null);
});

const Q1: ApiMessage = { role: 'user', content: [{ type: 'text', text: '<club_snapshot>\n{}\n</club_snapshot>' }, { type: 'text', text: 'Put me down for Sunday' }] };
const A1: ApiMessage = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: 'Here you go.' },
    { type: 'tool_use', id: 'tu_1', name: 'rsvp', input: { ride_id: 'r-west', answer: 'going' } },
    { type: 'tool_use', id: 'tu_2', name: 'join_crew', input: { ride_id: 'r-west', role: 'officer' } },
  ],
};

test('snapshot only on the first message', () => {
  const first = nextMessages([], {}, 'When’s the next ride?', '<club_snapshot>\n{}\n</club_snapshot>');
  assert.deepEqual(first, [{ role: 'user', content: [{ type: 'text', text: '<club_snapshot>\n{}\n</club_snapshot>' }, { type: 'text', text: 'When’s the next ride?' }] }]);
  const later = nextMessages([Q1, { role: 'assistant', content: [{ type: 'text', text: 'Sunday.' }] }], {}, 'Thanks', '<club_snapshot>\n{}\n</club_snapshot>');
  assert.deepEqual(later.at(-1), { role: 'user', content: [{ type: 'text', text: 'Thanks' }] });
});

test('unanswered proposals are closed before the next question, and history is append-only', () => {
  const history = [Q1, A1];
  assert.deepEqual(pendingToolIds(history), ['tu_1', 'tu_2']);
  const next = nextMessages(history, { tu_1: 'Done: answered Going.' }, 'And the bus?', null);
  assert.deepEqual(next.slice(0, 2), history);
  assert.deepEqual(next[2], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'Done: answered Going.' },
      { type: 'tool_result', tool_use_id: 'tu_2', content: NOT_CONFIRMED },
      { type: 'text', text: 'And the bus?' },
    ],
  });
  assert.equal(NOT_CONFIRMED, 'The member didn’t confirm this, so nothing was done.');
  assert.deepEqual(pendingToolIds(next), []);
});

test('a reply is added after the question; an empty one takes the question back', () => {
  const sent = nextMessages([], {}, 'Hi', 'snap');
  assert.deepEqual(withReply([], sent, { content: [{ type: 'text', text: 'G’day' }], text: 'G’day', proposals: [], note: null }), [
    ...sent, { role: 'assistant', content: [{ type: 'text', text: 'G’day' }] },
  ]);
  assert.deepEqual(withReply([], sent, { content: [], text: '', proposals: [], note: 'I can’t help with that one.' }), []);
});

test('a member who isn’t in the data still gets a sensible snapshot', () => {
  const data = club();
  const stranger = member('stranger');
  assert.doesNotThrow(() => buildSnapshot(stranger, data, [], NOW));
});
