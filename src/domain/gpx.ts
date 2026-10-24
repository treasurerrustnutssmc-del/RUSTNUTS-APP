// Reads a GPX file on the phone before it is uploaded: distance, climb, a simplified line for
// drawing, bounds and stops. React Native has no DOMParser, so this is a small linear tag scanner
// (one pass, indexOf for '<', no backtracking patterns). The database checks the same file again
// with Postgres's own XML functions.

export interface GpxSummary {
  distanceM: number;
  climbM: number | null;
  line: [number, number][];
  stops: { name: string; lat: number; lng: number }[];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}

export const NOT_GPX = 'That isn’t a GPX file.';
export const NO_TRACK = 'That route has no track in it.';
export const TOO_BIG = 'That file is too big (5 MB at most).';
/** The most stops a route keeps: the first ones in the file. */
const MAX_STOPS = 100;
const MAX_BYTES = 5 * 1024 * 1024;
const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in metres between two [lat, lng] points. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The text's size in UTF-8 bytes, counted without allocating a copy. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // a surrogate pair is one 4-byte character
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// ---- The scanner ----

interface RawPoint {
  lat: number;
  lng: number;
  ele: number | null;
  name: string;
}

type PointTag = 'trkpt' | 'rtept' | 'wpt';

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

/** The element name without its namespace prefix: `gpx:trkpt` becomes `trkpt`. */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** Index of the '>' that ends the tag starting after `from`, skipping quoted attribute values; -1 if none. */
function tagEnd(text: string, from: number): number {
  let quote = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 62) return i;
  }
  return -1;
}

function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (whole, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.charCodeAt(1) === 120 ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** lat and lon from a tag's attribute text (single or double quotes), or null if either is missing or out of range. */
function readLatLon(attrs: string): [number, number] | null {
  let lat: string | null = null;
  let lon: string | null = null;
  const n = attrs.length;
  let p = 0;
  while (p < n) {
    while (p < n && isSpace(attrs.charCodeAt(p))) p++;
    const start = p;
    while (p < n && attrs.charCodeAt(p) !== 61 && !isSpace(attrs.charCodeAt(p))) p++;
    const name = attrs.slice(start, p);
    while (p < n && isSpace(attrs.charCodeAt(p))) p++;
    if (attrs.charCodeAt(p) !== 61) {
      if (p === start) p++; // stray character: move on
      continue;
    }
    p++;
    while (p < n && isSpace(attrs.charCodeAt(p))) p++;
    const quote = attrs[p];
    if (quote !== '"' && quote !== "'") return null;
    const close = attrs.indexOf(quote, p + 1);
    if (close < 0) return null;
    const value = attrs.slice(p + 1, close);
    p = close + 1;
    if (name === 'lat') lat = value;
    else if (name === 'lon') lon = value;
  }
  if (lat === null || lon === null || lat.trim() === '' || lon.trim() === '') return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return [la, lo];
}

/** The text of an element from `from` to the next real tag, joining CDATA; null if the file ends first. */
function readText(text: string, from: number): { value: string; next: number } | null {
  let value = '';
  let pos = from;
  for (;;) {
    const lt = text.indexOf('<', pos);
    if (lt < 0) return null;
    value += decodeEntities(text.slice(pos, lt));
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) return null;
      value += text.slice(lt + 9, end);
      pos = end + 3;
    } else if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) return null;
      pos = end + 3;
    } else return { value: value.trim(), next: lt };
  }
}

interface Scanned {
  trk: RawPoint[];
  rte: RawPoint[];
  wpt: RawPoint[];
}

/** Walks the file once. Null means malformed: no gpx root, unbalanced or unterminated tags, or bad coordinates. */
function scan(text: string): Scanned | null {
  const out: Scanned = { trk: [], rte: [], wpt: [] };
  const stack: string[] = [];
  let sawRoot = false;
  let rootClosed = false;
  let cur: { tag: PointTag; depth: number; point: RawPoint } | null = null;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (;;) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    // Things that are not elements: comments, CDATA, declarations, doctype.
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = tagEnd(text, lt + 2);
      if (end < 0) return null;
      i = end + 1;
      continue;
    }

    const end = tagEnd(text, lt + 1);
    if (end < 0) return null;
    i = end + 1;
    const closing = text.charCodeAt(lt + 1) === 47;
    const selfClose = !closing && text.charCodeAt(end - 1) === 47;
    const inner = text.slice(closing ? lt + 2 : lt + 1, selfClose ? end - 1 : end);
    let nameEnd = 0;
    while (nameEnd < inner.length && !isSpace(inner.charCodeAt(nameEnd))) nameEnd++;
    const rawName = inner.slice(0, nameEnd);
    if (rawName === '') return null;
    const local = localName(rawName);

    if (closing) {
      if (stack.pop() !== rawName) return null;
      if (cur && cur.depth === stack.length && cur.tag === local) {
        out[cur.tag === 'trkpt' ? 'trk' : cur.tag === 'rtept' ? 'rte' : 'wpt'].push(cur.point);
        cur = null;
      }
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    if (stack.length === 0) {
      if (rootClosed || local !== 'gpx') return null;
      sawRoot = true;
    }
    const parent = stack.length ? localName(stack[stack.length - 1]) : '';

    if (!cur && (local === 'trkpt' || local === 'rtept' || local === 'wpt')) {
      const at = readLatLon(inner.slice(nameEnd));
      if (!at) return null;
      const point: RawPoint = { lat: at[0], lng: at[1], ele: null, name: '' };
      if (selfClose) out[local === 'trkpt' ? 'trk' : local === 'rtept' ? 'rte' : 'wpt'].push(point);
      else cur = { tag: local, depth: stack.length, point };
    } else if (cur && !selfClose && (local === 'ele' || local === 'name') && parent === cur.tag) {
      const read = readText(text, i);
      if (!read) return null;
      i = read.next;
      if (local === 'name') cur.point.name = read.value;
      else if (read.value !== '') {
        const ele = Number(read.value);
        if (Number.isFinite(ele)) cur.point.ele = ele;
      }
    }

    if (selfClose) {
      if (stack.length === 0) rootClosed = true;
    } else stack.push(rawName);
  }

  if (!sawRoot || stack.length > 0) return null;
  return out;
}

// ---- Simplifying ----

/**
 * Ramer–Douglas–Peucker, with the tolerance raised until at most `max` points are left. It does
 * that by always splitting the segment whose farthest point is farthest from its chord, so it
 * stops at the smallest tolerance that fits. The first and last points are always kept.
 */
export function simplify(points: [number, number][], max = 300): [number, number][] {
  const n = points.length;
  if (n <= max || n <= 2) return points.slice();
  // Flatten to a plane around the middle latitude; the tolerance is only used for ranking.
  const midLat = (points[0][0] + points[n - 1][0]) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    xs[k] = points[k][1] * kx;
    ys[k] = points[k][0];
  }
  const farthest = (lo: number, hi: number) => {
    const dx = xs[hi] - xs[lo];
    const dy = ys[hi] - ys[lo];
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = 0;
    for (let k = lo + 1; k < hi; k++) {
      let px = xs[k] - xs[lo];
      let py = ys[k] - ys[lo];
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= t * dx;
        py -= t * dy;
      }
      const d = px * px + py * py;
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    return { index: best, dist: bestD };
  };

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  let kept = 2;
  const open: { lo: number; hi: number; index: number; dist: number }[] = [];
  const add = (lo: number, hi: number) => {
    if (hi - lo < 2) return;
    const f = farthest(lo, hi);
    if (f.index >= 0) open.push({ lo, hi, ...f });
  };
  add(0, n - 1);
  while (kept < max && open.length > 0) {
    let top = 0;
    for (let k = 1; k < open.length; k++) if (open[k].dist > open[top].dist) top = k;
    const seg = open[top];
    open[top] = open[open.length - 1];
    open.pop();
    keep[seg.index] = 1;
    kept++;
    add(seg.lo, seg.index);
    add(seg.index, seg.hi);
  }
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(points[k]);
  return out;
}

// ---- The reader ----

/** Reads a GPX file into a summary, or returns the message to show when it can't be used. */
export function readGpx(text: string): GpxSummary | string {
  // More characters than the limit is already more bytes than the limit.
  if (text.length > MAX_BYTES || utf8Bytes(text) > MAX_BYTES) return TOO_BIG;
  const scanned = scan(text);
  if (!scanned) return NOT_GPX;

  // Track points across all segments in order; route points only when there is no track.
  const chosen = scanned.trk.length > 0 ? scanned.trk : scanned.rte;
  if (chosen.length < 2) return NO_TRACK;

  const coords: [number, number][] = [];
  let distance = 0;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  // Climb: null when fewer than 2 points have elevation, otherwise points without it are skipped.
  let withEle = 0;
  let climb = 0;
  let lastEle: number | null = null;
  for (let k = 0; k < chosen.length; k++) {
    const p = chosen[k];
    const c: [number, number] = [p.lat, p.lng];
    coords.push(c);
    if (k > 0) distance += haversineM(coords[k - 1], c);
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.ele !== null) {
      withEle++;
      if (lastEle !== null && p.ele > lastEle) climb += p.ele - lastEle;
      lastEle = p.ele;
    }
  }

  return {
    distanceM: Math.round(distance),
    climbM: withEle >= 2 ? Math.round(climb) : null,
    line: simplify(coords),
    stops: scanned.wpt.slice(0, MAX_STOPS).map((w, k) => ({ name: w.name !== '' ? w.name : `Stop ${k + 1}`, lat: w.lat, lng: w.lng })),
    bounds: { minLat, minLng, maxLat, maxLng },
  };
}
