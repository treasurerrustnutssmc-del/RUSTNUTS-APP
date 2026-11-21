// Ride comms: the voice gate. With everyone on an open mic, every rider's wind and road noise is
// added together in everyone's ears, even when nobody's talking. The gate only lets your mic through
// while you're talking: it learns how loud the road is right now (the "floor", which follows the
// noise up as you speed up and down as you slow) and opens when your voice comes in clearly over it,
// staying open through the gaps between words. The phone's own noise suppression still cleans what
// gets through. Pure maths here; the call wires it to the mic level (see data/rideVoiceLive.ts).

export type NoiseFilter = 'off' | 'light' | 'medium' | 'strong';

/** The choices on the Ride comms card, gentlest first. `margin` is how far over the road noise
 *  (in decibels) a voice must be to open the mic. */
export const NOISE_FILTERS: { id: NoiseFilter; label: string; margin: number }[] = [
  { id: 'off', label: 'Off', margin: 0 },
  { id: 'light', label: 'Light', margin: 6 },
  { id: 'medium', label: 'Medium', margin: 10 },
  { id: 'strong', label: 'Strong', margin: 14 },
];

export const DEFAULT_NOISE_FILTER: NoiseFilter = 'medium';

export function parseNoiseFilter(raw: string | null | undefined): NoiseFilter {
  return NOISE_FILTERS.some((f) => f.id === raw) ? (raw as NoiseFilter) : DEFAULT_NOISE_FILTER;
}

/** One line under the choices, so a rider knows what each does. */
export function noiseFilterHint(filter: NoiseFilter): string {
  switch (filter) {
    case 'off':
      return 'Open mic: everyone hears your road noise all the time.';
    case 'light':
      return 'Your mic opens when you talk, even softly. Some wind may get through.';
    case 'medium':
      return 'Your mic opens when you talk and closes about a second after you stop.';
    case 'strong':
      return 'For a windy helmet: speak up to open your mic.';
  }
}

/** Below this the mic is too quiet to be anyone talking (dB below full scale). */
const MIN_VOICE_DB = -55;
/** How long the mic stays open after the last loud enough moment, so words run together. */
const HOLD_MS = 1200;
/** Quick to hear a voice start, slower to learn the road. */
const FAST_MS = 30;
const SLOW_MS = 300;
/** How fast the learnt road noise may follow the real one (dB a second). Rising stays slow while
 *  you talk, so a long sentence can't teach the gate that your voice is road noise. */
const FLOOR_FALL = 10;
const FLOOR_RISE = 2;
const FLOOR_RISE_TALKING = 0.5;

const toDb = (level: number) => 20 * Math.log10(Math.max(level, 1e-5));

export interface VoiceGate {
  /** Takes the mic's level (0 to 1) at time `now` (ms); says whether the mic should be on. */
  feed: (level: number, now: number) => boolean;
  setFilter: (filter: NoiseFilter) => void;
}

export function createVoiceGate(initial: NoiseFilter): VoiceGate {
  let filter = initial;
  let fast = 0;
  let slow = 0;
  let floor = 0;
  let last: number | null = null;
  let openUntil = -Infinity;

  return {
    setFilter: (f) => {
      filter = f;
    },
    feed: (level, now) => {
      const db = toDb(level);
      if (last === null) {
        fast = slow = floor = db;
      } else {
        const dt = Math.min(Math.max(now - last, 0), 500);
        fast += (db - fast) * (1 - Math.exp(-dt / FAST_MS));
        slow += (db - slow) * (1 - Math.exp(-dt / SLOW_MS));
        const talking = now < openUntil;
        floor =
          slow < floor
            ? Math.max(slow, floor - (FLOOR_FALL * dt) / 1000)
            : Math.min(slow, floor + ((talking ? FLOOR_RISE_TALKING : FLOOR_RISE) * dt) / 1000);
      }
      last = now;
      const margin = NOISE_FILTERS.find((f) => f.id === filter)?.margin ?? 0;
      if (fast > floor + margin && fast > MIN_VOICE_DB) openUntil = now + HOLD_MS;
      return filter === 'off' || now < openUntil;
    },
  };
}
