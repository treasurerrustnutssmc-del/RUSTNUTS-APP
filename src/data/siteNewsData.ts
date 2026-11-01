// Club news for the website as rows from the database, and the demo build's made-up notices.
import type { SiteNews } from '../domain/siteNews';

export interface SiteNewsRow {
  id: string;
  title: string;
  body: string;
  link: string | null;
  posted_by: string | null;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
}

export function toSiteNews(rows: SiteNewsRow[]): SiteNews[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    link: r.link,
    postedBy: r.posted_by,
    createdAt: r.created_at,
    removedAt: r.removed_at,
  }));
}

/** Two sample notices so the demo Board screen shows what the section looks like. */
export const DEMO_SITE_NEWS: SiteNews[] = [
  {
    id: 'demo-news-1',
    title: 'Toy run, Sunday 7 December',
    body: 'Bring a new, unwrapped toy. We leave the clubhouse at 9am sharp and ride to the Salvos depot in Sunshine. Everyone welcome to wave us off.',
    link: 'https://www.rustnutssmc.com.au/charity.html',
    postedBy: 'demo-pres',
    createdAt: '2026-10-29T06:30:00Z',
    removedAt: null,
  },
  {
    id: 'demo-news-2',
    title: 'Clubhouse open day',
    body: 'Saturday 15 November, 11am to 3pm. Come and meet the club, see the bikes, have a sausage.',
    link: null,
    postedBy: 'demo-pres',
    createdAt: '2026-10-20T01:00:00Z',
    removedAt: null,
  },
];

/** Adds a notice to the demo list. */
export function demoPostNews(list: SiteNews[], notice: { title: string; body: string; link: string | null }, postedBy: string, now: string): SiteNews[] {
  return [{ id: `demo-news-${now}`, ...notice, postedBy, createdAt: now, removedAt: null }, ...list];
}

/** Takes one down in the demo list. */
export function demoRemoveNews(list: SiteNews[], id: string, now: string): SiteNews[] {
  return list.map((n) => (n.id === id ? { ...n, removedAt: now } : n));
}
