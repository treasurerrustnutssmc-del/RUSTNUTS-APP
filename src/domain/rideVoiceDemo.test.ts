import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_COMMS_CAPTION, demoCallAudioMode, voiceNoteAudioMode } from './rideVoiceDemo';

test('the demo card says the riders and the audio are made up', () => {
  assert.equal(DEMO_COMMS_CAPTION, 'Demo: the other riders are made up, and this is sample audio.');
});

test('the demo call plays behind a locked phone while on, and lets go of the background when it ends', () => {
  assert.deepEqual(demoCallAudioMode('connect'), { playsInSilentMode: true, shouldPlayInBackground: true });
  assert.deepEqual(demoCallAudioMode('disconnect'), { playsInSilentMode: true, shouldPlayInBackground: false });
});

test('a voice note keeps background audio on while a ride call is up, and leaves it alone otherwise', () => {
  assert.deepEqual(voiceNoteAudioMode(true, true), { allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
  assert.deepEqual(voiceNoteAudioMode(false, true), { allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true });
  assert.deepEqual(voiceNoteAudioMode(true, false), { allowsRecording: true, playsInSilentMode: true });
  assert.deepEqual(voiceNoteAudioMode(false, false), { allowsRecording: false, playsInSilentMode: true });
});
