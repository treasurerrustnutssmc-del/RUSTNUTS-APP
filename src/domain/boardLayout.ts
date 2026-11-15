// The Board tab used to stack 16 sections, empty ones included. It now opens with a short "Needs
// you" list and folds the rest into five groups; only a group with something open starts expanded.
// This file holds the counting and wording so they can be tested without drawing a screen.

import { isActing } from './acting';
import { seesEveryChapter } from './access';
import { termEndsOn, termState } from './terms';
import type { Member, Position } from './types';

export type BoardCounts = {
  /** People waiting for approval. */
  pending: number;
  /** Regos, licences and first aid certificates due or expired. */
  alerts: number;
  /** Members with no emergency contact. */
  noContact: number;
  /** FNGs with a review coming. */
  fngs: number;
};

export type BoardGroupId = 'approvals' | 'people' | 'meetings' | 'money' | 'website';

export type NeedsYou = { group: BoardGroupId; text: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The things that need the board right now, most urgent first. Empty when nothing does. */
export function needsYou(c: BoardCounts): NeedsYou[] {
  const items: NeedsYou[] = [];
  if (c.pending > 0) items.push({ group: 'approvals', text: `${plural(c.pending, 'person', 'people')} waiting for approval` });
  if (c.alerts > 0) {
    items.push({
      group: 'people',
      text: c.alerts === 1 ? '1 rego, licence or first aid certificate due' : `${c.alerts} regos, licences or first aid certificates due`,
    });
  }
  if (c.noContact > 0) items.push({ group: 'people', text: `${plural(c.noContact, 'member', 'members')} without an emergency contact` });
  if (c.fngs > 0) items.push({ group: 'people', text: plural(c.fngs, 'FNG review', 'FNG reviews') });
  return items;
}

export type BoardGroup = { id: BoardGroupId; title: string; summary: string; startsOpen: boolean };

/** The five groups, in a fixed order. A group starts open only when it has something waiting. */
export function boardGroups(c: BoardCounts): BoardGroup[] {
  const people = [
    c.alerts > 0 ? `${c.alerts} due` : null,
    c.noContact > 0 ? `${c.noContact} without a contact` : null,
    c.fngs > 0 ? plural(c.fngs, 'FNG review', 'FNG reviews') : null,
  ].filter((s): s is string => s !== null);
  return [
    { id: 'approvals', title: 'Approvals', summary: c.pending > 0 ? `${c.pending} waiting` : 'Nobody waiting', startsOpen: c.pending > 0 },
    { id: 'people', title: 'People', summary: people.length ? people.join(', ') : 'Nothing due', startsOpen: people.length > 0 },
    { id: 'meetings', title: 'Meetings and attendance', summary: 'Attendance and check-ins', startsOpen: false },
    { id: 'money', title: 'Money', summary: 'Chapter fees', startsOpen: false },
    { id: 'website', title: 'Website and app', summary: 'Enquiries, news, visits and app feedback', startsOpen: false },
  ];
}

/**
 * The chapter the Board tab's lists cover for `me`: null (every chapter) only for someone who sees
 * every chapter's details. An Acting President takes part in NEC business, so their level is
 * national, but they see only their own chapter's board (spec, "Nobody acting reaches club-wide").
 */
export function boardScope(me: Member, positions: Position[]): string | null {
  return seesEveryChapter(me, positions) ? null : me.chapterId;
}

/**
 * The terms "Attendance and terms" lists: ended, or ending within 60 days, in `chapterId` (null: every
 * chapter), soonest first. A stint isn't a term: it ends on its until date, and nobody is re-elected to it.
 */
export function termsDue(positions: Position[], chapterId: string | null, today: string): Position[] {
  return positions
    .filter((p) => !isActing(p) && (chapterId === null || p.chapterId === chapterId))
    .filter((p) => termState(p, today) !== null && termState(p, today) !== 'running')
    .sort((a, b) => (termEndsOn(a) ?? '').localeCompare(termEndsOn(b) ?? ''));
}
