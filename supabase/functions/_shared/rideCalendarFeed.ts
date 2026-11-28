// A member's own ride calendar: the rides they marked Going, as an iCalendar file that Google,
// Outlook and Apple Calendar subscribe to. Without the network or the database (passed in), so
// `npm test` runs exactly what the calendar-feed Edge Function runs.
//   GET /<token>.ics   the calendar (public.calendar_feed gives the rides; an unknown token is a 404)
// Spec: docs/superpowers/specs/2026-11-28-personal-ride-calendar-design.md.

export interface FeedRide {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  cancelled_at: string | null;
  leg_no: number | null;
  leg_count: number | null;
}

export interface FeedDeps {
  /** The token's Going rides, or null when no member has that token. */
  feed: (token: string) => Promise<FeedRide[] | null>;
}

export interface FeedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Calendar apps refetch on their own clock; this only stops shared caches keeping it. */
export const FEED_CACHE = 'private, max-age=900';
/** A ride with a start and no finish fills four hours, as the club assistant's calendar entries do. */
const DEFAULT_HOURS = 4;
const TOKEN = /^\/([0-9a-f]{64})(?:\.ics)?$/;

/** The token in /<token>.ics, or null. Tokens are 64 lowercase hex characters. */
export function tokenFromPath(path: string): string | null {
  return TOKEN.exec(path)?.[1] ?? null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** The Melbourne date of an instant, as YYYYMMDD. */
function melbourneDay(ms: number): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))) {
    p[x.type] = x.value;
  }
  return `${p.year}${p.month}${p.day}`;
}

function nextDay(day: string): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** RFC 5545 text: backslash, semicolon, comma and line ends escaped. */
function text(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a line at 75 octets, never inside a character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // The first line has 75 octets; each folded line starts with a space, leaving 74.
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function event(r: FeedRide, stamp: string): string[] {
  const start = new Date(r.starts_at).getTime();
  const when = r.all_day
    ? (() => {
        // A calendar's all-day end is the midnight after the last day, so the last day is a moment before it.
        const first = melbourneDay(start);
        const last = r.ends_at ? melbourneDay(Math.max(start, new Date(r.ends_at).getTime() - 1)) : first;
        return [`DTSTART;VALUE=DATE:${first}`, `DTEND;VALUE=DATE:${nextDay(last)}`];
      })()
    : [
        `DTSTART:${utcStamp(r.starts_at)}`,
        `DTEND:${utcStamp(r.ends_at && new Date(r.ends_at).getTime() > start ? r.ends_at : new Date(start + DEFAULT_HOURS * 3600_000).toISOString())}`,
      ];
  const notes = [
    r.leg_no && r.leg_count ? `Leg ${r.leg_no} of ${r.leg_count}` : null,
    r.notes?.trim() || null,
    'From the Rustnuts app',
  ].filter((x): x is string => !!x);
  return [
    'BEGIN:VEVENT',
    `UID:${r.id}@rustnutssmc.com.au`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${text(r.cancelled_at ? `CALLED OFF: ${r.title.trim()}` : r.title.trim())}`,
    ...(r.location?.trim() ? [`LOCATION:${text(r.location.trim())}`] : []),
    `DESCRIPTION:${text(notes.join('\n\n'))}`,
    `STATUS:${r.cancelled_at ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

/** The whole calendar, CRLF line ends, folded. */
export function buildCalendar(rides: FeedRide[], now: string): string {
  const stamp = utcStamp(now);
  const all = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rustnuts SMC//Ride calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Rustnuts rides',
    'X-WR-CALDESC:The rides you marked Going in the Rustnuts app',
    'X-WR-TIMEZONE:Australia/Melbourne',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...rides.flatMap((r) => event(r, stamp)),
    'END:VCALENDAR',
  ];
  return all.map(fold).join('\r\n') + '\r\n';
}

const plain = (status: number, body: string): FeedResponse => ({
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  body,
});

export async function handleCalendarFeed(req: { method: string; path: string }, deps: FeedDeps, now: string): Promise<FeedResponse> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'Use GET.');
  const token = tokenFromPath(req.path);
  if (!token) return plain(404, 'No such calendar.');
  let rides: FeedRide[] | null;
  try {
    rides = await deps.feed(token);
  } catch {
    return plain(500, 'The calendar couldn’t load just now. Your calendar app will try again.');
  }
  if (!rides) return plain(404, 'No such calendar. Make a new link in the Rustnuts app: Me, Rides in my calendar.');
  return {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': FEED_CACHE,
      'content-disposition': 'inline; filename="rustnuts-rides.ics"',
    },
    body: req.method === 'HEAD' ? '' : buildCalendar(rides, now),
  };
}
