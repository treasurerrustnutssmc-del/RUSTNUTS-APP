// Lane E: ride comms. The LiveKit side of a ride's voice call: audio set up for a helmet headset,
// an open mic with the phone's noise suppression, and who's on. Only loaded on phone builds that
// have LiveKit's native modules (see rideVoice.tsx).

import { AndroidAudioTypePresets, AudioSession, registerGlobals, setupIOSAudioManagement } from '@livekit/react-native';
import { Room, RoomEvent, type Participant } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import type { VoiceParticipant, VoiceState } from '../domain/rideVoice';

let prepared = false;

function prepare() {
  if (prepared) return;
  registerGlobals({ autoConfigureAudioSession: false });
  if (Platform.OS === 'ios') {
    // Voice chat mode is Apple's voice processing (noise and echo); Bluetooth lets the helmet's mic in.
    const call = { audioCategory: 'playAndRecord', audioCategoryOptions: ['allowBluetooth'], audioMode: 'voiceChat' } as const;
    setupIOSAudioManagement(true, { recording: { ...call, audioCategoryOptions: [...call.audioCategoryOptions] }, playout: { ...call, audioCategoryOptions: [...call.audioCategoryOptions] } });
  }
  prepared = true;
}

export interface CallEvents {
  onState: (state: VoiceState) => void;
  onPeople: (people: VoiceParticipant[]) => void;
}

export interface Call {
  setMuted: (muted: boolean) => Promise<void>;
  hangUp: () => Promise<void>;
}

const person = (p: Participant, speaking: Set<string>): VoiceParticipant => ({
  id: p.identity,
  name: p.name || 'Rider',
  speaking: speaking.has(p.identity),
  muted: !p.isMicrophoneEnabled,
});

/**
 * Asks for the microphone (and on Android 12 on, the helmet's Bluetooth). Run first, before any
 * network wait, while the rider is still looking at the app: that's when Android lets the
 * screen-off service start. Throws a NotAllowedError when the mic is refused.
 */
export async function prepareMic(): Promise<void> {
  prepare();
  if (Platform.OS !== 'android') return; // iOS asks when the mic first goes on
  const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (mic !== PermissionsAndroid.RESULTS.GRANTED) throw Object.assign(new Error('Microphone permission refused'), { name: 'NotAllowedError' });
  // Without this the phone's own mic and speaker are used instead of the helmet's.
  if (Number(Platform.Version) >= 31) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT).catch(() => undefined);
}

/** Joins the room with the microphone on (after prepareMic). Throws when the room can't be reached. */
export async function joinCall(url: string, token: string, events: CallEvents): Promise<Call> {
  prepare();
  if (Platform.OS === 'android') {
    await AudioSession.configureAudio({
      android: { preferredOutputList: ['bluetooth', 'headset', 'speaker'], audioTypeOptions: AndroidAudioTypePresets.communication },
    });
    await AudioSession.startAudioSession();
  }
  // iOS: the audio session follows the call by itself (setupIOSAudioManagement above).

  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
  });
  let speaking = new Set<string>();
  const tell = () =>
    events.onPeople([room.localParticipant, ...room.remoteParticipants.values()].map((p) => person(p, speaking)));
  room
    .on(RoomEvent.ParticipantConnected, tell)
    .on(RoomEvent.ParticipantDisconnected, tell)
    .on(RoomEvent.TrackMuted, tell)
    .on(RoomEvent.TrackUnmuted, tell)
    .on(RoomEvent.LocalTrackPublished, tell)
    .on(RoomEvent.TrackPublished, tell)
    .on(RoomEvent.TrackUnpublished, tell)
    .on(RoomEvent.ParticipantNameChanged, tell)
    .on(RoomEvent.ActiveSpeakersChanged, (now) => {
      speaking = new Set(now.map((p) => p.identity));
      tell();
    })
    .on(RoomEvent.Reconnecting, () => events.onState('reconnecting'))
    .on(RoomEvent.Reconnected, () => {
      events.onState('connected');
      tell();
    })
    .on(RoomEvent.Disconnected, () => {
      // Tidied up here too, so the phone's audio goes back to normal (music, maps) after a drop.
      void hangUp();
      events.onState('failed');
    });

  let ended = false;
  async function hangUp() {
    if (ended) return;
    ended = true;
    room.removeAllListeners();
    await room.disconnect().catch(() => undefined);
    if (Platform.OS === 'android') await AudioSession.stopAudioSession().catch(() => undefined);
  }
  try {
    await room.connect(url, token, { autoSubscribe: true });
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (e) {
    await hangUp();
    throw e;
  }
  tell();
  return {
    setMuted: async (muted) => {
      await room.localParticipant.setMicrophoneEnabled(!muted);
      tell();
    },
    hangUp,
  };
}
