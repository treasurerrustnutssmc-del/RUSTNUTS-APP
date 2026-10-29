// Which Chapter Compass Ring sits around a member's MEMBER disc (constitution v4 6.5: the patch
// and ring are one assembly showing the current chapter or approved status). Only ever asked once
// the disc is earned (see hasEarnedDisc).

import { isChairman } from './access';
import type { ClubData, Member } from './types';

/** 'plain' is the disc without a chapter letter, for a chapter that has no compass patch yet. */
export type Compass = 'west' | 'north' | 'national' | 'plain';

const CHAPTER_COMPASS: Record<string, Compass> = { west: 'west', north: 'north' };

/** Only the National Chairman (El Jefe) wears the national ring; everyone else, Presidents included, their chapter's. */
export function compassFor(member: Pick<Member, 'id' | 'chapterId'>, data: Pick<ClubData, 'positions' | 'chapters'>): Compass {
  if (isChairman(member.id, data.positions)) return 'national';
  const slug = data.chapters.find((c) => c.id === member.chapterId)?.slug;
  return (slug && CHAPTER_COMPASS[slug]) || 'plain';
}
