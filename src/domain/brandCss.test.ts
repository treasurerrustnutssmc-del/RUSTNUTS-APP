import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colors, rideColors, webFonts } from '../brand';
import { BRAND_END, BRAND_START, brandCss, replaceBrandBlock, siteRepoPath } from './brandCss';

test('the brand block carries every theme colour, the ride colours and both fonts as CSS variables', () => {
  const css = brandCss();
  assert.ok(css.startsWith(BRAND_START) && css.trimEnd().endsWith(BRAND_END));
  assert.ok(css.includes(':root{'));
  assert.ok(css.includes(`--ink:${colors.ink};`));
  assert.ok(css.includes(`--red-text:${colors.redText};`), 'camelCase becomes kebab-case');
  assert.ok(css.includes(`--line-strong:${colors.lineStrong};`));
  assert.ok(css.includes(`--ride-north-bg:${rideColors.north.bg};`) && css.includes(`--ride-north-fg:${rideColors.north.fg};`));
  assert.ok(css.includes(`--ride-non-nuts-bg:${rideColors.non_nuts.bg};`), 'snake_case too');
  assert.ok(css.includes(`--stencil:${webFonts.stencil};`));
  assert.ok(css.includes(`--body:${webFonts.body};`));
  assert.ok(css.includes('Generated from the Rustnuts app'), 'says where it comes from');
  for (const key of Object.keys(colors)) assert.ok(css.includes(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:`), key);
  for (const key of Object.keys(rideColors)) assert.ok(css.includes(`--ride-${key.replace(/_/g, '-')}-bg:`) && css.includes(`--ride-${key.replace(/_/g, '-')}-fg:`), key);
});

test('the block replaces what sits between the markers in the site stylesheet, and refuses when they are missing', () => {
  const before = `/* site */\n${BRAND_START}\n:root{--old:1}\n${BRAND_END}\nbody{color:var(--bone)}\n`;
  const after = replaceBrandBlock(before, brandCss());
  assert.ok(after.startsWith('/* site */\n'));
  assert.ok(after.endsWith('\nbody{color:var(--bone)}\n'));
  assert.ok(!after.includes('--old'));
  assert.ok(after.includes(`--bone:${colors.bone};`));
  assert.equal(replaceBrandBlock(after, brandCss()), after, 'running it again changes nothing');
  assert.throws(() => replaceBrandBlock('body{}', brandCss()), /markers/);
  assert.throws(() => replaceBrandBlock(`${BRAND_END}\n${BRAND_START}`, brandCss()), /markers/);
  assert.throws(() => replaceBrandBlock(`${before}\n${BRAND_START}\n${BRAND_END}\n`, brandCss()), /more than one/, 'a stray second copy is refused, not left behind');
});

test('the website clone beside this one carries the current brand block (run npm run build:site after a theme change)', (t) => {
  const siteRepo = siteRepoPath(join(__dirname, '../..'));
  const stylesPath = join(siteRepo, 'styles.css');
  if (!existsSync(stylesPath)) return t.skip('no website clone beside the app');
  const styles = readFileSync(stylesPath, 'utf8');
  assert.equal(replaceBrandBlock(styles, brandCss()), styles, 'the website stylesheet is stale');
  const theirs = readFileSync(join(siteRepo, 'fonts/RustnutsStencil-Regular.ttf'));
  const ours = readFileSync(join(__dirname, '../../assets/fonts/RustnutsStencil-Regular.ttf'));
  assert.ok(theirs.equals(ours), 'the website ships a different font file');
});
