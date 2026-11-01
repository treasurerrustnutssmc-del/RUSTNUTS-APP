/**
 * One list of club links (website-and-app task 22): the app's club links (src/domain/clubLinks.ts)
 * written by `npm run build:site` into the club website's home page between marker comments, the
 * way the brand block goes into its stylesheet (brandCss.ts). Two blocks: the podcast's platforms
 * and the "find us here" socials. The Discord invite is for members, so it stays in the app.
 * `siteLinks.test.ts` fails when the website clone beside this one is stale.
 */
import { CLUB_LINK_GROUPS, type ClubLink } from './clubLinks';

export const SITE_LINK_BLOCKS = ['podcast', 'follow'] as const;
export type SiteLinkBlock = (typeof SITE_LINK_BLOCKS)[number];

/** Which app group feeds each block, the class the site's own CSS expects, and what stays app-only. */
const BLOCKS: Record<SiteLinkBlock, { group: string; className: string | null; skip: ReadonlySet<string>; indent: string }> = {
  podcast: { group: 'Twist the Throttle', className: 'pod-link', skip: new Set(), indent: '          ' },
  follow: { group: 'Follow the club', className: null, skip: new Set(['discord']), indent: '      ' },
};

export function siteLinksMarkers(key: SiteLinkBlock): { start: string; end: string } {
  return {
    start: `<!-- club-links:${key}:start (generated from the Rustnuts app, src/domain/clubLinks.ts; edit there, then npm run build:site) -->`,
    end: `<!-- club-links:${key}:end -->`,
  };
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function anchor(link: ClubLink, className: string | null, indent: string): string {
  const cls = className ? ` class="${className}"` : '';
  return `${indent}<a href="${esc(link.url)}" target="_blank" rel="noopener"${cls}>${esc(link.label)}</a>`;
}

/** One block: its markers around one anchor per link, indented the way the page is. */
export function siteLinksHtml(key: SiteLinkBlock): string {
  const spec = BLOCKS[key];
  const group = CLUB_LINK_GROUPS.find((g) => g.title === spec.group);
  if (!group) throw new Error(`No club-link group called ${spec.group}.`);
  const { start, end } = siteLinksMarkers(key);
  const links = group.links.filter((l) => !spec.skip.has(l.id));
  return `${start}\n${links.map((l) => anchor(l, spec.className, spec.indent)).join('\n')}\n${spec.indent}${end}\n`;
}

/** The home page with every club-links block replaced. Throws when a block's markers aren't there once each, in order. */
export function replaceSiteLinks(html: string): string {
  let out = html;
  for (const key of SITE_LINK_BLOCKS) {
    const { start, end } = siteLinksMarkers(key);
    const from = out.indexOf(start);
    const to = out.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`The page has no club-links:${key} markers (${start} … ${end}).`);
    if (out.indexOf(start, from + 1) >= 0 || out.indexOf(end, to + 1) >= 0) {
      throw new Error(`The page has more than one set of club-links:${key} markers.`);
    }
    out = out.slice(0, from) + siteLinksHtml(key).trimEnd() + out.slice(to + end.length);
  }
  return out;
}
