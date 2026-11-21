import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGate, NOISE_FILTERS, parseNoiseFilter, type NoiseFilter } from './voiceGate';

/** A level (0 to 1, like the phone reports) from decibels below full scale. */
const lvl = (db: number) => 10 ** (db / 20);

/** Feeds `ms` of a steady level in 10 ms frames, the way an Android phone reports, and returns
 *  whether the gate was open at the end, and how long into the run it first opened (or null). */
function run(gate: ReturnType<typeof createVoiceGate>, clock: { t: number }, db: number | ((ms: number) => number), ms: number) {
  let firstOpen: number | null = null;
  let open = false;
  for (let i = 0; i < ms; i += 10) {
    clock.t += 10;
    open = gate.feed(lvl(typeof db === 'number' ? db : db(i)), clock.t);
    if (open && firstOpen === null) firstOpen = i + 10;
  }
  return { open, firstOpen };
}

function setup(filter: NoiseFilter = 'medium') {
  return { gate: createVoiceGate(filter), clock: { t: 0 } };
}

test('steady road noise never opens the mic', () => {
  const { gate, clock } = setup();
  const r = run(gate, clock, -30, 10_000);
  assert.equal(r.firstOpen, null);
});

test('talking over the road noise opens the mic quickly', () => {
  const { gate, clock } = setup();
  run(gate, clock, -30, 3000);
  const r = run(gate, clock, -15, 500);
  assert.ok(r.firstOpen !== null && r.firstOpen <= 100, `opened after ${r.firstOpen} ms`);
});

test('the mic stays open between words, then closes about a second after you stop', () => {
  const { gate, clock } = setup();
  run(gate, clock, -30, 3000);
  run(gate, clock, -15, 1000);
  assert.equal(run(gate, clock, -30, 900).open, true, 'still open just after the last word');
  assert.equal(run(gate, clock, -30, 800).open, false, 'closed once the pause runs on');
});

test('a long sentence stays open the whole way', () => {
  const { gate, clock } = setup();
  run(gate, clock, -30, 3000);
  const r = run(gate, clock, (ms) => (ms % 400 < 300 ? -14 : -24), 6000);
  assert.equal(r.open, true);
});

test('light opens for softer speech than medium; strong needs a louder voice', () => {
  const soft = -22; // 8 dB over the road
  const results = (['light', 'medium', 'strong'] as const).map((f) => {
    const { gate, clock } = setup(f);
    run(gate, clock, -30, 3000);
    return run(gate, clock, soft, 500).firstOpen !== null;
  });
  assert.deepEqual(results, [true, false, false]);
  const { gate, clock } = setup('strong');
  run(gate, clock, -30, 3000);
  assert.notEqual(run(gate, clock, -12, 500).firstOpen, null, 'strong still opens for a clear voice');
});

test('road noise building up as you speed up does not open the mic', () => {
  const { gate, clock } = setup();
  run(gate, clock, -40, 2000);
  // 15 dB louder over 10 seconds, about 60 to 110 km/h.
  const r = run(gate, clock, (ms) => -40 + (15 * ms) / 10_000, 10_000);
  assert.equal(r.firstOpen, null);
});

test('a moment of silence (a gap in the wind) does not leave the mic open on the noise after it', () => {
  const { gate, clock } = setup();
  run(gate, clock, -30, 3000);
  run(gate, clock, -90, 30);
  const r = run(gate, clock, -30, 3000);
  assert.equal(r.firstOpen, null);
});

test('a single bump or click does not open the mic', () => {
  const { gate, clock } = setup();
  run(gate, clock, -30, 3000);
  run(gate, clock, -5, 10);
  assert.equal(run(gate, clock, -30, 20).open, false);
});

test('a quiet room still needs a real voice, not breathing', () => {
  const { gate, clock } = setup();
  run(gate, clock, -85, 2000);
  assert.equal(run(gate, clock, -70, 500).firstOpen, null, 'too quiet to be talking');
  assert.notEqual(run(gate, clock, -35, 500).firstOpen, null);
});

test('off is an open mic', () => {
  const { gate, clock } = setup('off');
  assert.equal(run(gate, clock, -30, 1000).open, true);
  assert.equal(run(gate, clock, -90, 1000).open, true);
});

test('changing the filter mid-call keeps what it has learnt about the road', () => {
  const { gate, clock } = setup('strong');
  run(gate, clock, -30, 3000);
  gate.setFilter('light');
  assert.notEqual(run(gate, clock, -22, 500).firstOpen, null);
  gate.setFilter('off');
  assert.equal(run(gate, clock, -90, 3000).open, true);
});

test('Android (10 ms) and iPhone (40 ms) reports give the same answer', () => {
  const gate = createVoiceGate('medium');
  let t = 0;
  let first: number | null = null;
  for (let i = 0; i < 3000; i += 40) gate.feed(lvl(-30), (t += 40));
  for (let i = 0; i < 500; i += 40) if (gate.feed(lvl(-15), (t += 40)) && first === null) first = i + 40;
  assert.ok(first !== null && first <= 120, `opened after ${first} ms`);
});

test('the stored filter falls back to medium when missing or broken', () => {
  assert.deepEqual(NOISE_FILTERS.map((f) => f.id), ['off', 'light', 'medium', 'strong']);
  assert.equal(parseNoiseFilter(null), 'medium');
  assert.equal(parseNoiseFilter('loud'), 'medium');
  assert.equal(parseNoiseFilter('off'), 'off');
  assert.equal(parseNoiseFilter('strong'), 'strong');
});
