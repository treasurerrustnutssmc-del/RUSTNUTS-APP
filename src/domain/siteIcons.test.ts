import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteRepoPath } from './brandCss';
import { SITE_ICONS, SITE_ICONS_DIR, icoSizes, pngSize, siteIconProblem } from './siteIcons';

const root = join(__dirname, '../..');

const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const ico = (...sizes: number[]): Uint8Array => {
  const b = new Uint8Array(6 + sizes.length * 16);
  const dv = new DataView(b.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, sizes.length, true);
  sizes.forEach((s, i) => { b[6 + i * 16] = s === 256 ? 0 : s; b[7 + i * 16] = s === 256 ? 0 : s; });
  return b;
};

test('the site links the four icon files the pages already name, as PNGs plus one ICO', () => {
  assert.deepEqual(SITE_ICONS.map((i) => i.file), ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']);
  assert.equal(SITE_ICONS.filter((i) => i.kind === 'ico').length, 1);
});

test('PNG and ICO headers are read without an image library', () => {
  assert.deepEqual(pngSize(png(180, 180)), { width: 180, height: 180 });
  assert.equal(pngSize(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(icoSizes(ico(16, 32, 256)), [16, 32, 256]);
  assert.equal(icoSizes(png(16, 16)), null);
});

test('a rendered icon must be the square size of its slot, and the ICO must hold 16 and 32', () => {
  const touch = SITE_ICONS.find((i) => i.file === 'apple-touch-icon.png')!;
  const fav = SITE_ICONS.find((i) => i.file === 'favicon.ico')!;
  assert.equal(siteIconProblem(touch, png(180, 180)), null);
  assert.match(siteIconProblem(touch, png(180, 120))!, /180x120/);
  assert.match(siteIconProblem(touch, ico(180))!, /not a PNG/);
  assert.equal(siteIconProblem(fav, ico(16, 32, 48)), null);
  assert.match(siteIconProblem(fav, ico(32))!, /not 16/);
  assert.match(siteIconProblem(fav, png(32, 32))!, /not an ICO/);
});

test('the rendered set in assets/site-icons fits every slot (run scripts/build-site-icons.py after an icon change)', () => {
  for (const icon of SITE_ICONS) {
    const p = join(root, SITE_ICONS_DIR, icon.file);
    assert.ok(existsSync(p), `${p} is missing`);
    assert.equal(siteIconProblem(icon, readFileSync(p)), null);
  }
});

test('the rendered set came from the current assets/icon.png (run npm run build:site-icons after an icon change)', () => {
  const recorded = readFileSync(join(root, SITE_ICONS_DIR, 'source.sha256'), 'utf8').trim();
  const actual = createHash('sha256').update(readFileSync(join(root, 'assets/icon.png'))).digest('hex');
  assert.equal(recorded, actual, 'assets/site-icons was rendered from a different icon.png');
});

test('the website clone beside this one ships the same icon files (run npm run build:site after an icon change)', (t) => {
  const siteRepo = siteRepoPath(root);
  if (!existsSync(join(siteRepo, 'styles.css'))) return t.skip('no website clone beside the app');
  for (const icon of SITE_ICONS) {
    const theirs = readFileSync(join(siteRepo, icon.file));
    const ours = readFileSync(join(root, SITE_ICONS_DIR, icon.file));
    assert.ok(theirs.equals(ours), `the website's ${icon.file} is not the app's`);
  }
});
