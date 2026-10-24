import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHangUp, VOICE_MSG, voiceRoster, voiceStatus, type VoiceParticipant } from './rideVoice';
import type { Ride } from './types';

const p = (id: string, name: string, over: Partial<VoiceParticipant> = {}): VoiceParticipant => ({ id, name, speaking: false, muted: false, ...over });

test('the roster puts me first, then whoever is talking, then by name', () => {
  const roster = voiceRoster([p('c', 'Zed'), p('b', 'Ace'), p('me', 'Rusty', { muted: true }), p('d', 'Moz', { speaking: true })], 'me');
  assert.deepEqual(roster.map((x) => x.id), ['me', 'd', 'b', 'c']);
});

test('the status line says where the call is and how many are on', () => {
  assert.equal(voiceStatus('idle', 0, false), 'Not connected');
  assert.equal(voiceStatus('connecting', 0, false), 'Connecting…');
  assert.equal(voiceStatus('connected', 4, false), 'On air · 4 riders');
  assert.equal(voiceStatus('connected', 1, true), 'Muted · 1 rider');
  assert.equal(voiceStatus('reconnecting', 4, false), 'Reconnecting…');
  assert.equal(voiceStatus('failed', 0, false), 'Dropped. Tap Connect to try again.');
});

test('the call ends itself when the live window closes or the ride is called off', () => {
  const ride: Ride = {
    id: 'r1', title: 'Run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: '2026-11-08T01:00:00.000Z',
    allDay: false, location: null, notes: null, category: 'west', cancelledAt: null,
  };
  assert.equal(shouldHangUp(ride, '2026-11-08T02:59:00.000Z'), false);
  assert.equal(shouldHangUp(ride, '2026-11-08T03:00:00.000Z'), true);
  assert.equal(shouldHangUp({ ...ride, cancelledAt: '2026-11-07T20:00:00.000Z' }, '2026-11-07T22:00:00.000Z'), true);
  assert.equal(shouldHangUp(undefined, '2026-11-07T22:00:00.000Z'), true);
});

test('the words for a refused microphone and an old build', () => {
  assert.equal(VOICE_MSG.micDenied, 'Rustnuts needs the microphone for ride comms. Turn it on in your phone’s settings.');
  assert.equal(VOICE_MSG.updateApp, 'Ride comms needs the latest version of the app.');
  assert.equal(VOICE_MSG.screenOff, 'Your phone didn’t let ride comms carry on with the screen off. Disconnect, then Connect again with Rustnuts open.');
});
