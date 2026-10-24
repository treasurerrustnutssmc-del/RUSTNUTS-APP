// The plain parts of live ride on the phone: which alerts are new, what their notification says,
// and the queue that holds alerts raised with no signal until they can be sent.

import { awayText, LIVE_MSG } from '../domain/liveRide';
import { melbourneTime } from '../domain/rides';
import type { AlertKind, LatLng, RideAlert } from '../domain/types';

/** Open alerts from other riders that this phone hasn't told its owner about yet. */
export function unseenAlerts(seen: string[], alerts: RideAlert[], meId: string): RideAlert[] {
  return alerts.filter((a) => !a.resolvedAt && a.memberId !== meId && !seen.includes(a.id));
}

const TITLE: Record<AlertKind, (name: string) => string> = {
  emergency: (name) => `EMERGENCY: ${name} needs help`,
  out: (name) => `${name} has dropped out`,
  regroup: () => 'Regroup here',
};

export function alertNotice(alert: RideAlert, myPos: LatLng | null): { title: string; body: string } {
  const where = awayText(myPos, alert.position) ?? 'Location unknown';
  return { title: TITLE[alert.kind](alert.name), body: `${where} · ${melbourneTime(alert.createdAt)}` };
}

/** Something to send when signal comes back: an alert, or a stop the club hasn't heard yet. */
export interface QueuedAlert {
  rideId: string;
  kind: AlertKind | 'stop';
  at: LatLng | null;
  /** When it was first pressed. */
  queuedAt: string;
}

/** Adds an item to send later. Pressing the same button again updates the waiting one, keeping
 *  when it was first pressed. */
export function queueAlert(queue: QueuedAlert[], item: QueuedAlert): QueuedAlert[] {
  const same = (q: QueuedAlert) => q.rideId === item.rideId && q.kind === item.kind;
  const earlier = queue.find(same);
  return [...queue.filter((q) => !same(q)), earlier ? { ...item, queuedAt: earlier.queuedAt, at: item.at ?? earlier.at } : item];
}

/** A refusal from the club won't change on a retry. "Sign in first." can: the app may still be starting. */
const REFUSALS: string[] = Object.values(LIVE_MSG).filter((m) => m !== LIVE_MSG.signIn);

export interface Refused {
  item: QueuedAlert;
  reason: string;
}

/** Tries each waiting item in order. What the club refused for good is handed back, so the rider
 *  can be told; everything else that failed stays waiting. */
export async function drainQueue(
  queue: QueuedAlert[],
  send: (item: QueuedAlert) => Promise<void>,
): Promise<{ left: QueuedAlert[]; refused: Refused[] }> {
  const left: QueuedAlert[] = [];
  const refused: Refused[] = [];
  for (const item of queue) {
    try {
      await send(item);
    } catch (e) {
      const reason = (e as Error).message;
      if (REFUSALS.includes(reason)) refused.push({ item, reason });
      else left.push(item);
    }
  }
  return { left, refused };
}

export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const QUEUE_KEY = 'live.queue';

/** The waiting items, kept on the phone. One change at a time, so an alert held while others are
 *  being sent is never written over. */
export function createAlertQueue(store: KeyValue, send: (item: QueuedAlert) => Promise<void>) {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const read = async (): Promise<QueuedAlert[]> => {
    try {
      const raw = await store.getItem(QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (q: QueuedAlert[]) => store.setItem(QUEUE_KEY, JSON.stringify(q)).catch(() => {});

  return {
    list: () => serial(read),
    hold: (item: QueuedAlert) => serial(async () => write(queueAlert(await read(), item))),
    /** Takes back what's waiting of this kind for this ride (a stop, once you share again). */
    forget: (rideId: string, kind: QueuedAlert['kind']) =>
      serial(async () => write((await read()).filter((q) => !(q.rideId === rideId && q.kind === kind)))),
    /** Sends what's waiting; resolves to what the club refused for good. */
    flush: () =>
      serial(async () => {
        const queue = await read();
        if (queue.length === 0) return [] as Refused[];
        const { left, refused } = await drainQueue(queue, send);
        await write(left);
        return refused;
      }),
  };
}

const digits = (phone: string) => phone.replace(/[^\d+]/g, '');

/** An SMS link to these numbers with this text. iPhones take one number and "&body"; Android takes
 *  several, comma-separated, and "?body". Null with no numbers. */
export function smsUrl(platform: string, phones: string[], body: string): string | null {
  if (phones.length === 0) return null;
  const text = encodeURIComponent(body);
  return platform === 'ios' ? `sms:${digits(phones[0])}&body=${text}` : `sms:${phones.map(digits).join(',')}?body=${text}`;
}
