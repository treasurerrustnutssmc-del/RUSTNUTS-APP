// Reads a GPX file on the phone before it is uploaded: distance, climb, a simplified line for
// drawing, bounds, stops and the file's own name. React Native has no DOMParser, so this is a small
// linear tag scanner (one pass, indexOf for '<', no backtracking patterns). The database checks the
// same file again with Postgres's own XML functions, so the scanner refuses what they refuse.

export interface GpxSummary {
  distanceM: number;
  climbM: number | null;
  line: [number, number][];
  stops: { name: string; lat: number; lng: number }[];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  /**
   * The file's own name for the route, when it has one: the first track's, else the route's, else
   * the metadata's. Only a starting name for the form; the database never sees it.
   */
  name?: string;
}

export const NOT_GPX = 'That isn’t a GPX file.';
export const NO_TRACK = 'That route has no track in it.';
export const TOO_BIG = 'That file is too big (5 MB at most).';
/** When the phone or browser can't hand over the picked file's text. */
export const UNREADABLE = 'That file couldn’t be read. Try picking it again.';
/** The biggest GPX file a route can have, in UTF-8 bytes. The database has the same limit. */
export const MAX_BYTES = 5 * 1024 * 1024;
/** The most stops a route keeps: the first ones in the file. */
const MAX_STOPS = 100;
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

/** Which list each kind of point goes into. */
const BUCKET: Record<PointTag, 'trk' | 'rte' | 'wpt'> = { trkpt: 'trk', rtept: 'rte', wpt: 'wpt' };

/**
 * A plain decimal, as GPX's xsd:decimal allows: an optional sign, digits and an optional point.
 * No hex, no exponent, no Infinity, which Number() would otherwise accept.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** The number in a coordinate or height, or null when it isn't a plain decimal. */
function readDecimal(text: string): number | null {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

/** A character XML allows: tab, line feed, carriage return, and from space up, less U+FFFE and U+FFFF. */
const isXmlChar = (c: number) =>
  c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);

/** True when every character is one XML allows. A lone half of a surrogate pair isn't one. */
function onlyXmlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c < 0xd800) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
    } else if (!isXmlChar(c)) return false;
  }
  return true;
}

/** True when text[from, to) is all XML white space (space, tab, line feed, carriage return). */
function onlySpace(text: string, from: number, to: number): boolean {
  for (let p = from; p < to; p++) if (!isSpace(text.charCodeAt(p))) return false;
  return true;
}

/**
 * True for a name XML could accept. Only ASCII is checked: letters, digits, `_`, `:`, `-` and `.`,
 * not starting with a digit, `-` or `.`. Other characters are let through.
 */
function isName(s: string): boolean {
  if (s === '') return false;
  for (let p = 0; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c >= 128) continue;
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58;
    if (letter) continue;
    if (p > 0 && ((c >= 48 && c <= 57) || c === 45 || c === 46)) continue;
    return false;
  }
  return true;
}

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

const ENTITIES = ['amp;', 'lt;', 'gt;', 'quot;', 'apos;'];

/**
 * Where the reference that starts with the '&' at `amp` ends (just past its ';'), or -1 when it
 * isn't one: one of XML's five entities, or `&#123;` / `&#x7B;` naming a character XML allows.
 * Nothing else is defined in a GPX file, so `&nbsp;` isn't either.
 */
function refEnd(text: string, amp: number, limit: number): number {
  let p = amp + 1;
  if (text.charCodeAt(p) === 35) {
    p++;
    const hex = text.charCodeAt(p) === 120; // a lower-case x only, as XML has it
    if (hex) p++;
    const start = p;
    let code = 0;
    for (; p < limit; p++) {
      const c = text.charCodeAt(p);
      let d = -1;
      if (c >= 48 && c <= 57) d = c - 48;
      else if (hex && c >= 97 && c <= 102) d = c - 87;
      else if (hex && c >= 65 && c <= 70) d = c - 55;
      if (d < 0) break;
      if (code <= 0x10ffff) code = code * (hex ? 16 : 10) + d; // past the top it stays too big
    }
    return p > start && p < limit && text.charCodeAt(p) === 59 && isXmlChar(code) ? p + 1 : -1;
  }
  for (const e of ENTITIES) if (p + e.length <= limit && text.startsWith(e, p)) return p + e.length;
  return -1;
}

/**
 * True when text[from, to) is what XML accepts there: every '&' a good reference, and no '<'.
 * Character data (not `inValue`) can't hold `]]>` either; an attribute value can.
 */
function goodText(text: string, from: number, to: number, inValue = false): boolean {
  for (let p = from; p < to; p++) {
    const c = text.charCodeAt(p);
    if (c === 38) {
      const next = refEnd(text, p, to);
      if (next < 0) return false;
      p = next - 1;
    } else if (c === 60) return false;
    else if (!inValue && c === 93 && p + 2 < to && text.charCodeAt(p + 1) === 93 && text.charCodeAt(p + 2) === 62) return false;
  }
  return true;
}

/** Decodes the references in text that goodText has passed. */
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_whole, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    return String.fromCodePoint(e.charCodeAt(1) === 120 ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Index just past the comment starting at `lt`, or -1 when it never ends or holds `--`, as XML forbids. */
function commentEnd(text: string, lt: number): number {
  const end = text.indexOf('-->', lt + 4);
  if (end < 0 || text.indexOf('--', lt + 4) !== end) return -1;
  return end + 3;
}

/** A tag's lat and lon, as written; null for each one it doesn't have. */
interface Attrs {
  lat: string | null;
  lon: string | null;
}

/**
 * Reads the attributes in s[from, end): each a name, '=', and a quoted value with no '<' and only
 * good references, with white space between them and no name twice. Null when they aren't that.
 */
function readAttrs(s: string, from: number): Attrs | null {
  const out: Attrs = { lat: null, lon: null };
  const seen: string[] = [];
  let seenSet: Set<string> | null = null;
  const n = s.length;
  let p = from;
  for (;;) {
    const before = p;
    while (p < n && isSpace(s.charCodeAt(p))) p++;
    if (p >= n) return out;
    if (p === before) return null; // no white space before this attribute
    const start = p;
    while (p < n && s.charCodeAt(p) !== 61 && !isSpace(s.charCodeAt(p))) p++;
    const name = s.slice(start, p);
    if (!isName(name)) return null;
    while (p < n && isSpace(s.charCodeAt(p))) p++;
    if (s.charCodeAt(p) !== 61) return null;
    p++;
    while (p < n && isSpace(s.charCodeAt(p))) p++;
    const quote = s.charCodeAt(p);
    if (quote !== 34 && quote !== 39) return null;
    const close = s.indexOf(quote === 34 ? '"' : "'", p + 1);
    if (close < 0) return null;
    if (!goodText(s, p + 1, close, true)) return null;
    // Few tags have more than a handful of attributes; a set takes over for the odd one that does.
    if (seenSet) {
      if (seenSet.has(name)) return null;
      seenSet.add(name);
    } else {
      if (seen.includes(name)) return null;
      seen.push(name);
      if (seen.length > 16) seenSet = new Set(seen);
    }
    if (name === 'lat') out.lat = s.slice(p + 1, close);
    else if (name === 'lon') out.lon = s.slice(p + 1, close);
    p = close + 1;
  }
}

/** lat and lon as numbers, or null if either is missing or not a plain decimal in range. */
function readLatLon(attrs: Attrs): [number, number] | null {
  if (attrs.lat === null || attrs.lon === null) return null;
  const la = readDecimal(decodeEntities(attrs.lat));
  const lo = readDecimal(decodeEntities(attrs.lon));
  if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return [la, lo];
}

/** The text of an element from `from` to the next real tag, joining CDATA; null if the file ends first or isn't XML. */
function readText(text: string, from: number): { value: string; next: number } | null {
  let value = '';
  let pos = from;
  for (;;) {
    const lt = text.indexOf('<', pos);
    if (lt < 0 || !goodText(text, pos, lt)) return null;
    value += decodeEntities(text.slice(pos, lt));
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) return null;
      value += text.slice(lt + 9, end);
      pos = end + 3;
    } else if (text.startsWith('<!--', lt)) {
      pos = commentEnd(text, lt);
      if (pos < 0) return null;
    } else return { value: value.trim(), next: lt };
  }
}

interface Scanned {
  trk: RawPoint[];
  rte: RawPoint[];
  wpt: RawPoint[];
  /** The first non-empty <name> directly in a <trk>, a <rte> and the <metadata>. */
  names: { trk: string; rte: string; metadata: string };
}

/** Where a route's own name can be: directly inside one of these. */
const NAMED: ReadonlySet<string> = new Set(['trk', 'rte', 'metadata']);

/**
 * Walks the file once. Null means it isn't well-formed XML with a gpx root, or a point's
 * coordinates are bad. Well-formed is judged as Postgres (libxml2) judges it, since the database
 * checks the file again: after one optional byte order mark the XML declaration comes first if
 * there is one; text is only white space outside the root, where CDATA and elements can't be;
 * every '&' starts a good reference; attribute values have no '<' and no name repeats; and only
 * characters XML allows.
 */
function scan(text: string): Scanned | null {
  const out: Scanned = { trk: [], rte: [], wpt: [], names: { trk: '', rte: '', metadata: '' } };
  const stack: string[] = [];
  let sawRoot = false;
  let rootClosed = false;
  let sawDoctype = false;
  let cur: { tag: PointTag; depth: number; point: RawPoint } | null = null;
  const first = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!onlyXmlChars(text)) return null;
  let i = first;

  for (;;) {
    const lt = text.indexOf('<', i);
    // The text before this tag (or the end): character data inside the root, white space outside it.
    const textEnd = lt < 0 ? text.length : lt;
    if (stack.length > 0 ? !goodText(text, i, textEnd) : !onlySpace(text, i, textEnd)) return null;
    if (lt < 0) break;
    // Things that are not elements: comments, CDATA, processing instructions, the doctype.
    if (text.startsWith('<!--', lt)) {
      i = commentEnd(text, lt);
      if (i < 0) return null;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      if (stack.length === 0) return null;
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) return null;
      let targetEnd = lt + 2;
      while (targetEnd < end && !isSpace(text.charCodeAt(targetEnd))) targetEnd++;
      const target = text.slice(lt + 2, targetEnd);
      if (!isName(target)) return null;
      // `xml`, in any case, is the XML declaration, and that only comes first.
      if (target.toLowerCase() === 'xml' && lt !== first) return null;
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      // Only one doctype, before the root.
      if (!text.startsWith('<!DOCTYPE', lt) || sawRoot || sawDoctype) return null;
      sawDoctype = true;
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
    if (!isName(rawName)) return null;
    const local = localName(rawName);

    if (closing) {
      if (!onlySpace(inner, nameEnd, inner.length)) return null; // an end tag has no attributes
      if (stack.pop() !== rawName) return null;
      if (cur && cur.depth === stack.length && cur.tag === local) {
        out[BUCKET[cur.tag]].push(cur.point);
        cur = null;
      }
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    const attrs = readAttrs(inner, nameEnd);
    if (!attrs) return null;
    if (stack.length === 0) {
      if (rootClosed || local !== 'gpx') return null;
      sawRoot = true;
    }
    const parent = stack.length ? localName(stack[stack.length - 1]) : '';

    if (!cur && (local === 'trkpt' || local === 'rtept' || local === 'wpt')) {
      const at = readLatLon(attrs);
      if (!at) return null;
      const point: RawPoint = { lat: at[0], lng: at[1], ele: null, name: '' };
      if (selfClose) out[BUCKET[local]].push(point);
      else cur = { tag: local, depth: stack.length, point };
    } else if (cur && !selfClose && (local === 'ele' || local === 'name') && parent === cur.tag) {
      const read = readText(text, i);
      if (!read) return null;
      i = read.next;
      if (local === 'name') cur.point.name = read.value;
      else {
        // A height that isn't a plain decimal is left out, as if the point had none.
        const ele = readDecimal(read.value);
        if (ele !== null) cur.point.ele = ele;
      }
    } else if (!cur && !selfClose && local === 'name' && NAMED.has(parent)) {
      const slot = parent as keyof Scanned['names'];
      if (out.names[slot] === '') {
        const read = readText(text, i);
        if (!read) return null;
        i = read.next;
        out.names[slot] = read.value;
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
  return simplifyIndices(points, max).map((k) => points[k]);
}

/** Which points simplify keeps, as indices in order. */
export function simplifyIndices(points: [number, number][], max = 300): number[] {
  const n = points.length;
  if (n <= max || n <= 2) return points.map((_p, k) => k);
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
  // The open segments, as a binary max-heap on dist, so taking the farthest one is cheap even
  // when thousands of points are kept.
  type Seg = { lo: number; hi: number; index: number; dist: number };
  const open: Seg[] = [];
  const push = (seg: Seg) => {
    let k = open.push(seg) - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (open[up].dist >= open[k].dist) break;
      [open[up], open[k]] = [open[k], open[up]];
      k = up;
    }
  };
  const pop = (): Seg => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let big = k;
        if (l < open.length && open[l].dist > open[big].dist) big = l;
        if (r < open.length && open[r].dist > open[big].dist) big = r;
        if (big === k) break;
        [open[big], open[k]] = [open[k], open[big]];
        k = big;
      }
    }
    return top;
  };
  const add = (lo: number, hi: number) => {
    if (hi - lo < 2) return;
    const f = farthest(lo, hi);
    if (f.index >= 0) push({ lo, hi, ...f });
  };
  add(0, n - 1);
  while (kept < max && open.length > 0) {
    const seg = pop();
    keep[seg.index] = 1;
    kept++;
    add(seg.lo, seg.index);
    add(seg.index, seg.hi);
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(k);
  return out;
}

// ---- The reader ----

/** The points a route is drawn from, at full detail, with the stops as readGpx names them. */
export interface GpxPoints {
  track: { lat: number; lng: number; ele: number | null }[];
  stops: GpxSummary['stops'];
}

/** The stops in a scanned file: the first MAX_STOPS waypoints, unnamed ones numbered. */
function stopsOf(scanned: Scanned): GpxSummary['stops'] {
  return scanned.wpt.slice(0, MAX_STOPS).map((w, k) => ({ name: w.name !== '' ? w.name : `Stop ${k + 1}`, lat: w.lat, lng: w.lng }));
}

/**
 * Reads every track point (route points when there is no track) and the stops, or returns the
 * message readGpx would. For writing the route out again, as the Garmin copy does.
 */
export function readGpxPoints(text: string): GpxPoints | string {
  if (text.length > MAX_BYTES || utf8Bytes(text) > MAX_BYTES) return TOO_BIG;
  const scanned = scan(text);
  if (!scanned) return NOT_GPX;
  const chosen = scanned.trk.length > 0 ? scanned.trk : scanned.rte;
  if (chosen.length < 2) return NO_TRACK;
  return { track: chosen.map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele })), stops: stopsOf(scanned) };
}

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

  const name = scanned.names.trk || scanned.names.rte || scanned.names.metadata;
  return {
    ...(name ? { name } : {}),
    distanceM: Math.round(distance),
    climbM: withEle >= 2 ? Math.round(climb) : null,
    line: simplify(coords),
    stops: stopsOf(scanned),
    bounds: { minLat, minLng, maxLat, maxLng },
  };
}
