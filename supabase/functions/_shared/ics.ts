// Reads a calendar feed (iCal, as Google Calendar publishes it) into rides. Plain TypeScript with
// no imports, so the sync-rides Edge Function (Deno) and `npm test` (Node) run the same code.

export type RideCategory = 'north' | 'west' | 'club' | 'supported' | 'non_nuts';

export interface FeedEvent {
  uid: string;
  /** ISO instant (UTC). */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  title: string;
  location: string | null;
  notes: string | null;
  /** The event's first CATEGORIES value, if any. */
  categoryHint: string | null;
}

const CLUB_ZONE = 'Australia/Melbourne';
const HOUR = 3600_000;
const MAX_STEPS = 2000;

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Wall-clock time in some zone. Months are 1-12. */
interface Local {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

interface When {
  local: Local;
  zone: string | null; // null = UTC
  allDay: boolean;
}

// ---------------------------------------------------------------------------
// Time zones

function validZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: zone });
    return zone;
  } catch {
    return CLUB_ZONE;
  }
}

/** How far ahead of UTC the zone's clocks are at this instant, in ms. */
function zoneOffset(ms: number, zone: string): number {
  const p: Record<string, number> = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ms;
}

const asUtc = (l: Local) => Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s);

/** The instant at which the zone's clocks show this wall-clock time. */
function toInstant(w: When): number {
  const guess = asUtc(w.local);
  if (w.zone === null) return guess;
  const first = guess - zoneOffset(guess, w.zone);
  const second = guess - zoneOffset(first, w.zone);
  return second;
}

// ---------------------------------------------------------------------------
// Lines and values

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function parseLine(line: string): Prop | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function parseWhen(value: string, params: Record<string, string>): When | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const local: Local = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  if (!m[4]) return { local, zone: CLUB_ZONE, allDay: true };
  if (m[7]) return { local, zone: null, allDay: false };
  return { local, zone: params.TZID ? validZone(params.TZID) : CLUB_ZONE, allDay: false };
}

/** PT2H30M, P1D, P1W → ms. */
function parseDuration(v: string): number | null {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60_000 + +(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---------------------------------------------------------------------------
// Repeats (the parts of RRULE club calendars use)

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function addDays(l: Local, n: number): Local {
  const t = new Date(Date.UTC(l.y, l.mo - 1, l.d + n));
  return { ...l, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const weekday = (l: Local) => new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay();
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** The nth (1-5, or -1 for last) given weekday of a month, or null when there isn't one. */
function nthWeekday(y: number, mo: number, day: number, n: number): number | null {
  const firstDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const count = daysInMonth(y, mo);
  if (n > 0) {
    const d = 1 + ((day - firstDow + 7) % 7) + (n - 1) * 7;
    return d <= count ? d : null;
  }
  const lastDow = new Date(Date.UTC(y, mo - 1, count)).getUTCDay();
  return count - ((lastDow - day + 7) % 7) + (n + 1) * 7;
}

/** Every start of a repeating event, as wall-clock times in its own zone, until `limit`. */
function expand(start: When, rule: string, limit: number): Local[] {
  const r: Record<string, string> = {};
  for (const part of rule.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) r[k.toUpperCase()] = v.toUpperCase();
  }
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const untilWhen = r.UNTIL ? parseWhen(r.UNTIL, {}) : null;
  const until = untilWhen ? toInstant(untilWhen.allDay ? { ...untilWhen, local: addDays(untilWhen.local, 1) } : untilWhen) - (untilWhen.allDay ? 1 : 0) : Infinity;
  const byDay = (r.BYDAY ?? '').split(',').filter(Boolean).map((t) => {
    const m = t.match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
    return m ? { n: m[1] ? Number(m[1]) : 0, day: DAYS.indexOf(m[2]) } : null;
  }).filter((x): x is { n: number; day: number } => x !== null);

  const out: Local[] = [];
  const s = start.local;
  const startMs = toInstant(start);
  const take = (l: Local): boolean => {
    const ms = toInstant({ ...start, local: l });
    if (ms < startMs) return true;
    if (ms > until || ms >= limit || out.length >= count) return false;
    out.push(l);
    return true;
  };

  if (freq === 'DAILY') {
    for (let i = 0; i < MAX_STEPS && take(addDays(s, i * interval)); i++);
  } else if (freq === 'WEEKLY') {
    const days = byDay.length ? byDay.map((b) => b.day).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [weekday(s)];
    const monday = addDays(s, -((weekday(s) + 6) % 7));
    outer: for (let w = 0; w < MAX_STEPS; w++) {
      for (const day of days) {
        if (!take(addDays(monday, w * 7 * interval + ((day + 6) % 7)))) break outer;
      }
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; i < MAX_STEPS; i++) {
      const total = s.mo - 1 + i * interval;
      const y = s.y + Math.floor(total / 12);
      const mo = (total % 12) + 1;
      const dates = byDay.length
        ? byDay.map((b) => nthWeekday(y, mo, b.day, b.n || 1)).filter((d): d is number => d !== null).sort((a, b) => a - b)
        : s.d <= daysInMonth(y, mo) ? [s.d] : [];
      let keepGoing = true;
      for (const d of dates) if (!(keepGoing = take({ ...s, y, mo, d }))) break;
      if (!keepGoing) break;
    }
  } else if (freq === 'YEARLY') {
    for (let i = 0; i < MAX_STEPS; i++) {
      const y = s.y + i * interval;
      if (s.d > daysInMonth(y, s.mo)) continue;
      if (!take({ ...s, y })) break;
    }
  } else {
    out.push(s); // a repeat we don't follow: keep the first one rather than lose the ride
  }
  return out;
}

// ---------------------------------------------------------------------------
// The feed

/** Rides starting in [windowStart, windowEnd), in start order. Throws 'Not a calendar'. */
export function parseIcs(text: string, windowStart: string, windowEnd: string): FeedEvent[] {
  if (!/^BEGIN:VCALENDAR/m.test(text)) throw new Error('Not a calendar');
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');

  const blocks: Prop[][] = [];
  let current: Prop[] | null = null;
  let depth = 0; // skip VALARMs and the like inside an event
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = []; depth = 0; continue; }
    if (line === 'END:VEVENT') { if (current) blocks.push(current); current = null; continue; }
    if (!current) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:')) { depth--; continue; }
    if (depth > 0) continue;
    const prop = parseLine(line);
    if (prop) current.push(prop);
  }

  const from = Date.parse(windowStart);
  const to = Date.parse(windowEnd);
  const one = (b: Prop[], name: string) => b.find((p) => p.name === name);
  const text1 = (b: Prop[], name: string) => {
    const v = one(b, name)?.value;
    return v === undefined || v.trim() === '' ? null : unescapeText(v).trim();
  };

  const masters = new Map<string, Prop[]>();
  const overrides: { uid: string; at: number; block: Prop[] }[] = [];
  for (const b of blocks) {
    const uid = one(b, 'UID')?.value.trim();
    if (!uid || !one(b, 'DTSTART')) continue;
    const rid = one(b, 'RECURRENCE-ID');
    const ridWhen = rid ? parseWhen(rid.value, rid.params) : null;
    if (ridWhen) overrides.push({ uid, at: toInstant(ridWhen), block: b });
    else masters.set(uid, b);
  }

  const events: FeedEvent[] = [];
  const emit = (uid: string, b: Prop[], startMs: number, allDay: boolean, lengthMs: number | null) => {
    if (startMs < from || startMs >= to) return;
    if ((one(b, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') return;
    const categories = one(b, 'CATEGORIES')?.value;
    events.push({
      uid,
      startsAt: new Date(startMs).toISOString(),
      endsAt: lengthMs === null ? null : new Date(startMs + lengthMs).toISOString(),
      allDay,
      title: text1(b, 'SUMMARY') ?? 'Ride',
      location: text1(b, 'LOCATION'),
      notes: text1(b, 'DESCRIPTION'),
      categoryHint: categories ? unescapeText(categories.split(/(?<!\\),/)[0]).trim() || null : null,
    });
  };

  /** Ride length: from DTEND or DURATION; an hour for a timed ride; none for a one-day all-day ride. */
  const lengthOf = (b: Prop[], start: When): number | null => {
    const startMs = toInstant(start);
    const endProp = one(b, 'DTEND');
    const end = endProp ? parseWhen(endProp.value, endProp.params) : null;
    let length = end ? toInstant(end) - startMs : null;
    const dur = one(b, 'DURATION');
    if (length === null && dur) length = parseDuration(dur.value.trim());
    if (start.allDay) return length !== null && length > 25 * HOUR ? length : null;
    return length !== null && length > 0 ? length : HOUR;
  };

  for (const [uid, b] of masters) {
    const dt = one(b, 'DTSTART')!;
    const start = parseWhen(dt.value, dt.params);
    if (!start) continue;
    const length = lengthOf(b, start);
    const rule = one(b, 'RRULE')?.value;
    const skip = new Set<number>();
    for (const ex of b.filter((p) => p.name === 'EXDATE')) {
      for (const v of ex.value.split(',')) {
        const w = parseWhen(v, ex.params);
        if (w) skip.add(toInstant(w));
      }
    }
    for (const o of overrides) if (o.uid === uid) skip.add(o.at);
    const locals = rule ? expand(start, rule, to) : [start.local];
    for (const local of locals) {
      const ms = toInstant({ ...start, local });
      if (!skip.has(ms)) emit(uid, b, ms, start.allDay, length);
    }
  }

  for (const o of overrides) {
    const dt = one(o.block, 'DTSTART')!;
    const start = parseWhen(dt.value, dt.params);
    if (start) emit(o.uid, o.block, toInstant(start), start.allDay, lengthOf(o.block, start));
  }

  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.uid.localeCompare(b.uid));
}

const PREFIXES: [RegExp, RideCategory][] = [
  [/^north\b/i, 'north'],
  [/^west\b/i, 'west'],
  [/^rustnuts\b/i, 'club'],
  [/^supported\b/i, 'supported'],
  [/^non[\s-]?nuts\b/i, 'non_nuts'],
];

/** The ride's colour: the feed's own colour, then a "West:"-style title prefix, then its category. */
export function categoryFor(feedCategory: RideCategory | null, ev: FeedEvent): RideCategory {
  if (feedCategory) return feedCategory;
  const prefix = ev.title.match(/^([^:]{1,20}):/)?.[1].trim();
  for (const source of [prefix, ev.categoryHint]) {
    if (!source) continue;
    for (const [re, cat] of PREFIXES) if (re.test(source)) return cat;
  }
  return 'club';
}
