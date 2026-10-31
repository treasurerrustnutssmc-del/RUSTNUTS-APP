// The ride replay: a ride's locked route played back as a short animation, for the screen and for
// a video file to share. It only uses what's already stored (the route's line and named stops, and
// the ride's title, date and colour). Nobody's GPS is kept, so there's no track to replay.
//
// The timeline: a title card, then a marker riding the route at an even pace with a short hold at
// each stop, then an end card with the whole route and its numbers.

import { formatAuDate } from './dates';
import { RIDE_CATEGORY_LABEL } from './labels';
import { melbourneDate } from './rides';
import { formatClimb, formatKm } from './routes';
import type { Ride, Route } from './types';

/** Frames a second in the video file. The screen plays smoothly and samples the same timeline. */
export const FPS = 10;

const INTRO_MS = 1500;
const TRAVEL_MS = 8000;
const OUTRO_MS = 2500;
const HOLD_MS = 800;
/** The most time all the holds together can take, so a route with many stops doesn't drag. */
const ALL_HOLDS_MS = 4000;

type Line = Route['line'];

export interface ReplayStop {
  name: string;
  /** Where it falls along the route, 0 to 1. */
  at: number;
  /** Its own position, for its pin. */
  lat: number;
  lng: number;
}

export interface ReplayPlan {
  line: Line;
  /** Metres along the line at each point. */
  cum: number[];
  /** The line's measured length in metres. */
  total: number;
  /** The length on file (from the GPX), which the distance counter shows. */
  distanceM: number;
  stops: ReplayStop[];
  introMs: number;
  outroMs: number;
  /** The hold at each stop. */
  holdMs: number;
  durationMs: number;
}

export interface ReplayFrame {
  phase: 'intro' | 'ride' | 'outro';
  /** How far along the route the marker is, 0 to 1. */
  fraction: number;
  /** Metres ridden so far, on the route's own distance. */
  distanceM: number;
  /** How many stops the marker has reached. */
  reached: number;
  /** The stop the marker is holding at, if any. */
  atStop: ReplayStop | null;
}

/** Whether a route has enough of a line to play. */
export function canReplay(route: Pick<Route, 'line'> | null | undefined): boolean {
  return !!route && route.line.length >= 2;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

function metres([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Where a stop falls along the line: the nearest point on any segment, as a share of the length. */
function stopFraction(line: Line, cum: number[], total: number, lat: number, lng: number): number {
  if (total <= 0) return 0;
  const kx = Math.cos(rad(lat));
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [aLat, aLng] = line[i];
    const [bLat, bLng] = line[i + 1];
    const dx = (bLng - aLng) * kx;
    const dy = bLat - aLat;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (((lng - aLng) * kx) * dx + (lat - aLat) * dy) / len2)) : 0;
    const px = (lng - aLng) * kx - t * dx;
    const py = lat - aLat - t * dy;
    const d2 = px * px + py * py;
    if (d2 < best) {
      best = d2;
      at = (cum[i] + t * (cum[i + 1] - cum[i])) / total;
    }
  }
  return at;
}

/** Measures the route and lays out its timeline. */
export function replayPlan(route: Pick<Route, 'line' | 'stops' | 'distanceM'>): ReplayPlan {
  const line = route.line;
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + metres(line[i - 1], line[i]));
  const total = cum[cum.length - 1] ?? 0;
  const stops = route.stops
    .map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, at: stopFraction(line, cum, total, s.lat, s.lng) }))
    .sort((a, b) => a.at - b.at);
  const holdMs = stops.length > 0 ? Math.min(HOLD_MS, Math.floor(ALL_HOLDS_MS / stops.length)) : 0;
  return {
    line,
    cum,
    total,
    distanceM: route.distanceM,
    stops,
    introMs: INTRO_MS,
    outroMs: OUTRO_MS,
    holdMs,
    durationMs: INTRO_MS + TRAVEL_MS + holdMs * stops.length + OUTRO_MS,
  };
}

/** The `[lat, lng]` a share `f` of the way along the route. */
export function pointAt(plan: ReplayPlan, f: number): [number, number] {
  const { line, cum, total } = plan;
  if (f <= 0 || total <= 0) return [line[0][0], line[0][1]];
  if (f >= 1) return [line[line.length - 1][0], line[line.length - 1][1]];
  const d = f * total;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (d - cum[i]) / seg : 0;
  return [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])];
}

/** The route ridden so far: every point before the marker, then the marker. */
export function partialLine(plan: ReplayPlan, f: number): [number, number][] {
  const d = Math.max(0, Math.min(1, f)) * plan.total;
  const out: [number, number][] = [];
  for (let i = 0; i < plan.line.length && plan.cum[i] < d; i++) out.push(plan.line[i]);
  out.push(pointAt(plan, f));
  return out;
}

/** Where the replay is at `ms` from its start. */
export function frameAt(plan: ReplayPlan, ms: number): ReplayFrame {
  const n = plan.stops.length;
  const frame = (phase: ReplayFrame['phase'], fraction: number, atStop: ReplayStop | null): ReplayFrame => ({
    phase,
    fraction,
    distanceM: Math.round(fraction * plan.distanceM),
    reached: atStop ? plan.stops.indexOf(atStop) + 1 : plan.stops.filter((s) => s.at <= fraction).length,
    atStop,
  });
  if (ms < plan.introMs) return frame('intro', 0, null);
  const e = ms - plan.introMs;
  if (e >= TRAVEL_MS + plan.holdMs * n) return frame('outro', 1, null);
  for (let i = 0; i < n; i++) {
    const s = plan.stops[i];
    const reach = s.at * TRAVEL_MS + i * plan.holdMs;
    if (e < reach) return frame('ride', (e - i * plan.holdMs) / TRAVEL_MS, null);
    if (e < reach + plan.holdMs) return frame('ride', s.at, s);
  }
  return frame('ride', Math.min(1, (e - n * plan.holdMs) / TRAVEL_MS), null);
}

/** The words on the title card: the ride, its date (DD/MM/YYYY) and its calendar colour's name. */
export function replayCaption(ride: Pick<Ride, 'title' | 'startsAt' | 'category'>): { title: string; date: string; category: string } {
  return { title: ride.title, date: formatAuDate(melbourneDate(ride.startsAt)), category: RIDE_CATEGORY_LABEL[ride.category] };
}

/** The numbers on the end card: distance, then stops and climb when there are any. */
export function replayStats(route: Pick<Route, 'distanceM' | 'climbM' | 'stops'>): string[] {
  const climb = formatClimb(route.climbM);
  return [
    formatKm(route.distanceM),
    ...(route.stops.length > 0 ? [route.stops.length === 1 ? '1 stop' : `${route.stops.length} stops`] : []),
    ...(climb ? [`${climb} climb`] : []),
  ];
}

/** The video's file name, with the same safe characters as a route's GPX. */
export function replayFileName(title: string): string {
  const kept = title.replace(/([\p{L}\p{N}]\p{M}*)|[^\- _]/gu, (_all, letter?: string) => letter ?? '');
  return `${kept.trim() || 'ride'} replay.gif`;
}

/**
 * Splits text into at most `maxLines` lines of about `maxChars` (SVG text doesn't wrap). Whatever
 * doesn't fit ends the last line with an ellipsis, and so does a word too long for a line.
 * When everything fits on two lines, the words are split evenly between them.
 */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  const clip = (s: string) => (s.length + 1 > maxChars ? `${s.slice(0, maxChars - 1).trimEnd()}…` : `${s}…`);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length > maxChars) {
      if (lines.length < maxLines) lines.push(clip(w.slice(0, maxChars - 1)));
      else lines[lines.length - 1] = clip(lines[lines.length - 1]);
      return lines;
    }
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + w.length <= maxChars) lines[lines.length - 1] = `${last} ${w}`;
    else if (lines.length < maxLines) lines.push(w);
    else {
      lines[lines.length - 1] = clip(last);
      return lines;
    }
  }
  return lines.length === 2 ? evenSplit(words) : lines;
}

/** Two lines with the longer one as short as it can be (the first wins a tie). */
function evenSplit(words: string[]): string[] {
  let best = [words.join(' ')];
  let longest = Infinity;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const n = Math.max(pair[0].length, pair[1].length);
    if (n < longest) {
      best = pair;
      longest = n;
    }
  }
  return best;
}

/** Where the title card's parts sit on the 450×800 card. */
export interface TitleLayout {
  logo: { y: number; w: number; h: number };
  panel: { x: number; y: number; w: number; h: number };
  titleSize: number;
  dateSize: number;
  /** The baseline of each title line. */
  lineYs: number[];
  /** The baseline of the date and chapter line. */
  dateY: number;
}

const LOGO_W = 140;
const LOGO = { y: 28, w: LOGO_W, h: Math.round((LOGO_W * 765) / 1093) };
const PANEL = { x: 20, y: 268, w: 410, h: 392 };
const TITLE_SIZE = 30;
const TITLE_STEP = 34;
const DATE_SIZE = 17;
const DATE_GAP = 12;

/** Stacks the title lines and the date line, centred in the gap between the logo and the map. */
export function titleLayout(lines: number): TitleLayout {
  const capTop = TITLE_SIZE * 0.75;
  const height = (lines > 0 ? capTop + (lines - 1) * TITLE_STEP + DATE_GAP : 0) + DATE_SIZE;
  const top = (LOGO.y + LOGO.h + PANEL.y - height) / 2;
  const first = top + capTop;
  const lineYs = Array.from({ length: lines }, (_, i) => Math.round(first + i * TITLE_STEP));
  const dateY = Math.round(lines > 0 ? first + (lines - 1) * TITLE_STEP + DATE_GAP + DATE_SIZE : top + DATE_SIZE * 0.75);
  return { logo: LOGO, panel: PANEL, titleSize: TITLE_SIZE, dateSize: DATE_SIZE, lineYs, dateY };
}
