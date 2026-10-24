// Turns a route's simplified line into points in a box, for drawing its shape. A simple
// equirectangular projection: longitude is narrowed by the cosine of the middle latitude, so the
// shape keeps its proportions at Melbourne's latitude, then fitted to the box inside the padding.

import type { Route } from './types';

/** `[x, y]` screen points for each `[lat, lng]`, north up, fitted and centred in `width` × `height`. */
export function projectLine(
  line: [number, number][],
  bounds: Route['bounds'],
  width: number,
  height: number,
  pad: number,
): [number, number][] {
  if (line.length === 0) return [];
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (bounds.maxLng - bounds.minLng) * kx;
  const spanY = bounds.maxLat - bounds.minLat;
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  const scales = [spanX > 0 ? innerW / spanX : Infinity, spanY > 0 ? innerH / spanY : Infinity];
  const scale = Math.min(...scales);
  const k = Number.isFinite(scale) ? scale : 0; // a single point: everything in the middle
  const offX = (width - spanX * k) / 2;
  const offY = (height - spanY * k) / 2;
  return line.map(([lat, lng]) => [offX + (lng - bounds.minLng) * kx * k, offY + (bounds.maxLat - lat) * k]);
}
