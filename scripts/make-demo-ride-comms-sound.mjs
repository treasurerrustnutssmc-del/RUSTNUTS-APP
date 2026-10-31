// Makes assets/sounds/demo_ride_comms.wav, the sample audio the ride comms demo plays on a phone:
// a low engine rumble under a couple of radio squelch bursts, 8 s, 16-bit mono PCM at 22.05 kHz,
// looping without a join. Synthesised from scratch (no recording, no speech), so the club owns it
// outright. Plain Node, no dependencies:
//
//   node scripts/make-demo-ride-comms-sound.mjs

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22_050;
const LENGTH = 8; // seconds
const FRAMES = RATE * LENGTH;
const PEAK = 0.5; // about -6 dBFS, so it sits under a real call's level

// Every periodic part uses a whole number of cycles over the clip, so the last sample runs straight
// into the first: the loop has no join to hear.
const cycles = (hz) => Math.round(hz * LENGTH) / LENGTH;

// A seeded generator, so running the script again writes the same bytes.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2019);
const noise = () => rand() * 2 - 1;

/** A two-pole band-pass (constant skirt gain), run as a plain recurrence. */
function bandPass(input, lowHz, highHz) {
  const centre = Math.sqrt(lowHz * highHz);
  const q = centre / (highHz - lowHz);
  const w0 = (2 * Math.PI * centre) / RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** The bike: a lumpy twin at a slow idle, heard as its harmonics (a phone speaker can't do the
 *  fundamental), with the revs and the level breathing slowly. */
function rumble() {
  const out = new Float64Array(FRAMES);
  const f0 = cycles(27.5);
  const harmonics = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
  const wobbleA = cycles(0.375), wobbleB = cycles(0.625), flutter = cycles(2.25);
  for (let i = 0; i < FRAMES; i++) {
    const t = i / RATE;
    // Two slow waves against each other, so the swell never quite repeats inside the loop.
    const breath = 1 + 0.22 * Math.sin(2 * Math.PI * wobbleA * t) + 0.14 * Math.sin(2 * Math.PI * wobbleB * t + 1.3);
    const shake = 1 + 0.08 * Math.sin(2 * Math.PI * flutter * t);
    let s = 0;
    for (const n of harmonics) {
      // Odd harmonics a touch louder: the uneven firing of a V-twin.
      const weight = (n % 2 ? 1 : 0.7) / n;
      s += weight * Math.sin(2 * Math.PI * f0 * n * t + n * 0.4);
    }
    out[i] = Math.tanh(s * 1.4 * shake) * breath;
  }
  return out;
}

/** One burst of radio static: the hiss of an open squelch that snaps shut with a click. */
function squelch(out, at, length) {
  const start = Math.round(at * RATE);
  const n = Math.round(length * RATE);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    // Sharp open, uneven hiss, a short tail.
    const attack = Math.min(1, t / 0.008);
    const release = i > n - RATE * 0.03 ? (n - i) / (RATE * 0.03) : 1;
    const crackle = 0.7 + 0.3 * Math.sin(2 * Math.PI * 37 * t) * Math.sin(2 * Math.PI * 11 * t);
    raw[i] = noise() * attack * release * crackle;
  }
  const hiss = bandPass(raw, 900, 3200);
  for (let i = 0; i < n && start + i < out.length; i++) out[start + i] += 1.1 * hiss[i];
  // The click as the squelch closes.
  const click = Math.round(0.012 * RATE);
  for (let i = 0; i < click && start + n + i < out.length; i++) out[start + n + i] += 0.6 * noise() * (1 - i / click);
}

function main() {
  const out = rumble();
  // Three calls, none touching the ends of the loop, so the join stays clean.
  squelch(out, 1.9, 0.22);
  squelch(out, 4.6, 0.16);
  squelch(out, 6.25, 0.3);

  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const gain = PEAK / peak;
  const bytes = new ArrayBuffer(44 + FRAMES * 2);
  const view = new DataView(bytes);
  const ascii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + FRAMES * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, FRAMES * 2, true);
  for (let i = 0; i < FRAMES; i++) view.setInt16(44 + i * 2, Math.round(out[i] * gain * 32767), true);

  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds', 'demo_ride_comms.wav');
  writeFileSync(path, Buffer.from(bytes));
  console.log(`wrote ${path} (${Math.round(bytes.byteLength / 1024)} KB, ${LENGTH} s at ${RATE} Hz)`);
}

main();
