// Alerts the phone shows itself, without push: a crew swap asked of you, an answer to your own ask,
// and a ride you're Going or Maybe to called off or postponed by someone else. Each has a stable id,
// so the phone shows it once. Only what's happened in the last day counts, so an old one never pops
// up on a fresh install. Push from the server is still to come; this covers the app being opened.

import { ROLE_LABEL } from './labels';
import { memberName } from './profile';
import { callTitle } from './rideCalls';
import { openAsksFor } from './swaps';
import type { ClubData, NotificationPrefs } from './types';

const DAY = 24 * 3600_000;

export interface LocalAlert {
  id: string;
  rideId: string;
  title: string;
  body: string;
}

/** The alerts `meId` should have seen by `now`, oldest first. Off with the Ride changes setting. */
export function localAlerts(data: ClubData, meId: string | null, prefs: NotificationPrefs, now: string): LocalAlert[] {
  if (!meId || !prefs.rideChanges) return [];
  const nowMs = Date.parse(now);
  const recent = (at: string | null) => !!at && nowMs - Date.parse(at) <= DAY;
  const title = (rideId: string) => data.rides.find((r) => r.id === rideId)?.title ?? 'A ride';
  const out: (LocalAlert & { at: string })[] = [];

  for (const s of openAsksFor(meId, data, now)) {
    const asker = memberName(s.askedBy, data.members);
    out.push({
      id: `swap-ask-${s.id}`,
      rideId: s.rideId,
      at: s.askedAt,
      title: 'Crew swap asked',
      body: s.theirRole
        ? `${asker} asked to trade spots on ${title(s.rideId)}: you’d be ${ROLE_LABEL[s.role]}.`
        : `${asker} asked you to take their ${ROLE_LABEL[s.role]} spot on ${title(s.rideId)}.`,
    });
  }

  for (const s of data.crewSwaps ?? []) {
    if (s.askedBy !== meId || (s.state !== 'accepted' && s.state !== 'declined') || !recent(s.answeredAt)) continue;
    const who = memberName(s.askedTo, data.members);
    out.push({
      id: `swap-answer-${s.id}-${s.state}`,
      rideId: s.rideId,
      at: s.answeredAt!,
      title: s.state === 'accepted' ? 'Swap done' : 'Swap declined',
      body: s.state === 'accepted'
        ? `${who} took your ${ROLE_LABEL[s.role]} spot on ${title(s.rideId)}.`
        : `${who} can’t take your ${ROLE_LABEL[s.role]} spot on ${title(s.rideId)}. You’re still on the crew.`,
    });
  }

  const answered = new Set(data.rsvps.filter((r) => r.memberId === meId && (r.answer === 'going' || r.answer === 'maybe')).map((r) => r.rideId));
  for (const c of data.rideCalls ?? []) {
    if (!answered.has(c.rideId) || c.calledBy === meId || !recent(c.calledAt)) continue;
    out.push({
      id: `call-${c.rideId}-${c.calledAt}`,
      rideId: c.rideId,
      at: c.calledAt,
      title: c.state === 'on' ? 'Ride’s back on' : callTitle(c),
      body: [title(c.rideId), c.reason].filter(Boolean).join(': '),
    });
  }

  return out.sort((a, b) => a.at.localeCompare(b.at)).map(({ at: _at, ...a }) => a);
}
