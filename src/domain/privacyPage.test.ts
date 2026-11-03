import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPrivacyPage } from './privacyPage';
import { PRIVACY_EMAIL, PRIVACY_SECTIONS, PRIVACY_URL, privacyUpdatedLine } from './privacyPolicy';

test('the public page is built from the same text as the app (run npm run build:site after a change)', () => {
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

test('the policy says what the update check sends Expo (a random install id and the error from a failed update launch)', () => {
  const services = JSON.stringify(PRIVACY_SECTIONS.find((s) => s.id === 'services'));
  assert.ok(/Expo[^"]*failed to start/.test(services), 'names the failed-update error');
  assert.ok(/Expo[^"]*install ID/.test(services), 'names the install ID');
});

test('the policy names every outside service the app sends data to', () => {
  const all = JSON.stringify(PRIVACY_SECTIONS);
  for (const name of ['Supabase', 'Expo', 'Firebase', 'Apple Push', 'LiveKit', 'Open-Meteo', 'Google Maps', 'Apple Maps', 'GIPHY', 'Gmail', 'ML Kit', 'Make.com', 'Resend', 'Anthropic']) {
    assert.ok(all.includes(name), name);
  }
});

test('the policy says what a feedback or issue report collects and who reads it', () => {
  const collect = JSON.stringify(PRIVACY_SECTIONS.find((s) => s.id === 'collect'));
  assert.ok(collect.includes('Feedback & issues'), 'names Feedback & issues');
  for (const bit of ['where in the app', 'screenshot', 'app version', 'build', 'device', 'app keepers']) {
    assert.ok(collect.includes(bit), bit);
  }
});

test('the policy says Ask the club and Catch me up ask permission before first use', () => {
  const services = JSON.stringify(PRIVACY_SECTIONS.find((s) => s.id === 'services'));
  assert.ok(/ask your permission[^"]*before you first use/i.test(services), 'permission before first use');
});

// Google Play data safety answers (3 Nov 2026): the policy has to say the same things.
const section = (id: string) => JSON.stringify(PRIVACY_SECTIONS.find((s) => s.id === id));

test('the policy no longer claims there is no analytics code: Google’s Maps SDK and ML Kit send usage data on Android', () => {
  const all = JSON.stringify(PRIVACY_SECTIONS);
  assert.ok(!all.includes('no analytics or advertising code'), 'old claim gone');
  const services = section('services');
  assert.ok(/Maps SDK[^"]*crash/i.test(services), 'Maps SDK sends crash data');
  assert.ok(/Maps SDK[^"]*(pan|moved)/i.test(services), 'Maps SDK sends map moves');
});

test('the policy says LiveKit gets the member ID and keeps session records', () => {
  const services = section('services');
  assert.ok(/LiveKit[^"]*member ID/.test(services), 'member ID');
  assert.ok(/LiveKit[^"]*session/.test(services), 'session records');
});

test('Family accounts can use the Family chat, and website photos never come from one-to-one or Family chats', () => {
  const see = section('see');
  assert.ok(/Family accounts[^"]*Family chat[^"]*read and post/.test(see), 'Family read and post in the Family chat');
  assert.ok(/Family accounts[^"]*name, road name, chapter and status/.test(see), 'says which member details Family see there');
  assert.ok(see.includes('one-to-one chats'), 'names one-to-one chats');
  assert.ok(/caption/.test(see), 'a caption can name someone');
});

test('photos are private except the ones put on the public website', () => {
  assert.ok(/website/.test(section('media')), 'media section names the website exception');
});

test('health or injury reasons for an excused ride are listed as collected', () => {
  assert.ok(/health or injury/.test(section('collect')));
});

test('deleting an account says shop order copies stay as club financial records', () => {
  assert.ok(/shop order[^"]*financial records/.test(section('keep')));
});

test('the policy names the website photos as the club’s own promotion, not ads aimed at members', () => {
  const why = section('why');
  assert.ok(!why.includes('use it for advertising'), 'old blanket line gone');
  assert.ok(/promote the club/.test(why), 'says website photos promote the club');
});

test('the Children section says the app is for adults, Family included, and that the join form asks', () => {
  const children = section('children');
  assert.ok(/Family accounts included/.test(children), 'Family are adults too');
  assert.ok(/join form asks everyone to confirm they’re 18 or over/.test(children), 'the join form asks');
});

test('health or injury reasons name everyone who can see them', () => {
  const collect = section('collect');
  assert.ok(/health or injury[^"]*chapter’s board[^"]*national office-bearers[^"]*Auditor/.test(collect), 'names every viewer in the same point');
});

test('the account deletion page says what is kept and how to delete some data without deleting the account', () => {
  const page = readFileSync(join(__dirname, '../../site/delete-account.html'), 'utf8');
  assert.ok(!page.includes('What the club keeps, without your name'), 'old heading gone');
  for (const bit of ['roster', 'Make.com', 'Rusty Bus', 'Delete some of your data and keep your account', 'Remove my message', 'Website photos', 'Take down', 'Birthday shout-out', 'Stop sharing it']) {
    assert.ok(page.includes(bit), bit);
  }
});

test('the support page and the welcome guide agree with the policy about Family and ads', () => {
  const support = readFileSync(join(__dirname, '../../site/support.html'), 'utf8');
  assert.ok(/Family chat/.test(support), 'support page names the Family chat');
  const guide = readFileSync(join(__dirname, '../../site/guide.html'), 'utf8');
  assert.ok(!/no ads/i.test(guide), 'the guide no longer says there are no ads');
});

test('the policy says why security and analytics purposes are used', () => {
  const why = section('why');
  assert.ok(/secure/.test(why) && /reported/.test(why) && /crash/.test(why));
});
