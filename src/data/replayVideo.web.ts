// The web preview plays the ride replay but doesn't make the file: a drawing turned into a picture
// in the browser loses the club font and the logo. The phone version is replayVideo.ts.

import type Svg from 'react-native-svg';

export const canMakeVideo = false;

export function captureSize(w: number, h: number): { width: number; height: number } {
  return { width: w, height: h };
}

export function framePixels(_svg: Svg, _w: number, _h: number): Promise<Uint8Array> {
  return Promise.reject(new Error('Make the video in the phone app.'));
}

export function shareVideo(_bytes: Uint8Array, _fileName: string): Promise<void> {
  return Promise.reject(new Error('Make the video in the phone app.'));
}
