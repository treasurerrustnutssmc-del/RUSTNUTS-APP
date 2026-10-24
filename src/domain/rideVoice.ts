// Ride comms: one voice room per ride, open on the live ride's window. The rules for what the call
// screen shows. See docs/superpowers/specs/2026-10-24-ride-comms-design.md.

import { liveWindow } from './liveRide';
import type { Ride } from './types';

export type VoiceState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface VoiceParticipant {
  id: string;
  name: string;
  speaking: boolean;
  muted: boolean;
}

export const VOICE_MSG = {
  micDenied: 'Rustnuts needs the microphone for ride comms. Turn it on in your phone’s settings.',
  updateApp: 'Ride comms needs the latest version of the app.',
  phoneOnly: 'Ride comms works in the app on your phone.',
} as const;

/** Me first, then whoever's talking, then by name. */
export function voiceRoster(people: VoiceParticipant[], meId: string | null): VoiceParticipant[] {
  return [...people].sort(
    (a, b) =>
      Number(b.id === meId) - Number(a.id === meId) ||
      Number(b.speaking) - Number(a.speaking) ||
      a.name.localeCompare(b.name, 'en-AU'),
  );
}

export function voiceStatus(state: VoiceState, count: number, muted: boolean): string {
  const riders = `${count} ${count === 1 ? 'rider' : 'riders'}`;
  switch (state) {
    case 'idle':
      return 'Not connected';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return `${muted ? 'Muted' : 'On air'} · ${riders}`;
    case 'reconnecting':
      return 'Reconnecting…';
    case 'failed':
      return 'Dropped. Tap Connect to try again.';
  }
}

/** The call ends itself once the live window closes, or the ride is gone or called off. */
export function shouldHangUp(ride: Ride | undefined, now: string): boolean {
  const w = ride ? liveWindow(ride) : null;
  return !w || now >= w.closes;
}
