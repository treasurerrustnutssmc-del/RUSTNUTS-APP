// Writes the public privacy policy page into site/ (published by GitHub Pages), with the club logo
// and stencil font beside it. Run after changing src/domain/privacyPolicy.ts:
//
//   npm run build:privacy

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPrivacyPage } from '../src/domain/privacyPage';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'privacy.html'), renderPrivacyPage());
copyFileSync(join(root, 'assets/logo.png'), join(site, 'logo.png'));
copyFileSync(join(root, 'assets/fonts/RustnutsStencil-Regular.ttf'), join(site, 'RustnutsStencil-Regular.ttf'));
copyFileSync(join(root, 'assets/fonts/OFL.txt'), join(site, 'OFL.txt'));
console.log('Wrote site/privacy.html');
