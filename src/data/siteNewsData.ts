// Club news for the website as rows from the database, and the demo build's made-up notices.
import type { SiteNews } from '../domain/siteNews';
import { melbourneDate } from '../domain/rides';
import { dayMonth, storyDates, weekdayName } from './demoStory';

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

const DAY_MS = 86_400_000;

/**
 * Two sample notices so the demo Board screen shows what the section looks like, posted 3 and 12
 * days before `now`. The toy run is the demo's Toy Run ride (r-3, the same story instant); the open
 * day is a story Saturday, moved a week at a time with the rest of the story.
 */
export function demoSiteNews(now: Date): SiteNews[] {
  const { d, t } = storyDates(melbourneDate(now.toISOString()));
  const toyRun = melbourneDate(t('2026-11-28T23:00:00.000Z'));
  const openDay = d('2026-11-14');
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  return [
    {
      id: 'demo-news-1',
      title: `Toy run, ${weekdayName(toyRun)} ${dayMonth(toyRun)}`,
      body: 'Bring a wrapped toy. West leaves Laverton at 9am sharp and rides in to Werribee Racecourse for a 10am start. Everyone welcome to wave us off.',
      link: 'https://www.rustnutssmc.com.au/charity.html',
      postedBy: 'demo-pres',
      createdAt: ago(3),
      removedAt: null,
    },
    {
      id: 'demo-news-2',
      title: 'Clubhouse open day',
      body: `Saturday ${dayMonth(openDay)}, 11am to 3pm. Come and meet the club, see the bikes, have a sausage.`,
      link: null,
      postedBy: 'demo-pres',
      createdAt: ago(12),
      removedAt: null,
    },
  ];
}

/** Adds a notice to the demo list. */
export function demoPostNews(list: SiteNews[], notice: { title: string; body: string; link: string | null }, postedBy: string, now: string): SiteNews[] {
  return [{ id: `demo-news-${now}`, ...notice, postedBy, createdAt: now, removedAt: null }, ...list];
}

/** Takes one down in the demo list. */
export function demoRemoveNews(list: SiteNews[], id: string, now: string): SiteNews[] {
  return list.map((n) => (n.id === id ? { ...n, removedAt: now } : n));
}
