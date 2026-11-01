/**
 * Website visitor counts (website-and-app task 30): each club website page pings the site-api
 * function once, and the database keeps a count per day per page. Nothing about the person.
 * The database mirrors these rules (supabase/migrations/*_site_visits.sql); change both together.
 * Spec: docs/superpowers/specs/2026-11-01-website-visits-design.md
 */

export const VISIT_PAGE_MAX = 80;
/** How many different pages a day may have before new ones are dropped (a flood of made-up paths). */
export const VISIT_PAGES_PER_DAY = 200;
export const VISIT_DAYS = 30;

const PAGE = /^\/[a-z0-9/._-]*$/;

/** A row of the board's summary, as site_visit_summary() returns it. */
export interface VisitRow {
  /** ISO date, Melbourne day. */
  day: string;
  page: string;
  hits: number;
}

/**
 * The page as counted: a lower-case site path up to 80 characters, with the home page as "/";
 * null when it isn't one (the ping is then dropped). "get-the-app" is the launch-day tap counter.
 */
export function cleanVisitPage(raw: string): string | null {
  let page = raw.trim();
  if (page === '' || page === '/index.html') return '/';
  if (!page.startsWith('/')) page = `/${page}`;
  if (page.length > VISIT_PAGE_MAX || !PAGE.test(page)) return null;
  return page;
}

const daysBefore = (today: string, days: number): string => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Page views in the last 7 and 30 days, today included. */
export function visitTotals(rows: VisitRow[], today: string): { week: number; month: number } {
  const weekFrom = daysBefore(today, 6);
  const monthFrom = daysBefore(today, VISIT_DAYS - 1);
  let week = 0;
  let month = 0;
  for (const r of rows) {
    if (r.day > today) continue;
    if (r.day >= monthFrom) month += r.hits;
    if (r.day >= weekFrom) week += r.hits;
  }
  return { week, month };
}

/** The busiest pages over the last 30 days, five at most. */
export function topPages(rows: VisitRow[], today: string): { page: string; hits: number }[] {
  const from = daysBefore(today, VISIT_DAYS - 1);
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (r.day < from || r.day > today) continue;
    sums.set(r.page, (sums.get(r.page) ?? 0) + r.hits);
  }
  return [...sums.entries()]
    .map(([page, hits]) => ({ page, hits }))
    .sort((a, b) => b.hits - a.hits || a.page.localeCompare(b.page))
    .slice(0, 5);
}

const LABELS: Record<string, string> = {
  '/': 'Home',
  '/charity.html': 'Charity Rides',
  '/constitution.html': 'Constitution',
  '/resources.html': 'Support and resources',
  '/shop.html': 'Shop',
  '/coming-soon.html': 'Coming soon',
  '/app/privacy.html': 'Privacy policy',
  '/app/posting-rules.html': 'Posting rules',
  '/app/support.html': 'Support (app page)',
  '/app/delete-account.html': 'Delete my account',
  '/app/road-rules.html': 'Road Rules',
  '/app/guide.html': 'Welcome guide',
  '/get-the-app': 'Get the app taps',
};

export function pageLabel(page: string): string {
  return LABELS[page] ?? page;
}
