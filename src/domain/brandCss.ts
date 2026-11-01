/**
 * The club website's brand block: the app's theme (src/theme.ts) as CSS custom properties, written
 * by `npm run build:site` into the website repo's styles.css between two marker comments. The
 * app's theme is the one place to change a club colour or font; the rest of the stylesheet is the
 * website's own. `brandCss.test.ts` fails when the website clone beside this one is stale.
 */

import { join } from 'node:path';
import { colors, rideColors, webFonts } from '../brand';

/** The website clone the build writes into and the tests check: SITE_REPO, or ../rustnutssmc beside this repo. */
export const siteRepoPath = (appRoot: string): string => process.env.SITE_REPO ?? join(appRoot, '..', 'rustnutssmc');

export const BRAND_START = '/* brand:start (generated from the Rustnuts app, src/theme.ts; edit there, then npm run build:site) */';
export const BRAND_END = '/* brand:end */';

/** inkDim -> ink-dim, non_nuts -> non-nuts. */
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/_/g, '-');

/** The block: `:root{…}` with every theme colour, the ride colours and both fonts. */
export function brandCss(): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(colors)) lines.push(`  --${kebab(key)}:${value};`);
  for (const [key, c] of Object.entries(rideColors)) {
    lines.push(`  --ride-${kebab(key)}-bg:${c.bg};`);
    lines.push(`  --ride-${kebab(key)}-fg:${c.fg};`);
  }
  lines.push(`  --stencil:${webFonts.stencil};`);
  lines.push(`  --body:${webFonts.body};`);
  return `${BRAND_START}\n/* Generated from the Rustnuts app: club colours, ride calendar colours and fonts. */\n:root{\n${lines.join('\n')}\n}\n${BRAND_END}\n`;
}

/** The stylesheet with its brand block replaced. Throws when the markers aren't there once each, in order. */
export function replaceBrandBlock(stylesheet: string, block: string): string {
  const start = stylesheet.indexOf(BRAND_START);
  const end = stylesheet.indexOf(BRAND_END, start + BRAND_START.length);
  if (start < 0 || end < 0) throw new Error(`The stylesheet has no brand markers (${BRAND_START} … ${BRAND_END}).`);
  if (stylesheet.indexOf(BRAND_START, start + 1) >= 0 || stylesheet.indexOf(BRAND_END, end + 1) >= 0) {
    throw new Error('The stylesheet has more than one set of brand markers.');
  }
  return stylesheet.slice(0, start) + block.trimEnd() + stylesheet.slice(end + BRAND_END.length);
}
