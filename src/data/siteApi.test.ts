import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ORIGINS,
  ENQUIRY_WORDS,
  SPONSORS_CACHE,
  handleSiteApi,
  type SiteApiDeps,
} from '../../supabase/functions/_shared/siteApi';
import {
  BAD_ENQUIRY_EMAIL, LONG_ENQUIRY_ABOUT, LONG_ENQUIRY_NAME, NO_ENQUIRY_CHAPTER, NO_ENQUIRY_NAME, TOO_MANY_ENQUIRIES,
} from '../domain/enquiries';

const ORIGIN = 'https://www.rustnutssmc.com.au';

function deps(over: Partial<SiteApiDeps> = {}) {
  const calls: { enquiries: unknown[]; signed: string[] } = { enquiries: [], signed: [] };
  const d: SiteApiDeps = {
    listSponsors: async () => [
      { id: 's1', name: 'Dead Set Safety', blurb: 'Hi-vis and gear', url: 'https://deadset.example', deal: '10% off', logo_path: 'u/a.png' },
      { id: 's2', name: 'SVEA', blurb: null, url: null, deal: null, logo_path: null },
    ],
    signLogo: async (path) => { calls.signed.push(path); return `https://x.supabase.co/signed/${path}`; },
    enquire: async (e) => { calls.enquiries.push(e); return null; },
    ...over,
  };
  return { d, calls };
}

test('the function uses the same words as the app for the form checks', () => {
  assert.deepEqual(ENQUIRY_WORDS, {
    noName: NO_ENQUIRY_NAME, longName: LONG_ENQUIRY_NAME, badEmail: BAD_ENQUIRY_EMAIL,
    noChapter: NO_ENQUIRY_CHAPTER, longAbout: LONG_ENQUIRY_ABOUT, tooMany: TOO_MANY_ENQUIRIES,
  });
  assert.deepEqual(ALLOWED_ORIGINS, ['https://www.rustnutssmc.com.au', 'https://rustnutssmc.com.au']);
});

test('GET /sponsors: the public list, no deals, signed logos, cached a quarter hour', async () => {
  const { d, calls } = deps();
  const r = await handleSiteApi({ method: 'GET', path: '/sponsors', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    sponsors: [
      { id: 's1', name: 'Dead Set Safety', blurb: 'Hi-vis and gear', url: 'https://deadset.example', logo: 'https://x.supabase.co/signed/u/a.png' },
      { id: 's2', name: 'SVEA', blurb: null, url: null, logo: null },
    ],
  });
  assert.equal(r.headers['cache-control'], SPONSORS_CACHE);
  assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
  assert.deepEqual(calls.signed, ['u/a.png']);
  assert.ok(!JSON.stringify(r.body).includes('10% off'), 'no deal in public');
});

test('a logo that will not sign is left off rather than failing the list', async () => {
  const { d } = deps({ signLogo: async () => null });
  const r = await handleSiteApi({ method: 'GET', path: '/sponsors', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.equal((r.body as { sponsors: { logo: string | null }[] }).sponsors[0].logo, null);
});

test('when the database fails the site gets a short error and no cache', async () => {
  const { d } = deps({ listSponsors: async () => { throw new Error('boom'); } });
  const r = await handleSiteApi({ method: 'GET', path: '/sponsors', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 503);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('OPTIONS answers the browser; other origins get no CORS header; unknown paths are 404', async () => {
  const { d } = deps();
  const pre = await handleSiteApi({ method: 'OPTIONS', path: '/enquiry', origin: 'https://rustnutssmc.com.au', body: null }, d);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'https://rustnutssmc.com.au');
  assert.ok(pre.headers['access-control-allow-methods'].includes('POST'));
  const elsewhere = await handleSiteApi({ method: 'GET', path: '/sponsors', origin: 'https://evil.example', body: null }, d);
  assert.equal(elsewhere.status, 200, 'the sponsors list is public anyway');
  assert.equal(elsewhere.headers['access-control-allow-origin'], undefined);
  const none = await handleSiteApi({ method: 'GET', path: '/sponsors', origin: null, body: null }, d);
  assert.equal(none.status, 200, 'no Origin header (not a browser) is fine');
  const lost = await handleSiteApi({ method: 'GET', path: '/nope', origin: ORIGIN, body: null }, d);
  assert.equal(lost.status, 404);
  const wrong = await handleSiteApi({ method: 'POST', path: '/sponsors', origin: ORIGIN, body: {} }, d);
  assert.equal(wrong.status, 405);
});

test('POST /enquiry: cleaned and stored, then a thank-you', async () => {
  const { d, calls } = deps();
  const r = await handleSiteApi({
    method: 'POST', path: '/enquiry', origin: ORIGIN,
    body: { name: ' Sam Rider ', email: ' Sam@Example.com ', chapter: 'west', about: '  Street Glide. ', website: '' },
  }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(calls.enquiries, [{ name: 'Sam Rider', email: 'sam@example.com', chapter: 'west', about: 'Street Glide.' }]);
});

test('POST /enquiry: the checks in order, as 400s with the app words', async () => {
  const { d, calls } = deps();
  const ok = { name: 'Sam', email: 'sam@example.com', chapter: 'north', about: '' };
  const post = (body: unknown) => handleSiteApi({ method: 'POST', path: '/enquiry', origin: ORIGIN, body }, d);
  assert.deepEqual(await post({ ...ok, name: '' }).then((r) => [r.status, r.body]), [400, { error: NO_ENQUIRY_NAME }]);
  assert.deepEqual(await post({ ...ok, name: 'x'.repeat(81) }).then((r) => [r.status, r.body]), [400, { error: LONG_ENQUIRY_NAME }]);
  assert.deepEqual(await post({ ...ok, email: 'nope' }).then((r) => [r.status, r.body]), [400, { error: BAD_ENQUIRY_EMAIL }]);
  assert.deepEqual(await post({ ...ok, chapter: 'south' }).then((r) => [r.status, r.body]), [400, { error: NO_ENQUIRY_CHAPTER }]);
  assert.deepEqual(await post({ ...ok, about: 'x'.repeat(601) }).then((r) => [r.status, r.body]), [400, { error: LONG_ENQUIRY_ABOUT }]);
  assert.deepEqual(await post('not an object').then((r) => [r.status, r.body]), [400, { error: NO_ENQUIRY_NAME }]);
  assert.deepEqual(await post({ name: 42, email: null, chapter: ['west'], about: {} }).then((r) => r.status), 400, 'wrong types never throw');
  assert.equal(calls.enquiries.length, 0);
});

test('POST /enquiry: a filled honeypot is dropped quietly; another origin is refused', async () => {
  const { d, calls } = deps();
  const bot = await handleSiteApi({
    method: 'POST', path: '/enquiry', origin: ORIGIN,
    body: { name: 'Bot', email: 'bot@example.com', chapter: 'west', about: '', website: 'https://spam.example' },
  }, d);
  assert.deepEqual([bot.status, bot.body], [200, { ok: true }]);
  const elsewhere = await handleSiteApi({
    method: 'POST', path: '/enquiry', origin: 'https://evil.example',
    body: { name: 'Sam', email: 'sam@example.com', chapter: 'west', about: '' },
  }, d);
  assert.equal(elsewhere.status, 403);
  assert.equal(calls.enquiries.length, 0);
});

test('POST /enquiry: the database limits come back as 429, anything else as a 503 that names the club email', async () => {
  const busy = deps({ enquire: async () => TOO_MANY_ENQUIRIES });
  const r = await handleSiteApi({ method: 'POST', path: '/enquiry', origin: ORIGIN, body: { name: 'Sam', email: 'sam@example.com', chapter: 'west', about: '' } }, busy.d);
  assert.deepEqual([r.status, r.body], [429, { error: TOO_MANY_ENQUIRIES }]);
  const broken = deps({ enquire: async () => { throw new Error('connection refused'); } });
  const b = await handleSiteApi({ method: 'POST', path: '/enquiry', origin: ORIGIN, body: { name: 'Sam', email: 'sam@example.com', chapter: 'west', about: '' } }, broken.d);
  assert.equal(b.status, 503);
  assert.ok(String((b.body as { error: string }).error).includes('rustnutssmc@outlook.com'));
});
