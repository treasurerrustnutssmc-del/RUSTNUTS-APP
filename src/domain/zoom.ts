// Pinch to zoom in the photo viewer (Jeff, 28 Nov 2026). Points are measured from the middle of the
// picture's box; the picture is drawn moved by (x, y) and then scaled by `scale` about that middle.

export const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

export interface View {
  scale: number;
  x: number;
  y: number;
}
type Point = { x: number; y: number };
type Box = { width: number; height: number };

/** Keeps the picture covering its box: no sliding past an edge, and no move at all at 1x. */
export function clampView(v: View, box: Box): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
  const mx = ((scale - 1) * box.width) / 2;
  const my = ((scale - 1) * box.height) / 2;
  const clamp = (n: number, m: number) => (m === 0 ? 0 : Math.min(m, Math.max(-m, n)));
  return { scale, x: clamp(v.x, mx), y: clamp(v.y, my) };
}

/** From where a pinch started: the fingers' middle then and now, and how much further apart they are. */
export function pinchTo(start: View, from: Point, to: Point, ratio: number, box: Box): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, start.scale * ratio));
  // The content point under the fingers at the start stays under them now.
  const px = (from.x - start.x) / start.scale;
  const py = (from.y - start.y) / start.scale;
  return clampView({ scale, x: to.x - scale * px, y: to.y - scale * py }, box);
}

/** A double tap zooms in on the spot, or back out to the whole picture. */
export function doubleTap(v: View, at: Point, box: Box): View {
  if (v.scale > 1.01) return { scale: 1, x: 0, y: 0 };
  return pinchTo(v, at, at, DOUBLE_TAP_ZOOM / v.scale, box);
}
