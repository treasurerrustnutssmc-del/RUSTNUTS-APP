import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPostingRulesPage } from './postingRulesPage';
import { POSTING_RULES_EMAIL, POSTING_RULES_SECTIONS, POSTING_RULES_URL, postingRulesUpdatedLine } from './postingRules';

test('the public rules page is built from the same text as the app (run npm run build:privacy after a change)', () => {
  const onDisk = readFileSync(join(__dirname, '../../site/posting-rules.html'), 'utf8');
  assert.equal(onDisk, renderPostingRulesPage());
});

test('the page has every section, the date and a way to reach us', () => {
  const html = renderPostingRulesPage();
  for (const s of POSTING_RULES_SECTIONS) assert.ok(html.includes(`id="${s.id}"`), s.id);
  assert.ok(html.includes(postingRulesUpdatedLine()));
  assert.ok(html.includes(`href="mailto:${POSTING_RULES_EMAIL}"`));
  assert.ok(html.includes('<link rel="canonical" href="' + POSTING_RULES_URL + '">'));
});

test('the rules say what App Review asks for: no tolerance, report, block, 24 hours', () => {
  const all = JSON.stringify(POSTING_RULES_SECTIONS).toLowerCase();
  for (const words of ['no tolerance', 'objectionable content', 'abusive members', 'report', 'block', '24 hours']) {
    assert.ok(all.includes(words), words);
  }
});

test('text is escaped for HTML', () => {
  const html = renderPostingRulesPage([{ id: 'x', heading: 'A & B', blocks: ['<b>hi</b>', { points: ['"q"'] }] }]);
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt;'));
  assert.ok(html.includes('&quot;q&quot;'));
});
