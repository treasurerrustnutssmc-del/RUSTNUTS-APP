// Lane E: ride comms. The LiveKit side of a ride's voice call: audio set up for a helmet headset,
// an open mic with the phone's noise suppression and the voice gate, and who's on. Only loaded on phone builds that
// have LiveKit's native modules (see rideVoice.tsx).

import { AndroidAudioTypePresets, AudioSession, registerGlobals, setupIOSAudioManagement } from '@livekit/react-native';
import { Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { VoiceParticipant, VoiceState } from '../domain/rideVoice';
import { createMeterCheck, createVoiceGate, pcm16Level, type NoiseFilter } from '../domain/voiceGate';

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

type LiveKitNative = {
  createVolumeProcessor?: (pcId: number, trackId: string) => string;
  deleteVolumeProcessor?: (tag: string, pcId: number, trackId: string) => boolean;
  createAudioSinkListener?: (pcId: number, trackId: string) => string;
  deleteAudioSinkListener?: (tag: string, pcId: number, trackId: string) => boolean;
};

/**
 * The voice gate on a live call: your mic's level feeds the gate, and the gate switches the mic's
 * sound on and off while you stay "on air". Muting still wins. The level comes from LiveKit's
 * native code already in the phone build: on Android the raw mic samples (LiveKit's own Android
 * level meter reads them in the wrong byte order, so it can't be used), on iPhone its level meter.
 * Anything odd (no meter, a meter that goes quiet or reads a flat line, the mic being swapped) and
 * the gate steps aside for the rest of the call and leaves the mic open: the worst case is the old
 * open mic, never a rider nobody can hear.
 */
function startVoiceGate(room: Room, initial: NoiseFilter) {
  const lk = NativeModules.LivekitReactNativeModule as LiveKitNative | undefined;
  const android = Platform.OS === 'android';
  const create = android ? lk?.createAudioSinkListener : lk?.createVolumeProcessor;
  const remove = android ? lk?.deleteAudioSinkListener : lk?.deleteVolumeProcessor;
  const gate = createVoiceGate(initial);
  const meterCheck = createMeterCheck();
  let filter = initial;
  let attached: { track: GateTrack; tag: string } | null = null;
  let tries = 0;
  let broken = false;
  let heardAt = 0;

  const micTrack = () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mst = pub?.track?.mediaStreamTrack as unknown as GateTrack | undefined;
    return { mst, muted: !pub || pub.isMuted };
  };
  const openMic = () => {
    const { mst, muted } = micTrack();
    if (mst && !muted && !mst.enabled) mst.enabled = true;
  };
  const detach = () => {
    if (!attached) return;
    const { track, tag } = attached;
    attached = null;
    try {
      remove?.call(lk, tag, track._peerConnectionId ?? -1, track.id);
    } catch {
      // Already gone with the track.
    }
  };
  let sub: { remove: () => void } | null = null;
  const giveUp = () => {
    broken = true;
    sub?.remove();
    sub = null;
    detach();
    openMic();
  };

  const hear = (level: number) => {
    if (broken) return;
    const now = Date.now();
    heardAt = now;
    if (meterCheck(level, now) === 'broken') return giveUp();
    const open = gate.feed(level, now);
    const { mst, muted } = micTrack();
    if (!mst || muted || mst !== attached?.track) return;
    if (mst.enabled !== open) mst.enabled = open;
  };

  try {
    sub = new NativeEventEmitter(NativeModules.LivekitReactNativeModule).addListener(
      android ? 'LK_AUDIO_DATA' : 'LK_VOLUME_PROCESSED',
      (e: { id?: string; data?: string; volume?: number }) => {
        if (!attached || e.id !== attached.tag) return;
        hear(android ? pcm16Level(e.data ?? '', atob) : typeof e.volume === 'number' ? e.volume : 0);
      },
    );
  } catch {
    sub = null;
  }

  // Puts the meter on the mic, and opens the mic if the meter's gone quiet.
  const check = () => {
    if (broken) return;
    const { mst, muted } = micTrack();
    if (!sub || !create) return giveUp();
    if (filter === 'off') {
      detach();
      openMic();
      return;
    }
    if (mst && attached && mst !== attached.track) return giveUp(); // swapped mid-call: keep it simple
    if (mst && !attached) {
      if (++tries > 3) return giveUp();
      try {
        const tag = create.call(lk, mst._peerConnectionId ?? -1, mst.id);
        if (tag) {
          attached = { track: mst, tag };
          tries = 0;
          heardAt = Date.now();
        }
      } catch {
        // Tried again shortly; the mic stays open meanwhile.
      }
      return;
    }
    if (mst && !muted && !mst.enabled && Date.now() - heardAt > 1000) giveUp();
  };
  check();
  const timer = setInterval(check, 500);

  return {
    setFilter: (next: NoiseFilter) => {
      filter = next;
      gate.setFilter(next);
      if (next !== 'off' && !attached) tries = 0;
      check();
    },
    stop: () => {
      clearInterval(timer);
      giveUp();
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
