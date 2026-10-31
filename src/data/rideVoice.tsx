// Lane E: ride comms. Holds a ride's voice call for the whole app, so it carries on while the rider
// moves between screens, the screen is off, or they're on another app. One big Connect, one big
// Disconnect, mute on screen or from the headset button. The demo (and the web, which can't do a
// call) shows a made-up room so the screen can be seen; on a phone the demo also plays sample
// audio, so App Review hears that comms makes sound.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import { displayName } from '../domain/profile';
import { shouldHangUp, VOICE_MSG, type VoiceParticipant, type VoiceState } from '../domain/rideVoice';
import { demoCallAudioMode } from '../domain/rideVoiceDemo';
import { useClub } from './ClubStore';
import { rideCommsNative } from './rideCommsNative';
import type { Call } from './rideVoiceLive';
import { supabase } from './supabase';

export interface RideVoiceValue {
  /** 'live' on a phone build with LiveKit, 'demo' in the demo, otherwise why it can't work here. */
  mode: 'live' | 'demo' | 'phoneOnly' | 'updateApp';
  state: VoiceState;
  rideId: string | null;
  people: VoiceParticipant[];
  muted: boolean;
  error: string | null;
  connect: (rideId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
}

const RideVoiceContext = createContext<RideVoiceValue | null>(null);

export function useRideVoice(): RideVoiceValue {
  const value = useContext(RideVoiceContext);
  if (!value) throw new Error('useRideVoice needs a RideVoiceProvider above it.');
  return value;
}

const hasLiveKit = () => !!NativeModules.LivekitReactNativeModule && !!NativeModules.WebRTCModule;

async function fetchToken(rideId: string): Promise<{ url: string; token: string }> {
  const { data, error } = await supabase().functions.invoke('ride-voice-token', { body: { rideId } });
  if (error) {
    // The function's own words (not allowed yet, not switched on) are in the answer's body; the
    // gateway's (an expired sign-in) are under `message`.
    const said = (await (error as { context?: Response }).context?.json?.().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(said?.error ?? said?.message ?? 'No connection. Check your signal and try again.');
  }
  return data as { url: string; token: string };
}

const micRefused = (e: unknown) => /NotAllowed|permission/i.test(`${(e as Error)?.name} ${(e as Error)?.message}`);

/** The web's demo call: nothing to hear, nothing to let go of. */
const silentDemoCall: Call = { setMuted: async () => undefined, hangUp: async () => undefined };

/** The phone's demo call: the bundled engine-and-radio clip on a loop, set up to keep going behind
 *  a locked screen. Hanging up stops it, frees the player and gives the background back. */
async function startDemoCall(): Promise<Call> {
  await setAudioModeAsync(demoCallAudioMode('connect'));
  let player: AudioPlayer | null = null;
  const hangUp = async () => {
    try {
      player?.pause();
      player?.remove();
    } catch {
      // Already gone.
    }
    player = null;
    await setAudioModeAsync(demoCallAudioMode('disconnect')).catch(() => undefined);
  };
  try {
    player = createAudioPlayer(require('../../assets/sounds/demo_ride_comms.wav'));
    player.loop = true;
    player.play();
  } catch (e) {
    await hangUp();
    throw e;
  }
  return {
    // Muting yourself in the demo quietens the room, so the button is seen to do something.
    setMuted: async (muted) => {
      if (player) player.volume = muted ? 0 : 1;
    },
    hangUp,
  };
}

export function RideVoiceProvider({ children }: { children: React.ReactNode }) {
  const { isDemo, me, data } = useClub();
  const mode: RideVoiceValue['mode'] = isDemo ? 'demo' : Platform.OS === 'web' ? 'phoneOnly' : hasLiveKit() ? 'live' : 'updateApp';
  const [state, setState] = useState<VoiceState>('idle');
  const [rideId, setRideId] = useState<string | null>(null);
  const [people, setPeople] = useState<VoiceParticipant[]>([]);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = useRef<Call | null>(null);
  const busy = useRef(false); // two quick taps on Connect make one call
  const mutedNow = useRef(false);
  // Bumped by every disconnect: a connect that finishes after one hangs straight up again.
  const generation = useRef(0);
  // A cancelled connect still finishing; the next one waits for it, so its hang-up can't cut the new call's audio.
  const settling = useRef<Promise<void> | null>(null);

  const endNative = () => {
    try {
      rideCommsNative?.stop();
    } catch {
      // An older build without it.
    }
  };

  const disconnect = useCallback(async () => {
    generation.current += 1;
    busy.current = false;
    const c = call.current;
    call.current = null;
    endNative();
    setState('idle');
    setRideId(null);
    setPeople([]);
    setMutedState(false);
    mutedNow.current = false;
    await c?.hangUp();
  }, []);

  const setMuted = useCallback(
    async (next: boolean) => {
      mutedNow.current = next;
      setMutedState(next);
      if (mode === 'demo') {
        setPeople((ps) => ps.map((p) => (p.id === me?.id ? { ...p, muted: next, speaking: false } : p)));
        await call.current?.setMuted(next).catch(() => undefined);
        return;
      }
      try {
        await call.current?.setMuted(next);
      } catch (e) {
        // Shows what the mic is really doing.
        mutedNow.current = !next;
        setMutedState(!next);
        setError((e as Error).message);
      }
    },
    [mode, me?.id],
  );

  const attempt = useCallback(
    async (id: string) => {
      if (busy.current || call.current) return;
      if (settling.current) {
        const before = generation.current;
        busy.current = true;
        setRideId(id);
        setState('connecting');
        await settling.current;
        if (generation.current !== before) return; // cancelled while waiting
        busy.current = false;
      }
      setError(null);
      if (mode === 'phoneOnly' || mode === 'updateApp') {
        setError(mode === 'phoneOnly' ? VOICE_MSG.phoneOnly : VOICE_MSG.updateApp);
        return;
      }
      busy.current = true;
      const mine = ++generation.current;
      const cancelled = () => generation.current !== mine;
      setRideId(id);
      setState('connecting');
      try {
        if (mode === 'demo') {
          await new Promise((r) => setTimeout(r, 600));
          if (cancelled()) return;
          const others = data.members.filter((m) => m.id !== me?.id && m.approval === 'approved').slice(0, 3);
          setPeople([
            ...(me ? [{ id: me.id, name: displayName(me), speaking: false, muted: false }] : []),
            ...others.map((m, i) => ({ id: m.id, name: displayName(m), speaking: i === 0, muted: i === 2 })),
          ]);
          // The web can't play behind a locked screen anyway, so it stays silent; a phone plays the clip.
          const demo = Platform.OS === 'web' ? silentDemoCall : await startDemoCall();
          if (cancelled()) {
            await demo.hangUp();
            return;
          }
          call.current = demo;
        } else {
          const { joinCall, prepareMic } = require('./rideVoiceLive') as typeof import('./rideVoiceLive'); // eslint-disable-line @typescript-eslint/no-require-imports
          // The mic and the screen-off service first, while the rider's still looking at the phone.
          await prepareMic();
          if (cancelled()) return;
          let started = true;
          try {
            started = rideCommsNative?.start('Ride comms is on') ?? true;
          } catch {
            // An older build: voice still works, just not the headset button.
          }
          if (!started && Platform.OS === 'android') setError(VOICE_MSG.screenOff);
          const { url, token } = await fetchToken(id);
          if (cancelled()) return;
          const joined = await joinCall(url, token, {
            onState: (s) => {
              if (cancelled()) return;
              setState(s);
              if (s === 'failed') {
                call.current = null;
                endNative();
              }
            },
            onPeople: (ps) => !cancelled() && setPeople(ps),
          });
          if (cancelled()) {
            await joined.hangUp();
            return;
          }
          call.current = joined;
        }
        setState('connected');
      } catch (e) {
        if (cancelled()) return;
        endNative();
        setState('idle');
        setRideId(null);
        setError(micRefused(e) ? VOICE_MSG.micDenied : (e as Error).message);
      } finally {
        if (!cancelled()) busy.current = false;
      }
    },
    [mode, data.members, me],
  );

  const connect = useCallback(
    async (id: string) => {
      const run = attempt(id);
      // Remembered while running; if it's cancelled, the next connect waits for it to wind down.
      const tracked = run.finally(() => {
        if (settling.current === tracked) settling.current = null;
      });
      settling.current = tracked;
      await run;
    },
    [attempt],
  );

  // The headset's play/pause button mutes and unmutes.
  useEffect(() => {
    if ((state !== 'connected' && state !== 'reconnecting') || !rideCommsNative) return;
    const sub = rideCommsNative.addListener('onHeadsetToggle', () => void setMuted(!mutedNow.current));
    return () => sub.remove();
  }, [state, setMuted]);

  // Ends itself when the ride's live window closes, the ride's called off, or the rider signs out.
  const ride = rideId ? data.rides.find((r) => r.id === rideId) : undefined;
  useEffect(() => {
    if (!rideId) return;
    const check = () => {
      if (!me || shouldHangUp(ride, new Date().toISOString())) void disconnect();
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [rideId, ride, me, disconnect]);

  // If the provider goes (the app reloads), the call goes with it.
  useEffect(
    () => () => {
      generation.current += 1;
      void call.current?.hangUp();
      call.current = null;
      endNative();
    },
    [],
  );

  const value = useMemo(
    () => ({ mode, state, rideId, people, muted, error, connect, disconnect, setMuted }),
    [mode, state, rideId, people, muted, error, connect, disconnect, setMuted],
  );
  return <RideVoiceContext.Provider value={value}>{children}</RideVoiceContext.Provider>;
}
