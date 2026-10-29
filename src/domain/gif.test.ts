import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GifReader } from 'omggif';
import { fitFrame, GifMaker, toRgba } from './gif';

const W = 8;
const H = 4;

/** A W×H RGBA frame filled with one colour, with an optional block of another. */
function frame(bg: [number, number, number], block?: { x: number; colour: [number, number, number] }): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const c = block && x === block.x ? block.colour : bg;
    out.set([c[0], c[1], c[2], 255], i * 4);
  }
  return out;
}

const INK: [number, number, number] = [17, 16, 16];
const RED: [number, number, number] = [185, 38, 50];
const BONE: [number, number, number] = [244, 241, 234];

function pixelAt(rgba: Uint8Array, x: number, y: number): number[] {
  const i = (y * W + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

test('writes a looping GIF89a with one frame per change', () => {
  const maker = new GifMaker(W, H, [frame(INK, { x: 3, colour: RED }), frame(INK, { x: 3, colour: BONE })], 100);
  maker.add(frame(INK));
  maker.add(frame(INK, { x: 2, colour: RED }));
  maker.add(frame(INK, { x: 3, colour: BONE }));
  const bytes = maker.finish();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), 'GIF89a');
  const gif = new GifReader(bytes);
  assert.equal(gif.width, W);
  assert.equal(gif.height, H);
  assert.equal(gif.numFrames(), 3);
  assert.equal(gif.loopCount(), 0);
  assert.equal(gif.frameInfo(0).delay, 10);
});

test('a frame that repeats the last one lengthens it instead', () => {
  const maker = new GifMaker(W, H, [frame(INK, { x: 3, colour: RED }), frame(INK, { x: 3, colour: BONE })], 100);
  maker.add(frame(INK));
  maker.add(frame(INK));
  maker.add(frame(INK));
  maker.add(frame(INK, { x: 1, colour: RED }));
  const gif = new GifReader(maker.finish());
  assert.equal(gif.numFrames(), 2);
  assert.equal(gif.frameInfo(0).delay, 30);
  assert.equal(gif.frameInfo(1).delay, 10);
});

test('unchanged pixels are transparent, so each frame builds on the last', () => {
  const maker = new GifMaker(W, H, [frame(INK, { x: 3, colour: RED }), frame(INK, { x: 3, colour: BONE })], 100);
  maker.add(frame(INK, { x: 0, colour: RED }));
  maker.add(frame(INK, { x: 5, colour: RED }));
  const gif = new GifReader(maker.finish());
  assert.equal(gif.frameInfo(1).disposal, 1);
  assert.equal(gif.frameInfo(1).transparent_index !== null, true);
  // Play both frames onto one canvas and read the result.
  const canvas = new Uint8Array(W * H * 4);
  gif.decodeAndBlitFrameRGBA(0, canvas);
  gif.decodeAndBlitFrameRGBA(1, canvas);
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 8);
  assert.ok(close(pixelAt(canvas, 0, 0), INK), 'the old red column is painted back to ink');
  assert.ok(close(pixelAt(canvas, 5, 2), RED));
  assert.ok(close(pixelAt(canvas, 7, 3), INK));
});

test('refuses a frame of the wrong size', () => {
  const maker = new GifMaker(W, H, [frame(INK)], 100);
  assert.throws(() => maker.add(new Uint8Array(12)));
});

test('RGB pixels gain a full alpha', () => {
  assert.deepEqual([...toRgba(new Uint8Array([1, 2, 3, 4, 5, 6]), 3)], [1, 2, 3, 255, 4, 5, 6, 255]);
  const rgba = new Uint8Array([1, 2, 3, 9]);
  assert.equal(toRgba(rgba, 4), rgba);
});

test('a frame drawn bigger is shrunk to the video size by averaging', () => {
  // A 4×2 frame: left half black, right half white, made 2×1.
  const big = new Uint8Array(4 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) big.set(x < 2 ? [0, 0, 0, 255] : [200, 100, 50, 255], (y * 4 + x) * 4);
  assert.deepEqual([...fitFrame(big, 4, 2, 2, 1)], [0, 0, 0, 255, 200, 100, 50, 255]);
  // The right size comes back as it is.
  assert.equal(fitFrame(big, 4, 2, 4, 2), big);
});
