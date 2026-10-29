// Making the ride replay's video file on the phone: each frame is the replay card's own drawing
// (react-native-svg's toDataURL), decoded to pixels here, and the finished GIF is written to the
// cache and handed to the share sheet. All of it is JavaScript plus modules the app already has,
// so it ships in an over-the-air update. The web build has its own version (replayVideo.web.ts).

import { decode } from 'fast-png';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PixelRatio, Platform } from 'react-native';
import type Svg from 'react-native-svg';
import { fitFrame, toRgba } from '../domain/gif';

/** Whether this build can make the file. */
export const canMakeVideo = true;

/**
 * The capture drawing's size in layout units, so it comes out at `w`×`h` pixels: an iPhone hands
 * back its points at 1×, an Android phone draws at its own pixel density.
 */
export function captureSize(w: number, h: number): { width: number; height: number } {
  const k = Platform.OS === 'android' ? PixelRatio.get() : 1;
  return { width: w / k, height: h / k };
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
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
          const png = decode(base64Bytes(b64));
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
