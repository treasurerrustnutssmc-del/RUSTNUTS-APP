import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLUB_LINK_GROUPS, SUPPORT_URL } from './clubLinks';

const all = CLUB_LINK_GROUPS.flatMap((g) => g.links);

test('the club links come in three groups: the club, the podcast and socials', () => {
  assert.deepEqual(
    CLUB_LINK_GROUPS.map((g) => g.title),
    ['The club online', 'Twist the Throttle', 'Follow the club'],
  );
  for (const g of CLUB_LINK_GROUPS) assert.ok(g.links.length > 0, g.title);
});

test('every link is https and none appears twice', () => {
  for (const l of all) assert.match(l.url, /^https:\/\//, l.label);
  assert.equal(new Set(all.map((l) => l.url)).size, all.length);
  assert.equal(new Set(all.map((l) => l.label)).size, all.length);
});

test('the club group has the website, the shop and the Support page', () => {
  const club = CLUB_LINK_GROUPS[0].links.map((l) => l.url);
  assert.deepEqual(club, [
    'https://www.rustnutssmc.com.au/',
    'https://www.rustnutssmc.com.au/shop.html',
    SUPPORT_URL,
  ]);
  assert.equal(SUPPORT_URL, 'https://www.rustnutssmc.com.au/resources.html');
});

test('the podcast is on Spotify, YouTube, Facebook, Instagram and iHeart', () => {
  assert.deepEqual(
    CLUB_LINK_GROUPS[1].links.map((l) => l.label),
    ['Spotify', 'YouTube', 'Facebook', 'Instagram', 'iHeart'],
  );
});

test('socials cover both chapters on Facebook, the club Instagram and the Linktree', () => {
  const urls = CLUB_LINK_GROUPS[2].links.map((l) => l.url);
  assert.ok(urls.includes('https://www.facebook.com/RustnutsSMC/'));
  assert.ok(urls.includes('https://www.facebook.com/RustnutsSMCNorthernChapter/'));
  assert.ok(urls.includes('https://www.instagram.com/rustnuts_social2019/'));
  assert.ok(urls.includes('https://linktr.ee/rustnutssmc'));
});
