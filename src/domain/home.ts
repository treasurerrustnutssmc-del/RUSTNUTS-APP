// The Home screen's header titles and club counts.

import type { Chapter, Member, MemberStatus, Position, PositionRole, RosterTally } from './types';

export interface PositionTitle {
  key: string;
  text: string;
}

/**
 * One title per role. A role held in more than one chapter shows once with each chapter named
 * ("Treasurer (West, North)"), and a chapter seat always names its chapter ("President (West)").
 */
export function positionTitles(
  positions: Position[],
  chapters: Chapter[],
  // Kept so callers don't change; a chapter seat now names its chapter even at home ("PRES (WEST)").
  _homeChapterId: string,
  labels: Record<PositionRole, string>,
): PositionTitle[] {
  const chapterName = (id: string | null) => chapters.find((c) => c.id === id)?.name;
  const byRole = new Map<PositionRole, Position[]>();
  for (const p of positions) byRole.set(p.role, [...(byRole.get(p.role) ?? []), p]);
  return [...byRole.entries()].map(([role, held]) => {
    const named = held.map((p) => p.chapterId).filter((id) => id !== null);
    const where = named.map(chapterName).filter(Boolean).join(', ');
    return { key: held[0].id, text: where ? `${labels[role]} (${where})` : labels[role] };
  });
}

/** Members of the club for the counts: Legacy have left and Family have no Club rights. */
const COUNTED = (s: MemberStatus) => s !== 'legacy' && s !== 'family';

export interface ClubCounts {
  chapters: { id: string; name: string; count: number }[];
  patched: number;
  fngs: number;
  total: number;
  /** How many of the total have signed in to the app. */
  onApp: number;
}

/** The club's numbers: approved members plus roster places nobody has claimed yet. */
export function clubCounts(chapters: Chapter[], members: Member[], unclaimed: RosterTally[]): ClubCounts {
  const people = [
    ...members.filter((m) => m.approval === 'approved').map((m) => ({ chapterId: m.chapterId, status: m.status, count: 1 })),
    ...unclaimed,
  ].filter((p) => COUNTED(p.status));
  const sum = (keep: (p: (typeof people)[number]) => boolean) => people.filter(keep).reduce((n, p) => n + p.count, 0);
  const total = sum(() => true);
  return {
    chapters: chapters.map((c) => ({ id: c.id, name: c.name, count: sum((p) => p.chapterId === c.id) })),
    patched: sum((p) => p.status === 'full' || p.status === 'nomad'),
    fngs: sum((p) => p.status === 'fng'),
    total,
    onApp: total - unclaimed.filter((t) => COUNTED(t.status)).reduce((n, t) => n + t.count, 0),
  };
}
