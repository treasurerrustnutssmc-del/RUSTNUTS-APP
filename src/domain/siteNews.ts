/**
 * Club news for the public website (website-and-app task 21). A board member writes a short
 * notice on the Board screen; the website's home page shows the newest few through the `site-api`
 * Edge Function. The database mirrors these rules (supabase/migrations/*_site_news.sql); change
 * both together. Spec: docs/superpowers/specs/2026-11-01-website-news-design.md
 */
import { signedInProblem } from './routes';
import { isAnyBoard } from './social/help';
import type { Member, Position } from './types';

export const NO_NEWS_TITLE = 'Give the notice a title.';
export const LONG_NEWS_TITLE = 'Keep the title to 80 characters.';
export const NO_NEWS_BODY = 'Write what members of the public should know.';
export const LONG_NEWS_BODY = 'Keep the notice to 400 characters.';
export const BAD_NEWS_LINK = 'The link must start with https://.';
export const NOT_NEWS_POSTER = 'Only the board can post club news.';
export const NEWS_GONE = 'No such notice.';
export const NEWS_REMOVED_ALREADY = 'That notice has already been taken down.';

export const NEWS_TITLE_MAX = 80;
export const NEWS_BODY_MAX = 400;
export const NEWS_LINK_MAX = 300;
/** How long a notice stays on the website unless taken down first. */
export const NEWS_DAYS = 60;
/** How many notices the website shows at most. */
export const NEWS_SHOWN = 5;

/** What the Board screen form sends. */
export interface NewsInput {
  title: string;
  body: string;
  link: string;
}

/** A stored notice as the board sees it. */
export interface SiteNews {
  id: string;
  title: string;
  body: string;
  link: string | null;
  postedBy: string | null;
  createdAt: string;
  removedAt: string | null;
}

/** A notice as the website receives it: nothing personal. Column names as public_site_news returns them. */
export interface PublicNews {
  id: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
}

const HTTPS = /^https:\/\/\S+$/;

/** Why `me` can't post this notice, or null when they can. Mirrors post_site_news. */
export function newsProblem(me: Member | null, positions: Position[], input: NewsInput): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!isAnyBoard(me, positions)) return NOT_NEWS_POSTER;
  const title = input.title.trim();
  if (!title) return NO_NEWS_TITLE;
  if (title.length > NEWS_TITLE_MAX) return LONG_NEWS_TITLE;
  const body = input.body.trim();
  if (!body) return NO_NEWS_BODY;
  if (body.length > NEWS_BODY_MAX) return LONG_NEWS_BODY;
  const link = input.link.trim();
  if (link && (link.length > NEWS_LINK_MAX || !HTTPS.test(link))) return BAD_NEWS_LINK;
  return null;
}

/** The form as stored: trimmed, an empty link kept as null. */
export function cleanNews(input: NewsInput): { title: string; body: string; link: string | null } {
  const link = input.link.trim();
  return { title: input.title.trim(), body: input.body.trim(), link: link ? link : null };
}

/** Why `me` can't take this notice down, or null when they can. Mirrors remove_site_news. */
export function removeNewsProblem(me: Member | null, positions: Position[], notice: SiteNews | null): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!isAnyBoard(me, positions)) return NOT_NEWS_POSTER;
  if (!notice) return NEWS_GONE;
  if (notice.removedAt) return NEWS_REMOVED_ALREADY;
  return null;
}

/** Board screen order: live notices newest first, then the ones taken down. */
export function boardNewsOrder(list: SiteNews[]): SiteNews[] {
  return [...list].sort((a, b) => {
    const aLive = a.removedAt === null ? 0 : 1;
    const bLive = b.removedAt === null ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

/**
 * What the website shows: the newest NEWS_SHOWN notices that are not taken down and are less
 * than NEWS_DAYS old, with nothing personal. Mirrors public_site_news() in the database.
 */
export function publicNews(list: SiteNews[], now: Date): PublicNews[] {
  const cutoff = now.getTime() - NEWS_DAYS * 86_400_000;
  return boardNewsOrder(list.filter((n) => n.removedAt === null && Date.parse(n.createdAt) > cutoff))
    .slice(0, NEWS_SHOWN)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, created_at: n.createdAt }));
}
