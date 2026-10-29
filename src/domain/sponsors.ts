// The club's sponsors: a logo, a short blurb, a link and any deal for members. The board looks
// after the list. The database's save_sponsor and archive_sponsor apply the same checks with the
// same words, in the same order. Nothing is ever deleted: a sponsor taken off is archived.

import { signedInProblem } from './routes';
import { isAnyBoard } from './social/help';
import type { Member, Position } from './types';

export const MAX_SPONSOR_NAME = 60;
export const MAX_SPONSOR_BLURB = 300;
export const MAX_SPONSOR_URL = 300;
export const MAX_SPONSOR_DEAL = 200;

export const NOT_SPONSOR_KEEPER = 'Only the board can look after the club’s sponsors.';
export const SPONSOR_GONE = 'No such sponsor.';
export const SPONSOR_OFF = 'That sponsor has been taken off.';
export const SPONSOR_OFF_ALREADY = 'That sponsor has already been taken off.';
export const NO_SPONSOR_NAME = 'Name the sponsor.';
export const BAD_SPONSOR_URL = 'Websites start with http:// or https://.';
export const NO_SPONSOR_CHAPTER = 'No such chapter.';

export interface Sponsor {
  id: string;
  name: string;
  blurb: string | null;
  url: string | null;
  /** What members get, like "10% off tyres, show your card". Members only. */
  deal: string | null;
  /** Where the logo is kept (the sponsor-logos bucket in a live build), or null for none. */
  logoPath: string | null;
  /** The chapter it sponsors, or null for the whole club. */
  chapterId: string | null;
  addedBy: string;
  archivedAt: string | null;
}

export interface SponsorInput {
  id: string | null;
  name: string;
  blurb: string;
  url: string;
  deal: string;
  logoPath: string | null;
  chapterId: string | null;
}

const chars = (s: string) => [...s].length;

export function canKeepSponsors(me: Member | null, positions: Position[]): boolean {
  return isAnyBoard(me, positions);
}

function keeperProblem(me: Member | null, positions: Position[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!canKeepSponsors(me, positions)) return NOT_SPONSOR_KEEPER;
  return null;
}

export function cleanSponsor(input: SponsorInput): Omit<Sponsor, 'id' | 'addedBy' | 'archivedAt'> {
  return {
    name: input.name.trim(),
    blurb: input.blurb.trim() || null,
    url: input.url.trim() || null,
    deal: input.deal.trim() || null,
    logoPath: input.logoPath,
    chapterId: input.chapterId,
  };
}

/** Why `me` can't add this sponsor or save changes to it, or null when they can. */
export function sponsorProblem(
  me: Member | null,
  input: SponsorInput,
  sponsors: Sponsor[],
  positions: Position[],
  chapterIds: string[],
): string | null {
  const notKeeper = keeperProblem(me, positions);
  if (notKeeper) return notKeeper;
  if (input.id !== null) {
    const was = sponsors.find((s) => s.id === input.id);
    if (!was) return SPONSOR_GONE;
    if (was.archivedAt) return SPONSOR_OFF;
  }
  const c = cleanSponsor(input);
  if (!c.name) return NO_SPONSOR_NAME;
  if (chars(c.name) > MAX_SPONSOR_NAME) return `Keep the name to ${MAX_SPONSOR_NAME} characters at most.`;
  if (c.blurb && chars(c.blurb) > MAX_SPONSOR_BLURB) return `Keep the blurb to ${MAX_SPONSOR_BLURB} characters at most.`;
  if (c.url && !/^https?:\/\//i.test(c.url)) return BAD_SPONSOR_URL;
  if (c.url && chars(c.url) > MAX_SPONSOR_URL) return `Keep the website to ${MAX_SPONSOR_URL} characters at most.`;
  if (c.deal && chars(c.deal) > MAX_SPONSOR_DEAL) return `Keep the member deal to ${MAX_SPONSOR_DEAL} characters at most.`;
  if (c.chapterId !== null && !chapterIds.includes(c.chapterId)) return NO_SPONSOR_CHAPTER;
  return null;
}

export function archiveSponsorProblem(me: Member | null, id: string, sponsors: Sponsor[], positions: Position[]): string | null {
  const notKeeper = keeperProblem(me, positions);
  if (notKeeper) return notKeeper;
  const was = sponsors.find((s) => s.id === id);
  if (!was) return SPONSOR_GONE;
  if (was.archivedAt) return SPONSOR_OFF_ALREADY;
  return null;
}

/** The sponsors to show: the whole club's first, then each chapter's, by name. */
export function sponsorsFor(sponsors: Sponsor[]): Sponsor[] {
  return sponsors
    .filter((s) => !s.archivedAt)
    .sort(
      (a, b) =>
        Number(a.chapterId !== null) - Number(b.chapterId !== null) ||
        a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }),
    );
}

/** "tyres.example.com.au" for https://www.tyres.example.com.au/shop: what a Visit button names. */
export function siteLabel(url: string): string {
  const host = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1];
  return host ? host.toLowerCase().replace(/^www\./, '') : url;
}

/** Anyone with the app sees the sponsors; the member deals are for approved members only. */
export function sponsorsSeenBy(sponsors: Sponsor[], me: Member | null): Sponsor[] {
  if (me?.approval === 'approved') return sponsors;
  return sponsors.map((s) => (s.deal === null ? s : { ...s, deal: null }));
}
