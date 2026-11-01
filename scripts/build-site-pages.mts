// Writes the club website's brand block and club links (the app's theme as CSS variables, between the markers in
// its styles.css) and the same font file, then the app's public pages twice (the welcome guide only once: it names the stores, so it stays
// off the website until launch): into site/ (GitHub Pages, the old addresses, each saying where
// it now lives) and, dressed in the club website's shell, into the website repo's app/ folder
// (www.rustnutssmc.com.au/app/…), plus the public illustrated Road Rules (diagrams only). The privacy policy and posting rules are rendered from code; the
// support, welcome guide and delete-account pages are hand-written in site/. Run after changing any
// of them, then commit both repos:
//
//   npm run build:site            # website clone at ../rustnutssmc
//   npm run build:site -- /path   # another clone (or SITE_REPO=/path, which the parity tests honour too)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPrivacyPage } from '../src/domain/privacyPage';
import { renderPostingRulesPage } from '../src/domain/postingRulesPage';
import { DIAGRAMS } from '../src/domain/roadRulesGuide';
import { ROAD_RULES_IMAGE_DIR, renderRoadRulesPage } from '../src/domain/roadRulesPage';
import { HELD_UNTIL_LAUNCH, SITE_PAGES, extractPage, mentionsStores, renderSitePage } from '../src/domain/sitePage';
import { brandCss, replaceBrandBlock, siteRepoPath } from '../src/domain/brandCss';
import { SITE_ICONS, SITE_ICONS_DIR } from '../src/domain/siteIcons';
import { replaceSiteLinks } from '../src/domain/siteLinks';

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
const siteRepo = resolve(process.argv[2] ?? siteRepoPath(root));
if (!existsSync(join(siteRepo, 'styles.css'))) {
  console.log(`No website clone at ${siteRepo}: skipped the www.rustnutssmc.com.au/app/ pages.`);
  process.exit(0);
}
// 2a. The brand: the theme's colours and fonts into styles.css, and the font file the app ships.
const stylesPath = join(siteRepo, 'styles.css');
writeFileSync(stylesPath, replaceBrandBlock(readFileSync(stylesPath, 'utf8'), brandCss()));
mkdirSync(join(siteRepo, 'fonts'), { recursive: true });
copyFileSync(join(root, 'assets/fonts/RustnutsStencil-Regular.ttf'), join(siteRepo, 'fonts/RustnutsStencil-Regular.ttf'));
copyFileSync(join(root, 'assets/fonts/OFL.txt'), join(siteRepo, 'fonts/OFL.txt'));
console.log(`Wrote the brand block into ${stylesPath}`);

// 2b. The icons: the app's skull icon as the site's favicon and touch icon (rendered by scripts/build-site-icons.py).
for (const icon of SITE_ICONS) copyFileSync(join(root, SITE_ICONS_DIR, icon.file), join(siteRepo, icon.file));
console.log(`Wrote ${SITE_ICONS.length} icon files into ${siteRepo}`);
// 2a'. One list of club links: the app's club links into the home page's podcast and socials blocks.
const indexPath = join(siteRepo, 'index.html');
writeFileSync(indexPath, replaceSiteLinks(readFileSync(indexPath, 'utf8')));
console.log(`Wrote the club links into ${indexPath}`);

// 2b. The app's public pages.
const out = join(siteRepo, 'app');
mkdirSync(out, { recursive: true });
for (const slug of SITE_PAGES) {
  const html = renderSitePage(slug, extractPage(readFileSync(join(site, `${slug}.html`), 'utf8')));
  if (mentionsStores(html)) throw new Error(`${slug}: names an app store, which the website must not before launch`);
  writeFileSync(join(out, `${slug}.html`), html);
}
// The Road Rules' public face: Chris's diagrams only, never the written rules members sign.
const roadRules = renderSitePage('road-rules', renderRoadRulesPage());
if (mentionsStores(roadRules)) throw new Error('road-rules: names an app store, which the website must not before launch');
writeFileSync(join(out, 'road-rules.html'), roadRules);
mkdirSync(join(out, ROAD_RULES_IMAGE_DIR), { recursive: true });
for (const d of DIAGRAMS) copyFileSync(join(root, 'assets/road-rules', `${d.id}.png`), join(out, ROAD_RULES_IMAGE_DIR, `${d.id}.png`));
console.log(`Wrote ${SITE_PAGES.length} pages and the illustrated Road Rules into ${out}; held until launch: ${HELD_UNTIL_LAUNCH.join(', ')}`);
