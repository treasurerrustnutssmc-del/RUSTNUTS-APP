// The Home screen's header titles and club counts, and the title forms for acting (Acting Treasurer
// (North) until 13/12/2026) and covers. See docs/superpowers/specs/2026-11-15-acting-roles-design.md.

import { dutyRows, heldRows, isActing, necVoterRow, stintsEndingWith } from './acting';
import { formatAuDate } from './dates';
import { ROLE_LABEL, ROLE_SHORT } from './labels';
import { displayName } from './profile';
import type { Chapter, ClubData, Member, MemberStatus, Position, PositionRole, RosterTally } from './types';

export interface PositionTitle {
  key: string;
  text: string;
  /** The last acting day, shown DD/MM/YYYY; null for a full term. */
  until: string | null;
}

/** "Acting" in the labels' own case: "Acting Treasurer", or "ACTING TREAS" with the short forms. */
const actingWord = (label: string) => (label === label.toUpperCase() ? 'ACTING' : 'Acting');

/**
 * One title per role. A role held in more than one chapter shows once with each chapter named
 * ("Treasurer (West, North)"), and a chapter seat always names its chapter ("President (West)").
 * Acting stints never merge with full terms, or with stints that end on another day:
 * "Acting Treasurer (North)", until "13/12/2026". A covered holder's title is unchanged.
 */
export function positionTitles(
  positions: Position[],
  chapters: Chapter[],
  // Kept so callers don't change; a chapter seat now names its chapter even at home ("PRES (WEST)").
  _homeChapterId: string,
  labels: Record<PositionRole, string>,
): PositionTitle[] {
  const chapterName = (id: string | null) => chapters.find((c) => c.id === id)?.name;
  const groups = new Map<string, Position[]>();
  for (const p of positions) {
    const key = `${p.role}|${isActing(p) ? p.actingUntil : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].map((held) => {
    const first = held[0];
    const named = held.map((p) => p.chapterId).filter((id) => id !== null);
    const where = named.map(chapterName).filter(Boolean).join(', ');
    const label = isActing(first) ? `${actingWord(labels[first.role])} ${labels[first.role]}` : labels[first.role];
    return { key: first.id, text: where ? `${label} (${where})` : label, until: isActing(first) ? formatAuDate(first.actingUntil) : null };
  });
}

/** The long form, for member detail, Me, the assistant and reports: "Acting Treasurer (North) until 13/12/2026". */
export function longTitle(t: PositionTitle): string {
  return t.until ? `${t.text} until ${t.until}` : t.text;
}

/** One seat's title, naming its chapter when it has one ("Treasurer (West)"), for buttons that act on that seat alone. */
export function seatTitle(position: Position, chapters: Chapter[], labels: Record<PositionRole, string>): string {
  return positionTitles([position], chapters, '', labels)[0].text;
}

/** One seat's long title: "Acting Treasurer (North) until 13/12/2026", or "Treasurer (West)". */
export function longSeatTitle(position: Position, chapters: Chapter[], labels: Record<PositionRole, string> = ROLE_LABEL): string {
  return longTitle(positionTitles([position], chapters, '', labels)[0]);
}

/** How much room a role chip has: the long form where the chips get a line of their own, the short one in a dense row. */
export type ChipForm = 'long' | 'short';

/**
 * A role chip's words: an acting seat spelt out ("ACTING TREASURER (NORTH)"), else the short form
 * ("TREAS"). In a dense row (a Members list row has 216 px at 360 wide, a chat name line) an acting
 * seat takes the short role but keeps the Acting word and its chapter: "ACTING TREAS (NORTH)".
 */
export function chipLabel(position: Position, chapters: Chapter[], form: ChipForm = 'long'): string {
  if (!isActing(position)) return ROLE_SHORT[position.role];
  return seatTitle(position, chapters, form === 'short' ? ROLE_SHORT : ROLE_LABEL).toUpperCase();
}

const nameOf = (id: string | null | undefined, data: Pick<ClubData, 'members'>) => {
  const m = id ? data.members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'Someone';
};
const chapterOf = (id: string | null, data: Pick<ClubData, 'chapters'>) => data.chapters.find((c) => c.id === id)?.name ?? 'the chapter';

/**
 * The NEC list's chapter rows, one per chapter, for whoever casts its vote (11.2, necVoterRow):
 * "Smokey, President (North)", "Jet, Acting President (North), for Smokey until 13/12/2026",
 * "Jet, Acting President (North) until 13/12/2026" or, through the VP fallback, "Jet, Vice
 * President (North)". A National Chairman who is also a chapter's President, with no VP to vote,
 * still shows as that President. A chapter with neither shows nothing. Expects settled data.
 */
export function necRows(data: ClubData): { chapterId: string; text: string }[] {
  const held = heldRows(data.positions);
  return data.chapters.flatMap((c) => {
    const row = necVoterRow(c.id, data.positions) ?? dutyRows(data.positions).find((p) => p.chapterId === c.id && p.role === 'president');
    if (!row) return [];
    const title = seatTitle(row, data.chapters, ROLE_LABEL);
    const covered = row.covers ? held.find((p) => p.id === row.covers) : undefined;
    const until = formatAuDate(row.actingUntil);
    const text = !isActing(row)
      ? `${nameOf(row.memberId, data)}, ${title}`
      : covered
        ? `${nameOf(row.memberId, data)}, ${title}, for ${nameOf(covered.memberId, data)} until ${until}`
        : `${nameOf(row.memberId, data)}, ${title} until ${until}`;
    return [{ chapterId: c.id, text }];
  });
}

// ---------------------------------------------------------------------------
// Cover copy: what moves to the stand-in, and what the away holder keeps
// ---------------------------------------------------------------------------

/** What the stand-in does in the seat: "chairs North and casts its NEC vote", "keeps North’s books", or the seat's duties. */
function standInDuties(role: PositionRole, chapter: string): { until: string; meanwhile: string } {
  if (role === 'president') return { until: `chairs ${chapter} and casts its NEC vote`, meanwhile: `chairs and casts ${chapter}’s NEC vote` };
  if (role === 'treasurer') return { until: `keeps ${chapter}’s books`, meanwhile: `keeps ${chapter}’s books` };
  const duties = `does the ${ROLE_LABEL[role]}’s duties for ${chapter}`;
  return { until: duties, meanwhile: duties };
}

/** Whether the holder sits on the NEC through a national office anyway (so a cover doesn't take them off it). */
const necOfficer = (memberId: string, data: ClubData) =>
  heldRows(data.positions).some((p) => p.memberId === memberId && (p.role === 'nec_chair' || p.role === 'nec_secretary'));

/**
 * The away holder's confirm note when they arrange a cover of `seat` (their own row): "Jet chairs North
 * and casts its NEC vote until 13/12/2026. You keep your seat, board vote, approvals and board records.
 * You’re off the NEC until then." A Treasurer's says "Jet keeps North’s books until …"; any other seat
 * "Jet does the Secretary’s duties for North until …".
 */
export function coverNote(seat: Position, standIn: Member, until: string, data: ClubData): string {
  const chapter = chapterOf(seat.chapterId, data);
  const lines = [
    `${displayName(standIn)} ${standInDuties(seat.role, chapter).until} until ${formatAuDate(until)}.`,
    'You keep your seat, board vote, approvals and board records.',
  ];
  if (seat.role === 'president' && !necOfficer(seat.memberId, data)) lines.push('You’re off the NEC until then.');
  return lines.join(' ');
}

/** What the covered holder sees on Me and Home while `cover` stands in for their `seat`. */
export function coveredNotice(seat: Position, cover: Position, data: ClubData): string {
  const name = nameOf(cover.memberId, data);
  return [
    `${name} is acting as ${seatTitle(seat, data.chapters, ROLE_LABEL)} until ${formatAuDate(cover.actingUntil)}.`,
    `Until then ${name} ${standInDuties(seat.role, chapterOf(seat.chapterId, data)).meanwhile}.`,
    'You keep your seat and board vote.',
  ].join(' ');
}

/** Added to the covered holder's step-down confirm: their row ending ends the cover too. */
export function coveredStepDownNote(cover: Position, data: ClubData): string {
  return `This ends ${nameOf(cover.memberId, data)}’s acting too. If you’re re-elected and still away, arrange a new cover.`;
}

/**
 * The step-down confirm's note: what else ends with this row, as endPositionRows ends it. The covered
 * holder hears that the cover ends (coveredStepDownNote). A stand-in hears that their own stint ends
 * with their last board seat in the chapter, or with the VP row an unvoted President stint rests on
 * (8.2): "This ends your acting as President (North) for Smokey too." Nothing else ends with it: undefined.
 */
export function stepDownNote(position: Position, data: ClubData): string | undefined {
  const ending = stintsEndingWith(position, data.positions);
  const cover = ending.find((p) => p.covers === position.id);
  if (cover) return coveredStepDownNote(cover, data);
  const own = ending.find((p) => p.memberId === position.memberId);
  if (!own) return undefined;
  const holder = own.covers ? data.positions.find((p) => p.id === own.covers)?.memberId : undefined;
  const chapter = chapterOf(own.chapterId, data);
  return `This ends your acting as ${ROLE_LABEL[own.role]}${chapter ? ` (${chapter})` : ''}${holder ? ` for ${nameOf(holder, data)}` : ''} too.`;
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
  /** Each chapter split by status (Patched here is Full only), for the Home screen's table. */
  split: ({ id: string; name: string } & StatusSplit)[];
  /** The same split for the whole club. */
  club: StatusSplit;
}

export interface StatusSplit {
  patched: number;
  nomads: number;
  fngs: number;
  legacy: number;
}

/** The club's numbers: approved members plus roster places nobody has claimed yet. */
export function clubCounts(chapters: Chapter[], members: Member[], unclaimed: RosterTally[]): ClubCounts {
  const everyone = [
    ...members.filter((m) => m.approval === 'approved').map((m) => ({ chapterId: m.chapterId, status: m.status, count: 1 })),
    ...unclaimed,
  ];
  const people = everyone.filter((p) => COUNTED(p.status));
  const splitOf = (inChapter: (chapterId: string) => boolean): StatusSplit => {
    const n = (status: MemberStatus) =>
      everyone.filter((p) => p.status === status && inChapter(p.chapterId)).reduce((t, p) => t + p.count, 0);
    return { patched: n('full'), nomads: n('nomad'), fngs: n('fng'), legacy: n('legacy') };
  };
  const sum = (keep: (p: (typeof people)[number]) => boolean) => people.filter(keep).reduce((n, p) => n + p.count, 0);
  const total = sum(() => true);
  return {
    chapters: chapters.map((c) => ({ id: c.id, name: c.name, count: sum((p) => p.chapterId === c.id) })),
    patched: sum((p) => p.status === 'full' || p.status === 'nomad'),
    fngs: sum((p) => p.status === 'fng'),
    total,
    onApp: total - unclaimed.filter((t) => COUNTED(t.status)).reduce((n, t) => n + t.count, 0),
    split: chapters.map((c) => ({ id: c.id, name: c.name, ...splitOf((id) => id === c.id) })),
    club: splitOf(() => true),
  };
}
