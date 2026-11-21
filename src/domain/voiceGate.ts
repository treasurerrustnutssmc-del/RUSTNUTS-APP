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
/** Once open, softer words this much under the opening level still keep it open. */
const KEEP_OPEN_DB = 4;
/** Quick to hear a voice start, slower to follow the road. */
const FAST_MS = 30;
const SLOW_MS = 300;
/** The road noise is the quietest the mic has been over the last two seconds (speech has gaps, so
 *  a sentence can't pass for road noise), and it may only climb so fast (dB a second), slower while
 *  you talk. Getting quieter is learnt at once. */
const FLOOR_WINDOW_MS = 2000;
const FLOOR_STEP_MS = 100;
const FLOOR_RISE = 3;
const FLOOR_RISE_TALKING = 1.5;

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
  let last: number | null = null;
  let floor = 0;
  let openUntil = -Infinity;
  // The quietest smoothed level in each 100 ms step of the last two seconds.
  let steps: { at: number; min: number }[] = [];

  return {
    setFilter: (f) => {
      filter = f;
    },
    feed: (level, now) => {
      const db = toDb(level);
      const first = last === null;
      const dt = first ? 0 : Math.min(Math.max(now - (last as number), 0), 500);
      if (first) {
        fast = slow = db;
      } else {
        fast += (db - fast) * (1 - Math.exp(-dt / FAST_MS));
        slow += (db - slow) * (1 - Math.exp(-dt / SLOW_MS));
      }
      last = now;
      const step = Math.floor(now / FLOOR_STEP_MS);
      const top = steps[steps.length - 1];
      if (top && top.at === step) top.min = Math.min(top.min, slow);
      else steps.push({ at: step, min: slow });
      while (steps.length && steps[0].at <= step - FLOOR_WINDOW_MS / FLOOR_STEP_MS) steps.shift();
      const quietest = Math.min(...steps.map((x) => x.min));
      const open = now < openUntil;
      floor = first ? quietest : Math.min(quietest, floor + ((open ? FLOOR_RISE_TALKING : FLOOR_RISE) * dt) / 1000);

      const margin = NOISE_FILTERS.find((f) => f.id === filter)?.margin ?? 0;
      const needed = open ? Math.max(margin - KEEP_OPEN_DB, 2) : margin;
      if (fast > floor + needed && fast > MIN_VOICE_DB) openUntil = now + HOLD_MS;
      return filter === 'off' || now < openUntil;
    },
  };
}

/** The loudness (0 to 1, root mean square) of 16-bit little-endian sound sent as base64, which is
 *  how Android hands over the mic's raw samples. */
export function pcm16Level(base64: string, decode: (b64: string) => string): number {
  let bin: string;
  try {
    bin = decode(base64);
  } catch {
    return 0;
  }
  const n = bin.length >> 1;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v & 0x8000) v -= 0x10000;
    sum += v * v;
  }
  return Math.sqrt(sum / n) / 32768;
}

/** Watches the levels a meter reports and says when they can't be a real mic: a live mic's level
 *  always wobbles, so one that sits within 1.5 dB for five seconds is reading something else (or
 *  nothing), and the gate should step aside and leave the mic open. */
export function createMeterCheck() {
  let since: number | null = null;
  let lo = Infinity;
  let hi = -Infinity;
  return (level: number, now: number): 'ok' | 'broken' => {
    const db = toDb(level);
    if (since === null) since = now;
    lo = Math.min(lo, db);
    hi = Math.max(hi, db);
    if (hi - lo > 1.5) {
      since = now;
      lo = hi = db;
      return 'ok';
    }
    return now - since >= 5000 ? 'broken' : 'ok';
  };
}
