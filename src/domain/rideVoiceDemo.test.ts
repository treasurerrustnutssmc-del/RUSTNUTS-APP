import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_COMMS_CAPTION,
  demoCallAudioMode,
  VOICE_NOTES_OFF_ON_CALL,
  voiceNoteAudioMode,
  voiceNoteCleanupMode,
  voiceNoteOffHint,
} from './rideVoiceDemo';

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

test('voice notes are off, with a hint saying so, while a ride call is up', () => {
  assert.equal(voiceNoteOffHint(true), VOICE_NOTES_OFF_ON_CALL);
  assert.equal(VOICE_NOTES_OFF_ON_CALL, 'Voice notes are off while ride comms is on');
  assert.equal(voiceNoteOffHint(false), null);
});

test('on an iPhone a recorder closing during a ride call leaves the call’s audio settings alone', () => {
  // iOS: allowsRecording false is the playback category, which takes the call's microphone away.
  assert.equal(voiceNoteCleanupMode('ios', true), null);
  assert.deepEqual(voiceNoteCleanupMode('ios', false), { allowsRecording: false, playsInSilentMode: true });
  assert.deepEqual(voiceNoteCleanupMode('android', true), voiceNoteAudioMode(false, true));
  assert.deepEqual(voiceNoteCleanupMode('web', false), voiceNoteAudioMode(false, false));
});
