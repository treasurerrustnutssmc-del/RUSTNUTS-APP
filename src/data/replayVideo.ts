// Making the ride replay's video file on the phone: each frame is the replay card's own drawing
// (react-native-svg's toDataURL), decoded to pixels here, and the finished GIF is written to the
// cache and handed to the share sheet. All of it is JavaScript plus modules the app already has,
// so it ships in an over-the-air update. The web build has its own version (replayVideo.web.ts).

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PixelRatio } from 'react-native';
import type Svg from 'react-native-svg';
import { fitFrame, toRgba } from '../domain/gif';

/** Whether this build can make the file. */
export const canMakeVideo = true;

/**
 * The capture drawing's size in layout units, so it comes out at about `w`×`h` pixels: both phones
 * draw it at their own pixel density. Any leftover difference is evened out by `fitFrame`.
 */
export function captureSize(w: number, h: number): { width: number; height: number } {
  const k = PixelRatio.get();
  return { width: w / k, height: h / k };
}

type Decode = (data: Uint8Array) => { width: number; height: number; data: ArrayLike<number>; channels: number };
let decoder: Decode | null = null;

/**
 * fast-png, loaded the first time a video is made rather than when the app starts, so a phone
 * whose JavaScript engine lacks something it needs only loses the video, never the app.
 */
function decodePng(bytes: Uint8Array) {
  if (!decoder) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      decoder = (require('fast-png') as { decode: Decode }).decode;
    } catch {
      throw new Error('This phone can’t make the video yet.');
    }
  }
  return decoder(bytes);
}

function base64Bytes(b64: string): Uint8Array {
  // iPhones wrap the base64 in lines.
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The drawing's current frame as `w`×`h` RGBA pixels. */
export function framePixels(svg: Svg, w: number, h: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      svg.toDataURL((b64: string) => {
        try {
          const png = decodePng(base64Bytes(b64));
          const rgba = toRgba(png.data as Uint8Array, png.channels);
          resolve(fitFrame(rgba, png.width, png.height, w, h));
        } catch (e) {
          reject(e as Error);
        }
      });
    } catch (e) {
      reject(e as Error);
    }
  });
}

/** Writes the GIF to the cache and opens the share sheet with it. */
export async function shareVideo(bytes: Uint8Array, fileName: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone can’t share files with other apps.');
  const file = new File(Paths.cache, 'replays', fileName);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'image/gif', UTI: 'com.compuserve.gif', dialogTitle: 'Share the ride replay' });
}
