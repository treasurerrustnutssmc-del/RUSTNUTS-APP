import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPrivacyPage } from './privacyPage';
import { PRIVACY_EMAIL, PRIVACY_SECTIONS, PRIVACY_URL, privacyUpdatedLine } from './privacyPolicy';

test('the public page is built from the same text as the app (run npm run build:privacy after a change)', () => {
  const onDisk = readFileSync(join(__dirname, '../../site/privacy.html'), 'utf8');
  assert.equal(onDisk, renderPrivacyPage());
});

test('the page has every section, the date and a way to reach us', () => {
  const html = renderPrivacyPage();
  for (const s of PRIVACY_SECTIONS) assert.ok(html.includes(`id="${s.id}"`), s.id);
  assert.ok(html.includes(privacyUpdatedLine()));
  assert.ok(html.includes(`href="mailto:${PRIVACY_EMAIL}"`));
  assert.ok(html.includes('<link rel="canonical" href="' + PRIVACY_URL + '">'));
});

test('text is escaped for HTML', () => {
  const html = renderPrivacyPage([{ id: 'x', heading: 'A & B', blocks: ['<b>hi</b>', { points: ['"q"'] }] }]);
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt;'));
  assert.ok(html.includes('&quot;q&quot;'));
});

test('the updated line shows the date as DD/MM/YYYY', () => {
  assert.equal(privacyUpdatedLine('2026-10-31'), 'Last updated 31/10/2026');
});

test('the policy says what the update check sends Expo (last crash text and a random install id)', () => {
  const services = JSON.stringify(PRIVACY_SECTIONS.find((s) => s.id === 'services'));
  assert.ok(services.includes('crash'), 'names the crash text');
  assert.ok(services.includes('install id'), 'names the install id');
});

test('the policy names every outside service the app sends data to', () => {
  const all = JSON.stringify(PRIVACY_SECTIONS);
  for (const name of ['Supabase', 'Expo', 'Firebase', 'Apple Push', 'LiveKit', 'Open-Meteo', 'Google Maps', 'Apple Maps', 'GIPHY', 'Gmail']) {
    assert.ok(all.includes(name), name);
  }
});
