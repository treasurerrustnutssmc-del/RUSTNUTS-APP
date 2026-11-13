import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_LINK_FRESH_MS, APP_LINK_HOST, APP_LINK_PATH, appLinkTarget, linkToOpen, rideLink } from './appLinks';

test('the links live on the club website under /open/', () => {
  assert.equal(APP_LINK_HOST, 'www.rustnutssmc.com.au');
  assert.equal(APP_LINK_PATH, '/open');
  assert.equal(rideLink('abc-123'), 'https://www.rustnutssmc.com.au/open/?ride=abc-123');
});

test('a ride link opens that ride', () => {
  const id = '6f1c2a9e-0b7d-4a51-9f3e-2d8c1b0a7e44';
  assert.deepEqual(appLinkTarget(rideLink(id)), { kind: 'ride', rideId: id });
});

test('the bare /open/ link (and /open) just opens the app', () => {
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open/'), { kind: 'home' });
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open'), { kind: 'home' });
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open/index.html'), { kind: 'home' });
});

test('the same link lands from the bare domain, http, upper case and the app scheme', () => {
  const want = { kind: 'ride', rideId: 'r1' };
  assert.deepEqual(appLinkTarget('https://rustnutssmc.com.au/open/?ride=r1'), want);
  assert.deepEqual(appLinkTarget('http://www.rustnutssmc.com.au/open/?ride=r1'), want);
  assert.deepEqual(appLinkTarget('HTTPS://WWW.RustnutsSMC.com.au/open/?ride=r1'), want);
  assert.deepEqual(appLinkTarget('rustnuts://open/?ride=r1'), want);
  assert.deepEqual(appLinkTarget('rustnuts:///open/?ride=r1'), want);
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open/?utm_source=fb&ride=r1#x'), want);
});

test('a junk or missing ride id opens the app without moving', () => {
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open/?ride='), { kind: 'home' });
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open/?ride=%3Cscript%3E'), { kind: 'home' });
  assert.deepEqual(appLinkTarget(`https://www.rustnutssmc.com.au/open/?ride=${'a'.repeat(65)}`), { kind: 'home' });
  assert.deepEqual(appLinkTarget('https://www.rustnutssmc.com.au/open/?chat=c1'), { kind: 'home' });
});

test('every other website page, and other sites, stay web pages', () => {
  for (const url of [
    'https://www.rustnutssmc.com.au/',
    'https://www.rustnutssmc.com.au/shop.html',
    'https://www.rustnutssmc.com.au/charity.html',
    'https://www.rustnutssmc.com.au/app/privacy.html',
    'https://www.rustnutssmc.com.au/opener.html',
    'https://www.rustnutssmc.com.au/photos/open/x.jpg',
    'https://evil.example/open/?ride=r1',
    'https://rustnutssmc.com.au.evil.example/open/?ride=r1',
    'https://www.rustnutssmc.com.au@evil.example/open/?ride=r1',
    'rustnuts://somewhere-else',
    'mailto:apps@rustnutssmc.com.au',
    'not a url',
    '',
  ]) {
    assert.equal(appLinkTarget(url), null, url);
  }
});

test('a waiting ride link opens for five minutes, then is dropped; a plain /open/ link opens nothing', () => {
  const at = 1_000_000;
  const ride = { target: { kind: 'ride' as const, rideId: 'r1' }, at };
  assert.deepEqual(linkToOpen(ride, at), { rideId: 'r1' });
  assert.deepEqual(linkToOpen(ride, at + APP_LINK_FRESH_MS), { rideId: 'r1' });
  assert.equal(linkToOpen(ride, at + APP_LINK_FRESH_MS + 1), null);
  assert.equal(linkToOpen({ target: { kind: 'home' }, at }, at), null);
  assert.equal(linkToOpen(null, at), null);
});
