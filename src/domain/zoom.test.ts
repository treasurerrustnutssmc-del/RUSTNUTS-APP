import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampView, doubleTap, pinchTo, MAX_ZOOM, type View } from './zoom';

const box = { width: 400, height: 600 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('pinching keeps the point under the fingers still', () => {
  const start: View = { scale: 1, x: 0, y: 0 };
  // Fingers centred 100 right of the middle, spreading to twice as far apart.
  const v = pinchTo(start, { x: 100, y: 0 }, { x: 100, y: 0 }, 2, box);
  near(v.scale, 2);
  // The content point at +100 now sits at 2*100 + x, which should still be +100.
  near(2 * 100 + v.x, 100);
});

test('zoom stays between 1x and the most, and the picture never slides off', () => {
  assert.equal(pinchTo({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 0.3, box).scale, 1);
  assert.equal(pinchTo({ scale: 3, x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 10, box).scale, MAX_ZOOM);
  const v = clampView({ scale: 2, x: 1000, y: -1000 }, box);
  assert.deepEqual(v, { scale: 2, x: 200, y: -300 });
  assert.deepEqual(clampView({ scale: 1, x: 50, y: 50 }, box), { scale: 1, x: 0, y: 0 });
});

test('double tap zooms in on the tapped spot, and back out when zoomed', () => {
  const v = doubleTap({ scale: 1, x: 0, y: 0 }, { x: 100, y: -50 }, box);
  assert.equal(v.scale, 2.5);
  near(2.5 * 100 + v.x, 100);
  near(2.5 * -50 + v.y, -50);
  assert.deepEqual(doubleTap({ scale: 2, x: 30, y: 10 }, { x: 0, y: 0 }, box), { scale: 1, x: 0, y: 0 });
});
