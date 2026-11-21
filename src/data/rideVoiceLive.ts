// Lane E: ride comms. The LiveKit side of a ride's voice call: audio set up for a helmet headset,
// an open mic with the phone's noise suppression and the voice gate, and who's on. Only loaded on phone builds that
// have LiveKit's native modules (see rideVoice.tsx).

import { AndroidAudioTypePresets, AudioSession, registerGlobals, setupIOSAudioManagement } from '@livekit/react-native';
import { Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { VoiceParticipant, VoiceState } from '../domain/rideVoice';
import { createVoiceGate, type NoiseFilter } from '../domain/voiceGate';

let prepared = false;

function prepare() {
  if (prepared) return;
  registerGlobals({ autoConfigureAudioSession: false });
  if (Platform.OS === 'ios') {
    // Voice chat mode is Apple's voice processing (noise and echo); Bluetooth lets the helmet's mic
    // in; defaultToSpeaker puts the call on the speaker, not the earpiece, when no headset is on.
    // No mixWithOthers: a mixable session can't own Now Playing, which the headset-button mute needs.
    const call = { audioCategory: 'playAndRecord', audioCategoryOptions: ['allowBluetooth', 'defaultToSpeaker'], audioMode: 'voiceChat' } as const;
    // The first argument (preferSpeakerOutput) is ignored once a policy is given; the policy decides.
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
  /** Changes the road noise filter mid-call. */
  setNoiseFilter?: (filter: NoiseFilter) => void;
}

interface GateTrack {
  id: string;
  enabled: boolean;
  _peerConnectionId?: number;
}

/**
 * The voice gate on a live call: LiveKit's own level meter on your mic (already in the app's phone
 * build) feeds the gate, and the gate switches the mic's sound on and off while you stay "on air".
 * Muting still wins. If the meter goes quiet or can't start, the mic stays open, so the worst case
 * is the old open mic, never a rider nobody can hear.
 */
function startVoiceGate(room: Room, initial: NoiseFilter) {
  const lk = NativeModules.LivekitReactNativeModule as
    | {
        createVolumeProcessor?: (pcId: number, trackId: string) => string;
        deleteVolumeProcessor?: (tag: string, pcId: number, trackId: string) => boolean;
      }
    | undefined;
  const gate = createVoiceGate(initial);
  let filter = initial;
  let attached: { track: GateTrack; tag: string } | null = null;
  let heardAt = 0;

  const micTrack = () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mst = pub?.track?.mediaStreamTrack as unknown as GateTrack | undefined;
    return { mst, muted: !pub || pub.isMuted };
  };
  const apply = (open: boolean) => {
    const { mst, muted } = micTrack();
    if (!mst || muted || mst !== attached?.track) return;
    if (mst.enabled !== open) mst.enabled = open;
  };
  const detach = () => {
    if (!attached) return;
    const { track, tag } = attached;
    attached = null;
    try {
      lk?.deleteVolumeProcessor?.(tag, track._peerConnectionId ?? -1, track.id);
    } catch {
      // Already gone with the track.
    }
  };

  let sub: { remove: () => void } | null = null;
  try {
    sub = new NativeEventEmitter(NativeModules.LivekitReactNativeModule).addListener('LK_VOLUME_PROCESSED', (e: { id?: string; volume?: number }) => {
      if (!attached || e.id !== attached.tag) return;
      heardAt = Date.now();
      apply(gate.feed(typeof e.volume === 'number' ? e.volume : 0, heardAt));
    });
  } catch {
    sub = null;
  }

  // Keeps the meter on the mic that's actually sending (a reconnect or a headset swap makes a new
  // one), and opens the mic if the meter has gone quiet.
  const check = () => {
    const { mst, muted } = micTrack();
    if (filter === 'off' || !sub || !lk?.createVolumeProcessor) {
      detach();
      if (mst && !muted && !mst.enabled) mst.enabled = true;
      return;
    }
    if (mst && mst !== attached?.track) {
      detach();
      try {
        const tag = lk.createVolumeProcessor(mst._peerConnectionId ?? -1, mst.id);
        if (tag) {
          attached = { track: mst, tag };
          heardAt = Date.now();
        }
      } catch {
        // Tried again next second; the mic stays open meanwhile.
      }
    }
    if (mst && !muted && !mst.enabled && Date.now() - heardAt > 1500) mst.enabled = true;
  };
  check();
  const timer = setInterval(check, 1000);

  return {
    setFilter: (next: NoiseFilter) => {
      filter = next;
      gate.setFilter(next);
      check();
    },
    stop: () => {
      clearInterval(timer);
      sub?.remove();
      sub = null;
      const { mst, muted } = micTrack();
      detach();
      if (mst && !muted) mst.enabled = true;
    },
  };
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
export async function joinCall(url: string, token: string, events: CallEvents, noiseFilter: NoiseFilter = 'off'): Promise<Call> {
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
  let gate: ReturnType<typeof startVoiceGate> | null = null;
  async function hangUp() {
    if (ended) return;
    ended = true;
    gate?.stop();
    gate = null;
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
  try {
    gate = startVoiceGate(room, noiseFilter);
  } catch {
    gate = null; // an open mic, as before
  }
  tell();
  return {
    setMuted: async (muted) => {
      await room.localParticipant.setMicrophoneEnabled(!muted);
      tell();
    },
    hangUp,
    setNoiseFilter: (filter) => gate?.setFilter(filter),
  };
}
