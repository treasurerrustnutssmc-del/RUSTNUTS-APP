import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLUB_LINK_GROUPS } from './clubLinks';
import { siteRepoPath } from './brandCss';
import { SITE_LINK_BLOCKS, replaceSiteLinks, siteLinksHtml, siteLinksMarkers } from './siteLinks';

test('the podcast block is the Twist the Throttle group as pod-link anchors, and the follow block the club socials', () => {
  const podcast = siteLinksHtml('podcast');
  for (const l of CLUB_LINK_GROUPS[1].links) {
    assert.ok(podcast.includes(`<a href="${l.url}" target="_blank" rel="noopener" class="pod-link">${l.label}</a>`), l.label);
  }
  const follow = siteLinksHtml('follow');
  assert.ok(follow.includes('<a href="https://www.facebook.com/RustnutsSMC/" target="_blank" rel="noopener">West Chapter on Facebook</a>'));
  assert.ok(follow.includes('RustnutsSMCNorthernChapter'));
  assert.ok(follow.includes('https://linktr.ee/rustnutssmc'));
  assert.ok(!follow.includes('discord'), 'the Discord invite is for members and stays in the app');
  assert.ok(!follow.includes('class='), 'the follow links take the section’s own styling');
});

test('every block starts and ends with its markers and names the app as the source', () => {
  for (const key of SITE_LINK_BLOCKS) {
    const { start, end } = siteLinksMarkers(key);
    const html = siteLinksHtml(key);
    assert.ok(html.startsWith(start) && html.trimEnd().endsWith(end), key);
    assert.match(start, /generated from the Rustnuts app/);
  }
});

test('replaceSiteLinks swaps every block between its markers and refuses when one is missing or doubled', () => {
  const page = '<div class="pod-links">\n<!-- club-links:podcast:start (generated from the Rustnuts app, src/domain/clubLinks.ts; edit there, then npm run build:site) -->\nold\n<!-- club-links:podcast:end -->\n</div>\n<div class="social">\n<!-- club-links:follow:start (generated from the Rustnuts app, src/domain/clubLinks.ts; edit there, then npm run build:site) -->\nold\n<!-- club-links:follow:end -->\n<a href="mailto:x@y.z">Email Us</a></div>';
  const out = replaceSiteLinks(page);
  assert.ok(!out.includes('old'));
  assert.ok(out.includes(siteLinksHtml('podcast').trimEnd()) && out.includes(siteLinksHtml('follow').trimEnd()));
  assert.ok(out.includes('<a href="mailto:x@y.z">Email Us</a>'), 'the hand-written parts stay');
  assert.equal(replaceSiteLinks(out), out, 'a second run changes nothing');
  assert.throws(() => replaceSiteLinks('<p>no markers</p>'), /no club-links:podcast markers/);
  assert.throws(() => replaceSiteLinks(page + page), /more than one/);
});

test('the website clone beside this one carries the current club links (run npm run build:site after a change)', (t) => {
  const indexPath = join(siteRepoPath(join(__dirname, '../..')), 'index.html');
  if (!existsSync(indexPath)) return t.skip('no website clone beside the app');
  const html = readFileSync(indexPath, 'utf8');
  assert.equal(replaceSiteLinks(html), html, 'the website home page is stale');
});
