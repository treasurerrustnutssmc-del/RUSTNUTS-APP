import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_CHANNELS, RETIRED_ANDROID_CHANNELS, DEFAULT_PREFS, completePrefs, notificationTarget, phoneNotificationState, REV_SOUND, reminderDiff, reminderPlan, showWhileOpen, soundFor, type Reminder,
} from './notifications';
import type { Ride, Rsvp } from './types';

const NOW = '2026-11-05T00:00:00.000Z';
const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1', title: 'West breakfast run', startsAt: '2026-11-06T21:30:00.000Z', endsAt: '2026-11-07T01:00:00.000Z',
  allDay: false, location: 'BP Ravenhall', notes: null, category: 'west', cancelledAt: null, ...over,
});
const going = (rideId: string, answer: Rsvp['answer'] = 'going'): Rsvp => ({ rideId, memberId: 'm-me', answer, updatedAt: NOW });

test('a ride you’re going to: a reminder 2 hours before', () => {
  assert.deepEqual(reminderPlan([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW), [
    { id: 'ride-r-1', rideId: 'r-1', at: '2026-11-06T19:30:00.000Z', title: 'Ride in 2 hours', body: 'West breakfast run · 8:30 am · BP Ravenhall',
      channelId: 'ride-reminders-rev2', sound: 'v_twin_rev_2.wav' },
  ]);
  assert.equal(reminderPlan([ride({ location: null })], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW)[0].body, 'West breakfast run · 8:30 am');
});

test('an all-day ride: 7 am Melbourne time on its first day, daylight saving or not', () => {
  const allDay = ride({ allDay: true, startsAt: '2026-11-06T13:00:00.000Z', endsAt: '2026-11-08T13:00:00.000Z', title: 'Camp weekend' });
  assert.deepEqual(reminderPlan([allDay], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW)[0], {
    id: 'ride-r-1', rideId: 'r-1', at: '2026-11-06T20:00:00.000Z', title: 'Ride today', body: 'Camp weekend · All day · BP Ravenhall',
    channelId: 'ride-reminders-rev2', sound: 'v_twin_rev_2.wav',
  });
  // Clocks go forward at 2 am on Sunday 4 October 2026.
  const dstDay = ride({ allDay: true, startsAt: '2026-10-03T14:00:00.000Z', endsAt: '2026-10-04T13:00:00.000Z' });
  assert.equal(reminderPlan([dstDay], [going('r-1')], 'm-me', DEFAULT_PREFS, '2026-10-01T00:00:00.000Z')[0].at, '2026-10-03T20:00:00.000Z');
});

test('no reminder for maybe, can’t, cancelled, past, turned off, or nobody signed in', () => {
  const none = (rides: Ride[], rsvps: Rsvp[], meId: string | null = 'm-me', prefs = DEFAULT_PREFS, now = NOW) =>
    assert.deepEqual(reminderPlan(rides, rsvps, meId, prefs, now), []);
  none([ride()], [going('r-1', 'maybe')]);
  none([ride()], [going('r-1', 'no')]);
  none([ride()], [{ ...going('r-1'), memberId: 'm-else' }]);
  none([ride({ cancelledAt: NOW })], [going('r-1')]);
  none([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, '2026-11-06T20:00:00.000Z');
  none([ride()], [going('r-1')], 'm-me', { ...DEFAULT_PREFS, rideReminders: false });
  none([ride()], [going('r-1')], null);
});

test('the soonest 30 only, so the phone never runs out of room', () => {
  const rides = Array.from({ length: 40 }, (_, i) =>
    ride({ id: `r-${i}`, startsAt: new Date(Date.parse('2026-11-06T21:30:00.000Z') + (39 - i) * 86_400_000).toISOString(), endsAt: null }));
  const plan = reminderPlan(rides, rides.map((r) => going(r.id)), 'm-me', DEFAULT_PREFS, NOW);
  assert.equal(plan.length, 30);
  assert.equal(plan[0].rideId, 'r-39', 'soonest first');
  assert.ok(plan.every((r, i) => i === 0 || r.at >= plan[i - 1].at));
});

test('what to schedule and cancel', () => {
  const r = (id: string, at: string): Reminder => ({ id, rideId: id, at, title: 't', body: 'b', channelId: 'ride-reminders', sound: 'default' });
  const plan = [r('ride-a', '2026-11-06T19:30:00.000Z'), r('ride-b', '2026-11-07T19:30:00.000Z'), r('ride-c', '2026-11-08T19:30:00.000Z')];
  const scheduled = [
    { id: 'ride-a', at: '2026-11-06T19:30:00.000Z' }, // unchanged
    { id: 'ride-b', at: '2026-11-07T18:30:00.000Z' }, // moved
    { id: 'ride-z', at: '2026-11-09T19:30:00.000Z' }, // no longer wanted
  ];
  const { add, cancel } = reminderDiff(plan, scheduled);
  assert.deepEqual(add.map((x) => x.id), ['ride-b', 'ride-c']);
  assert.deepEqual(cancel.sort(), ['ride-b', 'ride-z']);
  assert.deepEqual(reminderDiff([], scheduled).cancel.sort(), ['ride-a', 'ride-b', 'ride-z'], 'turned off: all of them go');
  const renamed = reminderDiff([r('ride-a', '2026-11-06T19:30:00.000Z')], [{ id: 'ride-a', at: '2026-11-06T19:30:00.000Z', body: 'old name' }]);
  assert.deepEqual([renamed.add.map((x) => x.id), renamed.cancel], [['ride-a'], ['ride-a']], 'a renamed ride gets the new text');
});

test('a ride called off or postponed gets no reminder; one back on does', () => {
  const call = (state: 'off' | 'postponed' | 'on') => [{ rideId: 'r-1', state, reason: '', newDay: null, calledBy: 'm-rc', calledAt: NOW }];
  assert.deepEqual(reminderPlan([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW, call('off')), []);
  assert.deepEqual(reminderPlan([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW, call('postponed')), []);
  assert.equal(reminderPlan([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW, call('on')).length, 1);
});

test('the Harley rev is on unless a member switches it off', () => {
  assert.equal(DEFAULT_PREFS.revSound, true);
  assert.equal(REV_SOUND, 'v_twin_rev_2.wav');
});

test('reminders and club news rev; live ride alerts always use the urgent sound', () => {
  assert.deepEqual(soundFor('reminder', true), { channelId: 'ride-reminders-rev2', sound: 'v_twin_rev_2.wav' });
  assert.deepEqual(soundFor('reminder', false), { channelId: 'ride-reminders', sound: 'default' });
  assert.deepEqual(soundFor('club', true), { channelId: 'club-rev2', sound: 'v_twin_rev_2.wav' });
  assert.deepEqual(soundFor('club', false), { channelId: 'club', sound: 'default' });
  assert.deepEqual(soundFor('live-alert', true), { channelId: 'ride-alerts', sound: 'default' });
  assert.deepEqual(soundFor('live-alert', false), { channelId: 'ride-alerts', sound: 'default' });
});

test('every channel a notification can use is one the phone sets up, with the matching sound', () => {
  const ids = new Set(ANDROID_CHANNELS.map((c) => c.id));
  assert.equal(ids.size, ANDROID_CHANNELS.length, 'no channel twice');
  for (const kind of ['reminder', 'club', 'chat', 'live-alert'] as const) {
    for (const rev of [true, false]) {
      const { channelId, sound } = soundFor(kind, rev);
      assert.equal(ANDROID_CHANNELS.find((c) => c.id === channelId)?.sound, sound, `${kind} ${rev}`);
    }
  }
});

test('switching the rev off moves reminders to the plain sound', () => {
  const [r] = reminderPlan([ride()], [going('r-1')], 'm-me', { ...DEFAULT_PREFS, revSound: false }, NOW);
  assert.deepEqual([r.channelId, r.sound], ['ride-reminders', 'default']);
});

test('a reminder scheduled with the other sound is replaced; one from before the rev counts as the plain sound', () => {
  const [r] = reminderPlan([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW);
  assert.deepEqual(reminderDiff([r], [{ id: r.id, at: r.at, body: r.body, sound: 'default' }]), { add: [r], cancel: [r.id] });
  assert.deepEqual(reminderDiff([r], [{ id: r.id, at: r.at, body: r.body }]), { add: [r], cancel: [r.id] });
  assert.deepEqual(reminderDiff([r], [{ id: r.id, at: r.at, body: r.body, sound: REV_SOUND }]), { add: [], cancel: [] });
  const [plain] = reminderPlan([ride()], [going('r-1')], 'm-me', { ...DEFAULT_PREFS, revSound: false }, NOW);
  assert.deepEqual(reminderDiff([plain], [{ id: r.id, at: r.at, body: r.body }]), { add: [], cancel: [] });
});

test('settings saved on the phone before the rev get it switched on; unknown stays unknown', () => {
  const old = { rideReminders: false, rideChanges: true, newRides: true, approvals: false } as never;
  assert.deepEqual(completePrefs(old), { rideReminders: false, rideChanges: true, newRides: true, approvals: false, revSound: true, chatMessages: true });
  assert.equal(completePrefs(null), null);
  assert.equal(completePrefs(undefined), undefined);
});

test('chat notifications are on unless a member switches them off', () => {
  assert.equal(DEFAULT_PREFS.chatMessages, true);
});

test('chat has its own channels, so a member can quiet chat in the phone’s settings and keep ride news', () => {
  assert.deepEqual(soundFor('chat', true), { channelId: 'chat-rev2', sound: REV_SOUND });
  assert.deepEqual(soundFor('chat', false), { channelId: 'chat', sound: 'default' });
});

test('tapping a notification opens what it’s about', () => {
  assert.deepEqual(notificationTarget({ kind: 'chat', chatId: 'c1' }), { screen: 'Chat', params: { chatId: 'c1' } });
  assert.deepEqual(notificationTarget({ kind: 'ride', rideId: 'r1' }), { screen: 'RideDetail', params: { rideId: 'r1' } });
  assert.deepEqual(notificationTarget({ kind: 'ride-reminder', rideId: 'r1' }), { screen: 'RideDetail', params: { rideId: 'r1' } });
  assert.deepEqual(notificationTarget({ kind: 'live-alert', rideId: 'r1' }), { screen: 'LiveRide', params: { rideId: 'r1' } });
  assert.equal(notificationTarget({ kind: 'chat' }), null, 'no chat named');
  assert.equal(notificationTarget({ kind: 'chat', chatId: 7 }), null, 'not an id');
  assert.deepEqual(notificationTarget({ kind: 'feedback', feedbackId: 'f1' }), { screen: 'Feedback', params: undefined }, 'a reply: your reports');
  assert.deepEqual(notificationTarget({ kind: 'feedback-sent', feedbackId: 'f1' }), { screen: 'Tabs', params: { screen: 'Board' } }, 'a new one: the Board screen');
  assert.equal(notificationTarget({ kind: 'applicant' }), null, 'nothing particular to open');
  assert.equal(notificationTarget(undefined), null);
});

test('a chat message isn’t shown as a banner while that chat is on screen', () => {
  assert.equal(showWhileOpen({ kind: 'chat', chatId: 'c1' }, 'c1'), false);
  assert.equal(showWhileOpen({ kind: 'chat', chatId: 'c2' }, 'c1'), true);
  assert.equal(showWhileOpen({ kind: 'chat', chatId: 'c1' }, null), true);
  assert.equal(showWhileOpen({ kind: 'live-alert', rideId: 'r1' }, 'c1'), true);
  assert.equal(showWhileOpen(undefined, 'c1'), true);
});

test('phone notification state: on, can be asked, or blocked in the phone settings', () => {
  assert.equal(phoneNotificationState({ granted: true, canAskAgain: true }), 'on');
  assert.equal(phoneNotificationState({ granted: false, canAskAgain: true }), 'ask');
  assert.equal(phoneNotificationState({ granted: false, canAskAgain: false }), 'blocked');
  assert.equal(phoneNotificationState(null), 'unknown', 'not read yet, or the web: say nothing');
});

test('the first, harsh rev channels are retired and never reused', () => {
  // Android fixes a channel's sound once it exists, so the new rev needs new channel ids, and the
  // old ones are deleted so phones don't list them in settings.
  assert.deepEqual(RETIRED_ANDROID_CHANNELS, ['ride-reminders-rev', 'club-rev', 'chat-rev']);
  for (const id of RETIRED_ANDROID_CHANNELS) assert.ok(!ANDROID_CHANNELS.some((c) => c.id === id), id);
});
