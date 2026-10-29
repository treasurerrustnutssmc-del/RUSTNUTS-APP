// A small animated GIF writer for the ride replay, on top of gifenc (pure JavaScript, so it runs on
// the phone without native code). Every frame shares one palette, made from sample frames that
// hold all the replay's colours. A frame that repeats the last one only lengthens it, and pixels
// that didn't change are written as transparent, so each frame paints just what moved.

import { applyPalette, GIFEncoder, quantize, type Encoder, type Palette } from 'gifenc';

export class GifMaker {
  private readonly encoder: Encoder = GIFEncoder();
  private readonly palette: Palette;
  /** The palette slot that means "keep what's there". */
  private readonly clear: number;
  private pending: { index: Uint8Array; delay: number } | null = null;
  private last: Uint8Array | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
    paletteFrom: Uint8Array[],
    private readonly delayMs: number,
  ) {
    const size = paletteFrom.reduce((n, f) => n + f.length, 0);
    const all = new Uint8Array(size);
    let at = 0;
    for (const f of paletteFrom) {
      all.set(f, at);
      at += f.length;
    }
    this.palette = quantize(all, 255, { format: 'rgb565' });
    this.clear = this.palette.length;
  }

  /** Adds one RGBA frame of the GIF's size, shown for the frame delay. */
  add(rgba: Uint8Array): void {
    if (rgba.length !== this.width * this.height * 4) throw new Error('The frame is the wrong size.');
    const index = applyPalette(rgba, this.palette, 'rgb565');
    if (this.pending && same(this.pending.index, index)) {
      this.pending.delay += this.delayMs;
      return;
    }
    this.flush();
    this.pending = { index, delay: this.delayMs };
  }

  /** Writes the last frame and returns the file's bytes. */
  finish(): Uint8Array {
    this.flush();
    this.encoder.finish();
    return this.encoder.bytes();
  }

  private flush(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const last = this.last;
    if (!last) {
      this.encoder.writeFrame(p.index, this.width, this.height, { palette: [...this.palette, [0, 0, 0]], delay: p.delay, repeat: 0 });
    } else {
      const out = new Uint8Array(p.index);
      for (let i = 0; i < out.length; i++) if (out[i] === last[i]) out[i] = this.clear;
      this.encoder.writeFrame(out, this.width, this.height, { delay: p.delay, transparent: true, transparentIndex: this.clear, dispose: 1 });
    }
    this.last = p.index;
  }
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Decoded PNG pixels as RGBA: RGB gains a full alpha, RGBA is returned as it is. */
export function toRgba(data: Uint8Array, channels: number): Uint8Array {
  if (channels === 4) return data;
  const n = data.length / channels;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const g = channels < 3;
    out[i * 4] = data[i * channels];
    out[i * 4 + 1] = data[i * channels + (g ? 0 : 1)];
    out[i * 4 + 2] = data[i * channels + (g ? 0 : 2)];
    out[i * 4 + 3] = channels === 2 ? data[i * 2 + 1] : 255;
  }
  return out;
}

/**
 * A frame shrunk from `w`×`h` to `W`×`H` by averaging the pixels each one covers. Phones that draw
 * at their own pixel density hand back a bigger picture than the video's.
 */
export function fitFrame(rgba: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  if (w === W && h === H) return rgba;
  const out = new Uint8Array(W * H * 4);
  const sx = w / W;
  const sy = h / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          a += rgba[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      out.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)], (y * W + x) * 4);
    }
  }
  return out;
}
