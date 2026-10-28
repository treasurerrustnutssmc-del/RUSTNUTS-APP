// Voice notes in chat: the bar that records one (in place of the message box), and the bubble that
// plays one back. Recording is a tap to start, not a hold, so it works in gloves.

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { VoiceRecording } from '../data/chat/chatContext';
import { useRideVoice } from '../data/rideVoice';
import { MAX_VOICE_MS, VOICE_BROKEN, type MessageMedia } from '../domain/chat';
import { colors, fonts, radius, space } from '../theme';
import { useMediaSource } from './ChatBits';
import { Ionicons } from './primitives';

/** Shorter than this is a slip of the thumb, so it can't be sent. */
const MIN_VOICE_MS = 1000;

// Speech, not music: one channel at 64 kbps keeps two minutes near 1 MB. Browsers record AAC (MP4)
// when they can, because iPhones can't play WebM; older Chrome and Firefox only do WebM.
const webType =
  Platform.OS === 'web' && typeof MediaRecorder !== 'undefined'
    ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm'
    : 'audio/webm';
const VOICE_PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  web: { mimeType: webType, bitsPerSecond: 64000 },
};

const MIC_OFF = 'Rustnuts needs the microphone for that. Turn it on in your phone’s settings.';

/** True while a ride call holds the phone's audio: voice notes then leave the audio settings alone. */
export function useOnRideCall(): boolean {
  const { state } = useRideVoice();
  return state === 'connecting' || state === 'connected' || state === 'reconnecting';
}

/** "1:05" from milliseconds. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Records as soon as it's on screen. Bin throws it away; send hands the recording over. It stops by
 *  itself at two minutes and waits. */
export function VoiceRecorderBar({
  onSend,
  onCancel,
  onError,
  sending,
}: {
  onSend: (r: VoiceRecording) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  sending: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const live = useRef(true);
  const lastMs = useRef(0);
  const busy = useRef(false); // two quick taps on send make one voice note
  // At the limit the recorder stops by itself, and the bar waits to be sent or thrown away. A
  // recording that failed (the phone's own error) can't be sent.
  const recorder = useAudioRecorder(VOICE_PRESET, (status) => {
    if (!live.current || !status.isFinished) return;
    if (status.hasError) return onError(VOICE_BROKEN);
    setStoppedAt(lastMs.current >= MAX_VOICE_MS - 1000 ? MAX_VOICE_MS : lastMs.current);
  });
  const state = useAudioRecorderState(recorder, 250);
  useEffect(() => {
    if (state.durationMillis > 0) lastMs.current = state.durationMillis;
  }, [state.durationMillis]);

  useEffect(() => {
    live.current = true;
    const ready = (async () => {
      try {
        const allowed = await requestRecordingPermissionsAsync();
        if (!allowed.granted) throw new Error(MIC_OFF);
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        // Binned while the microphone was opening: start and stop at once, so the browser lets go of it.
        recorder.record({ forDuration: MAX_VOICE_MS / 1000 });
        if (live.current) setStarted(true);
      } catch (e) {
        if (live.current) onError((e as Error).message === MIC_OFF ? MIC_OFF : VOICE_BROKEN);
      }
    })();
    return () => {
      live.current = false;
      // Leaving the chat mid-recording throws it away, once the microphone has finished opening.
      // Playback goes back to the speaker.
      ready.finally(() => {
        recorder.stop().catch(() => undefined);
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = Math.min(stoppedAt ?? state.durationMillis, MAX_VOICE_MS);

  const send = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const durationMs = Math.min(stoppedAt ?? (recorder.getStatus().durationMillis || lastMs.current), MAX_VOICE_MS);
      if (stoppedAt === null) await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error(VOICE_BROKEN);
      // On the web the recording is a blob, and its type says what the browser recorded.
      const mimeType = Platform.OS === 'web' ? (await (await fetch(uri)).blob()).type || null : null;
      onSend({ kind: 'voice', uri, durationMs: Math.round(durationMs), mimeType });
    } catch {
      onError(VOICE_BROKEN);
    } finally {
      busy.current = false;
    }
  };

  const canSend = started && elapsed >= MIN_VOICE_MS && !sending;
  // Stopped at the limit, or paused by the phone (an iPhone pauses it when the app goes to the background).
  const done = stoppedAt !== null || (started && !state.isRecording && state.durationMillis > 0);
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Throw away the voice note"
        style={({ pressed }) => [styles.square, pressed && { backgroundColor: colors.steel }]}
      >
        <Ionicons name="trash-outline" size={22} color={colors.boneDim} />
      </Pressable>
      <View style={styles.status} accessibilityLiveRegion="polite">
        <View style={[styles.dot, done && { backgroundColor: colors.boneMute }]} />
        <Text style={styles.clock} accessibilityLabel={`${done ? 'Recorded' : 'Recording'} ${clock(elapsed)} of 2 minutes`}>
          {clock(elapsed)} / {clock(MAX_VOICE_MS)}
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          {done ? 'Ready to send' : started ? 'Recording' : 'Starting…'}
        </Text>
      </View>
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send voice note"
        accessibilityState={{ disabled: !canSend, busy: sending }}
        style={({ pressed }) => [styles.square, styles.send, pressed && { backgroundColor: colors.red }, !canSend && { opacity: 0.45 }]}
      >
        <Ionicons name="send" size={18} color={colors.bone} />
      </Pressable>
    </View>
  );
}

/** The one voice note playing: starting another pauses it. */
let nowPlaying: { pause: () => void } | null = null;

/** A voice note in a message: play and pause, how far through, and how long it is. */
export function VoiceNote({ media, width }: { media: Pick<MessageMedia, 'path' | 'durationMs'>; width: number }) {
  const source = useMediaSource(media.path);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const onCall = useOnRideCall();
  const broken = !!status.error;
  const ready = source !== null && !broken;
  const length = media.durationMs ?? Math.round((status.duration || 0) * 1000);
  const at = Math.min(Math.round(status.currentTime * 1000), length);

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => undefined);
    }
  }, [status.didJustFinish, player]);

  const toggle = async () => {
    if (!ready) return; // still fetching; the press stays here rather than selecting the message
    if (status.playing) return player.pause();
    if (nowPlaying && nowPlaying !== player) nowPlaying.pause();
    nowPlaying = player;
    // On a ride call the call's audio settings stay as they are (it plays through them).
    if (!onCall) await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
    player.play();
  };
  useEffect(() => () => {
    if (nowPlaying === player) nowPlaying = null;
  }, [player]);

  const fill = length > 0 ? at / length : 0;
  return (
    <View style={[styles.note, { width }]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={broken ? 'Voice note that can’t be played' : `${status.playing ? 'Pause' : 'Play'} voice note, ${clock(length)}`}
        accessibilityState={{ disabled: !ready }}
        style={({ pressed }) => [styles.square, styles.play, pressed && { backgroundColor: colors.steel }, !ready && { opacity: 0.45 }]}
      >
        <Ionicons name={broken ? 'alert' : status.playing ? 'pause' : 'play'} size={22} color={colors.bone} />
      </Pressable>
      {broken ? (
        <Text style={styles.cant} numberOfLines={1}>Can’t play this one</Text>
      ) : (
        <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.trackFill, { width: `${Math.round(fill * 100)}%` }]} />
        </View>
      )}
      <Text style={styles.noteTime}>{clock(status.playing || at > 0 ? at : length)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingTop: space.sm },
  square: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  send: { backgroundColor: colors.redBright },
  status: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.ink,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.redBright },
  clock: { fontFamily: fonts.stencil, fontSize: 16, color: colors.bone, letterSpacing: 0.5 },
  hint: { flex: 1, fontFamily: fonts.stencil, fontSize: 13, color: colors.boneMute, textAlign: 'right' },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  play: { backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.line },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  trackFill: { height: 4, backgroundColor: colors.bone },
  cant: { flex: 1, fontFamily: fonts.stencil, fontSize: 13, color: colors.boneMute },
  noteTime: { fontFamily: fonts.stencil, fontSize: 14, color: colors.bone, minWidth: 40, textAlign: 'right' },
});
