// The club's sponsors as data: the demo's made-up list and its actions (the same rules the
// database enforces), and the live rows turned into sponsors. Nothing here needs a phone, so the
// tests run it as is; src/data/sponsors.tsx puts it behind useSponsors.

import { NotAllowedError } from './clubContext';
import { archiveSponsorProblem, cleanSponsor, sponsorProblem, type Sponsor, type SponsorInput } from '../domain/sponsors';
import type { Member, Position } from '../domain/types';

export interface SponsorCtx {
  me: Member | null;
  positions: Position[];
  chapterIds: string[];
}

/** Made up for the demo build, and named so nobody mistakes them for the club's real sponsors. */
export const DEMO_SPONSORS: Sponsor[] = [
  {
    id: 'demo-sponsor-1',
    name: 'Demo: Western Tyre and Chain',
    blurb: 'A made-up tyre shop, here to show how a sponsor looks. Tyres, chains and puncture repairs.',
    url: 'https://example.com/',
    deal: '10% off tyres. Show your member card at the counter.',
    logoPath: null,
    chapterId: null,
    addedBy: '',
    archivedAt: null,
  },
  {
    id: 'demo-sponsor-2',
    name: 'Demo: Northside Coffee Stop',
    blurb: 'A made-up café for the demo. Coffee and a feed before the Sunday ride.',
    url: null,
    deal: null,
    logoPath: null,
    chapterId: 'ch-north',
    addedBy: '',
    archivedAt: null,
  },
];

const refuse = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

export function demoSaveSponsor(list: Sponsor[], ctx: SponsorCtx, input: SponsorInput, newId: string): { list: Sponsor[]; id: string } {
  refuse(sponsorProblem(ctx.me, input, list, ctx.positions, ctx.chapterIds));
  const clean = cleanSponsor(input);
  if (input.id === null) {
    const id = newId;
    return { list: [...list, { id, ...clean, addedBy: (ctx.me as Member).id, archivedAt: null }], id };
  }
  return { list: list.map((s) => (s.id === input.id ? { ...s, ...clean } : s)), id: input.id };
}

export function demoArchiveSponsor(list: Sponsor[], ctx: SponsorCtx, id: string, now: string): Sponsor[] {
  refuse(archiveSponsorProblem(ctx.me, id, list, ctx.positions));
  return list.map((s) => (s.id === id ? { ...s, archivedAt: now } : s));
}

/** A row from public.list_sponsors. */
export interface SponsorRow {
  id: string;
  name: string;
  blurb: string | null;
  url: string | null;
  deal: string | null;
  logo_path: string | null;
  chapter_id: string | null;
  added_by: string | null;
  archived_at: string | null;
}

export function toSponsors(rows: SponsorRow[]): Sponsor[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    blurb: r.blurb,
    url: r.url,
    deal: r.deal,
    logoPath: r.logo_path,
    chapterId: r.chapter_id,
    addedBy: r.added_by ?? '',
    archivedAt: r.archived_at,
  }));
}

/** public.save_sponsor's arguments. The database trims, the same way the app does. */
export function saveSponsorArgs(input: SponsorInput, logoPath: string | null): Record<string, unknown> {
  return {
    p_id: input.id,
    p_name: input.name,
    p_blurb: input.blurb,
    p_url: input.url,
    p_deal: input.deal,
    p_logo_path: logoPath,
    p_chapter: input.chapterId,
  };
}
