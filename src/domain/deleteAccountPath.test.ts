// The public pages (both app stores link to them) and the privacy policy tell people where Delete my
// account is. For members it sits in Me's settings group, so these must name that group by the title
// the app shows, and must not send members to the bottom of Me, where it was until 12 Nov 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { meGroups } from './meLayout';
import { PRIVACY_SECTIONS } from './privacyPolicy';

const settingsTitle = meGroups({ contacts: 0, bikes: 0, owingCents: 0, onHiatus: false, roadRules: null }).find(
  (g) => g.id === 'settings',
)!.title;
const page = (slug: string) => readFileSync(join(__dirname, '../../site', `${slug}.html`), 'utf8');
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

for (const slug of ['delete-account', 'support', 'guide']) {
  test(`site/${slug}.html sends members to Me › ${settingsTitle} for Delete my account`, () => {
    const text = plain(page(slug));
    assert.ok(text.includes(settingsTitle), `${slug} should name "${settingsTitle}"`);
    assert.doesNotMatch(text, /go to Me[^.]*scroll to the bottom/i);
    assert.doesNotMatch(text, /Me › Delete my account/);
  });
}

test('the privacy policy names the settings group for Delete my account', () => {
  const text = JSON.stringify(PRIVACY_SECTIONS);
  assert.ok(text.includes(`Me › ${settingsTitle}`), 'privacy policy should say where the button is');
  assert.doesNotMatch(text, /go to Me and tap Delete my account/);
});
