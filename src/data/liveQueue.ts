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

export interface QueuedAlert {
  rideId: string;
  kind: AlertKind;
  at: LatLng | null;
  queuedAt: string;
}

/** Adds an alert to send later. Pressing the same button again replaces the waiting one. */
export function queueAlert(queue: QueuedAlert[], item: QueuedAlert): QueuedAlert[] {
  return [...queue.filter((q) => !(q.rideId === item.rideId && q.kind === item.kind)), item];
}

const REFUSALS: string[] = Object.values(LIVE_MSG);

/** Tries each waiting alert in order; returns the ones still waiting. A refusal from the club
 *  (rather than no signal) won't change on a retry, so that one is let go. */
export async function drainQueue(queue: QueuedAlert[], send: (item: QueuedAlert) => Promise<void>): Promise<QueuedAlert[]> {
  const left: QueuedAlert[] = [];
  for (const item of queue) {
    try {
      await send(item);
    } catch (e) {
      if (!REFUSALS.includes((e as Error).message)) left.push(item);
    }
  }
  return left;
}
