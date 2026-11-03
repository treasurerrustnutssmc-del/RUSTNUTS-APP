import { displayName } from './profile';
import type { Member, MemberStatus } from './types';

/**
 * The member list's groups, in the order they show: patched members first, then Nomads, FNGs,
 * Hang Arounds (people in the Introduction Phase, v4 4.2), Supporters, Family and, last, Legacy.
 */
const GROUPS: { status: MemberStatus; title: string }[] = [
  { status: 'full', title: 'Patched' },
  { status: 'nomad', title: 'Nomads' },
  { status: 'fng', title: 'FNGs' },
  { status: 'introduced', title: 'Hang Arounds' },
  { status: 'supporter', title: 'Supporters' },
  { status: 'family', title: 'Family' },
  { status: 'legacy', title: 'Legacy' },
];

export type MemberGroup = { status: MemberStatus; title: string; members: Member[] };

/** Splits a list into the groups above, names in order within each, leaving empty groups out. */
export function memberGroups(list: Member[]): MemberGroup[] {
  return GROUPS.map((g) => ({
    ...g,
    members: list.filter((m) => m.status === g.status).sort((a, b) => displayName(a).localeCompare(displayName(b))),
  })).filter((g) => g.members.length > 0);
}
