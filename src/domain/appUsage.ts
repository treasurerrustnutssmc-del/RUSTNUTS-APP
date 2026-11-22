/**
 * App usage: which screens members reach, where a visit ends, which journeys get finished, and
 * the error messages people actually see. Nothing about who: a visit is a random id made when the
 * app opens and kept only in memory. The database mirrors these limits
 * (supabase/migrations/*_app_usage.sql); change both together.
 * Spec: docs/superpowers/specs/2026-11-21-app-usage-design.md
 */

export const USAGE_NAME_MAX = 60;
/** Events kept on the phone waiting to be sent; the oldest drop off past this. */
export const USAGE_QUEUE_MAX = 200;
/** Events sent in one call. */
export const USAGE_BATCH_MAX = 50;
/** How often the phone sends what it has, in milliseconds (also on going to the background). */
export const USAGE_FLUSH_MS = 30_000;
export const USAGE_DAYS = 30;

const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export type UsageKind = 'screen' | 'error';

export interface UsageEvent {
  seq: number;
  kind: UsageKind;
  name: string;
  /** For an error, its kind; null for a screen. */
  detail: ErrorKind | null;
}

/** A screen (route) name as counted, or null when it isn't one (the event is then dropped). */
export function cleanUsageName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > USAGE_NAME_MAX || !NAME.test(name)) return null;
  return name;
}

/** What sort of error a member saw. The words themselves are never kept: they can quote people. */
export type ErrorKind = 'connection' | 'not-allowed' | 'form' | 'other';
export const ERROR_KINDS: ErrorKind[] = ['connection', 'not-allowed', 'form', 'other'];

export const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  connection: 'Connection',
  'not-allowed': 'Not allowed',
  form: 'Form to fix',
  other: 'Something went wrong',
};

/** Sorts an error message shown on screen into a kind; null for an empty one. */
export function errorKind(message: string): ErrorKind | null {
  const text = message.trim();
  if (!text) return null;
  if (/connection|offline|network|internet|timed out|signal/i.test(text)) return 'connection';
  if (/\bonly\b|not allowed|can[’']t do that|permission|sign in first/i.test(text)) return 'not-allowed';
  if (/marked in red|fill in|fields?\b|required|must be|enter (a|an|your)|too long|pick (a|an)/i.test(text)) return 'form';
  return 'other';
}

/** The shape of React Navigation state this needs: enough to walk down to the focused screen. */
export interface NavStateLike {
  index?: number;
  routes: { name: string; state?: NavStateLike }[];
}

/** The screen actually showing: the focused route of the deepest navigator. */
export function focusedRouteName(state: NavStateLike | undefined): string | null {
  let s = state;
  let name: string | null = null;
  while (s && s.routes.length) {
    const r = s.routes[s.index ?? s.routes.length - 1] ?? s.routes[0];
    name = r.name;
    s = r.state;
  }
  return name;
}

/** The events of one app visit waiting to be sent. */
export class UsageQueue {
  enabled = true;
  private seq = 0;
  private items: UsageEvent[] = [];
  private lastScreen: string | null = null;
  private lastError: string | null = null;

  get size(): number {
    return this.items.length;
  }

  screen(raw: string): void {
    const name = cleanUsageName(raw);
    if (!this.enabled || !name || name === this.lastScreen) return;
    this.lastScreen = name;
    this.lastError = null;
    this.push({ kind: 'screen', name, detail: null });
  }

  error(rawScreen: string, message: string): void {
    const name = cleanUsageName(rawScreen);
    const detail = errorKind(message);
    if (!this.enabled || !name || !detail) return;
    const key = `${name}\n${detail}`;
    if (key === this.lastError) return;
    this.lastError = key;
    this.push({ kind: 'error', name, detail });
  }

  /** Empties the queue (the member switched it off). */
  clear(): void {
    this.items = [];
    this.lastScreen = null;
    this.lastError = null;
  }

  /** The next batch to send, oldest first; taken events leave the queue. */
  take(): UsageEvent[] {
    return this.items.splice(0, USAGE_BATCH_MAX);
  }

  private push(e: Omit<UsageEvent, 'seq'>): void {
    this.items.push({ seq: ++this.seq, ...e });
    if (this.items.length > USAGE_QUEUE_MAX) this.items.splice(0, this.items.length - USAGE_QUEUE_MAX);
  }
}

/** One visit's screens in order, as app_usage_summary() returns them. */
export interface UsageVisit {
  screens: string[];
}

export interface ScreenRow {
  name: string;
  views: number;
  visits: number;
  /** Visits whose last screen was this one: where people put the phone down (or gave up). */
  endedHere: number;
}

/** Per screen: views, visits that reached it, visits that ended on it. Busiest first. */
export function screenTable(visits: UsageVisit[]): ScreenRow[] {
  const rows = new Map<string, ScreenRow>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) rows.set(name, (r = { name, views: 0, visits: 0, endedHere: 0 }));
    return r;
  };
  for (const v of visits) {
    if (!v.screens.length) continue;
    for (const s of v.screens) row(s).views++;
    for (const s of new Set(v.screens)) row(s).visits++;
    row(v.screens[v.screens.length - 1]).endedHere++;
  }
  return [...rows.values()].sort((a, b) => b.views - a.views || b.visits - a.visits || a.name.localeCompare(b.name));
}

export interface Journey {
  id: string;
  label: string;
  /** Route names, in the order a member goes through them. */
  steps: string[];
}

/** Keys the app's navigator uses when nobody is signed in to a member record yet. */
const NOT_A_PERSON = new Set(['signed-out', 'applying', 'load-error']);

/**
 * Whether the navigator moving to `nextKey` starts a new usage visit. `lastPerson` is the member last
 * signed in during this visit (null if nobody yet). Signing in carries the visit on, so the Sign in →
 * Home journey can finish in one visit; signing out, or a different person, starts a new one so two
 * people on one phone stay apart. A load error is neither.
 */
export function startsNewVisit(lastPerson: string | null, nextKey: string): boolean {
  if (lastPerson === null || nextKey === 'load-error') return false;
  if (NOT_A_PERSON.has(nextKey)) return true;
  return nextKey !== lastPerson;
}

/** The jobs worth finishing, as screens in order. The last step reached means it got done. */
export const JOURNEYS: Journey[] = [
  { id: 'sign-in', label: 'Sign in', steps: ['SignIn', 'Home'] },
  { id: 'join', label: 'Ask to join', steps: ['Join', 'Pending'] },
  { id: 'shop', label: 'Shop order', steps: ['ShopCart', 'ShopCheckout', 'ShopOrder'] },
];

export interface JourneyCount {
  id: string;
  label: string;
  steps: { name: string; visits: number }[];
  started: number;
  finished: number;
}

/** For each journey: how many visits reached each step in order, from the first. */
export function journeyCounts(visits: UsageVisit[]): JourneyCount[] {
  return JOURNEYS.map((j) => {
    const reached = j.steps.map(() => 0);
    for (const v of visits) {
      let step = 0;
      for (const s of v.screens) {
        if (step < j.steps.length && s === j.steps[step]) {
          reached[step]++;
          step++;
        }
      }
    }
    return {
      id: j.id,
      label: j.label,
      steps: j.steps.map((name, i) => ({ name, visits: reached[i] })),
      started: reached[0],
      finished: reached[reached.length - 1],
    };
  });
}

/** Screens whose route name reads wrongly on its own (one chat versus the list of chats). */
const SCREEN_LABELS: Record<string, string> = {
  Chat: 'A chat',
  Chats: 'Chat list',
  RideDetail: 'A ride',
  MemberDetail: 'A member',
  Tabs: 'Home',
};

/** A screen name for people: "ShopCheckout" reads "Shop checkout". */
export function screenLabel(name: string): string {
  if (SCREEN_LABELS[name]) return SCREEN_LABELS[name];
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
