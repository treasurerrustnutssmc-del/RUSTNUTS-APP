// Writes the app's public pages twice (the welcome guide only once: it names the stores, so it stays
// off the website until launch): into site/ (GitHub Pages, the old addresses, each saying where
// it now lives) and, dressed in the club website's shell, into the website repo's app/ folder
// (www.rustnutssmc.com.au/app/…). The privacy policy and posting rules are rendered from code; the
// support, welcome guide and delete-account pages are hand-written in site/. Run after changing any
// of them, then commit both repos:
//
//   npm run build:site            # website clone at ../rustnutssmc
//   npm run build:site -- /path   # another clone

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPrivacyPage } from '../src/domain/privacyPage';
import { renderPostingRulesPage } from '../src/domain/postingRulesPage';
import { HELD_UNTIL_LAUNCH, SITE_PAGES, extractPage, mentionsStores, renderSitePage } from '../src/domain/sitePage';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
mkdirSync(site, { recursive: true });

// 1. The GitHub Pages copies.
writeFileSync(join(site, 'privacy.html'), renderPrivacyPage());
writeFileSync(join(site, 'posting-rules.html'), renderPostingRulesPage());
copyFileSync(join(root, 'assets/logo.png'), join(site, 'logo.png'));
copyFileSync(join(root, 'assets/fonts/RustnutsStencil-Regular.ttf'), join(site, 'RustnutsStencil-Regular.ttf'));
copyFileSync(join(root, 'assets/fonts/OFL.txt'), join(site, 'OFL.txt'));
console.log('Wrote site/privacy.html and site/posting-rules.html');

// 2. The club-domain copies, when the website clone is beside this one (or given as the argument).
const siteRepo = resolve(process.argv[2] ?? join(root, '..', 'rustnutssmc'));
if (!existsSync(join(siteRepo, 'styles.css'))) {
  console.log(`No website clone at ${siteRepo}: skipped the www.rustnutssmc.com.au/app/ pages.`);
  process.exit(0);
}
const out = join(siteRepo, 'app');
mkdirSync(out, { recursive: true });
for (const slug of SITE_PAGES) {
  const html = renderSitePage(slug, extractPage(readFileSync(join(site, `${slug}.html`), 'utf8')));
  if (mentionsStores(html)) throw new Error(`${slug}: names an app store, which the website must not before launch`);
  writeFileSync(join(out, `${slug}.html`), html);
}
console.log(`Wrote ${SITE_PAGES.length} pages into ${out}; held until launch: ${HELD_UNTIL_LAUNCH.join(', ')}`);
