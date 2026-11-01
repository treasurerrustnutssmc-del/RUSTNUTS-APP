import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPolicyPage } from './policyPage';
import { siteRepoPath } from './brandCss';
import { APP_PAGES, HELD_UNTIL_LAUNCH, SITE_PAGES, extractPage, mentionsStores, renderSitePage, sitePageUrl } from './sitePage';

const sample = `<!doctype html>
<html lang="en-AU">
<head>
  <title>Rustnuts app: thing &amp; stuff</title>
  <meta name="description" content="What the &quot;thing&quot; is.">
</head>
<body>
  <main>
    <header>
      <img src="logo.png" alt="Rustnuts Social Motorcycle Club, est. 2019">
      <h1>The thing</h1>
      <p class="updated">Last updated 01/11/2026</p>
    </header>
    <p class="intro">Hello.</p>
    <section id="a"><h2>A</h2><p>Body</p></section>
    <footer>Rustnuts Social Motorcycle Club Incorporated</footer>
  </main>
</body>
</html>`;

test('a GitHub Pages copy is taken apart into its title, description, heading, date and body', () => {
  const page = extractPage(sample);
  assert.equal(page.title, 'Rustnuts app: thing & stuff');
  assert.equal(page.description, 'What the "thing" is.');
  assert.equal(page.heading, 'The thing');
  assert.equal(page.updated, 'Last updated 01/11/2026');
  assert.ok(page.body.includes('<p class="intro">Hello.</p>'));
  assert.ok(page.body.includes('<section id="a">'));
  assert.ok(!page.body.includes('<header>'), 'the logo header goes: the site has its own');
  assert.ok(!page.body.includes('<footer>'), 'the footer goes: the site has its own');
  assert.ok(!page.body.includes('logo.png'));
  const moved = extractPage(sample.replace('<p class="intro">', '<p class="moved">This page now lives at x.</p>\n    <p class="intro">'));
  assert.ok(!moved.body.includes('now lives at'), 'the moved note is for the old copy only');
});

test('a page without the logo header or a date still comes apart', () => {
  const page = extractPage('<html><head><title>T</title></head><body><main><h1>H</h1><p>x</p></main></body></html>');
  assert.equal(page.title, 'T');
  assert.equal(page.description, '');
  assert.equal(page.heading, 'H');
  assert.equal(page.updated, null);
  assert.equal(page.body.trim(), '<p>x</p>');
});

test('the club-domain page wears the site shell, keeps the words, and links to the other app pages', () => {
  const html = renderSitePage('privacy', extractPage(sample));
  assert.ok(html.includes('<link rel="canonical" href="https://www.rustnutssmc.com.au/app/privacy.html" />'));
  assert.ok(html.includes('<title>Rustnuts app: thing &amp; stuff | Rustnuts SMC</title>'));
  assert.ok(html.includes('content="What the &quot;thing&quot; is."'));
  assert.ok(html.includes('href="../styles.css"'));
  assert.ok(html.includes('href="../charity.html"'), 'the site nav');
  assert.ok(html.includes('class="nav-mobile"'));
  assert.ok(html.includes('<h1 class="display">The thing</h1>'));
  assert.ok(html.includes('Last updated 01/11/2026'));
  assert.ok(html.includes('<section id="a">'));
  assert.ok(html.includes('href="support.html"') && html.includes('href="delete-account.html"'), 'footer links between the app pages');
  assert.ok(!html.includes('guide.html'), 'the welcome guide is held back until launch, so nothing links to it');
  assert.ok(!html.includes('logo.png'));
  assert.ok(!mentionsStores(html), 'nothing about the stores before launch');
});

test('the store check catches store links', () => {
  assert.ok(mentionsStores('<a href="https://apps.apple.com/x">a</a>'));
  assert.ok(mentionsStores('see play.google.com/store'));
  assert.ok(mentionsStores('tap the Google Play link in your invite'), 'by name too');
  assert.ok(mentionsStores('searching the App Store'));
  assert.ok(!mentionsStores('Open the app and go to Me'));
});

test('the old GitHub Pages copy says where the page now lives and points its canonical there', () => {
  const html = renderPolicyPage({
    title: 't', heading: 'h', description: 'd', url: sitePageUrl('privacy'), updatedLine: 'Last updated 01/11/2026',
    intro: 'i', sections: [], email: 'apps@rustnutssmc.com.au', movedTo: sitePageUrl('privacy'),
  });
  assert.ok(html.includes('<link rel="canonical" href="https://www.rustnutssmc.com.au/app/privacy.html">'));
  assert.ok(html.includes('This page now lives at <a href="https://www.rustnutssmc.com.au/app/privacy.html">www.rustnutssmc.com.au/app/privacy.html</a>'));
  const plain = renderPolicyPage({ title: 't', heading: 'h', description: 'd', url: 'https://x', updatedLine: 'u', intro: 'i', sections: [], email: 'e' });
  assert.ok(!plain.includes('now lives at'));
});

test('every app page in site/ comes apart cleanly; the ones on the website mention no store', () => {
  for (const slug of APP_PAGES) {
    const html = readFileSync(join(__dirname, `../../site/${slug}.html`), 'utf8');
    const page = extractPage(html);
    assert.ok(page.title && page.heading && page.body.trim(), slug);
    assert.equal(mentionsStores(renderSitePage(slug, page)), HELD_UNTIL_LAUNCH.includes(slug), slug);
  }
  assert.deepEqual([...SITE_PAGES], ['privacy', 'posting-rules', 'support', 'delete-account']);
});

test('the website clone beside this one carries the same pages (run npm run build:site after a change)', (t) => {
  const siteDir = join(siteRepoPath(join(__dirname, '../..')), 'app');
  if (!existsSync(siteDir)) return t.skip('no website clone beside the app');
  for (const slug of SITE_PAGES) {
    const page = extractPage(readFileSync(join(__dirname, `../../site/${slug}.html`), 'utf8'));
    assert.equal(readFileSync(join(siteDir, `${slug}.html`), 'utf8'), renderSitePage(slug, page), `${slug}: the website copy is stale`);
  }
  for (const slug of HELD_UNTIL_LAUNCH) assert.ok(!existsSync(join(siteDir, `${slug}.html`)), `${slug} is held until launch`);
});
