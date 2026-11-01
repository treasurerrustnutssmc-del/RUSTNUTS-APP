import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ORIGINS,
  CHARITY_CACHE,
  DOCUMENTS_CACHE,
  NEWS_CACHE,
  PHOTOS_CACHE,
  cleanVisitPage,
  ENQUIRY_WORDS,
  SIGNUP_WORDS,
  SPONSORS_CACHE,
  handleSiteApi,
  type SiteApiDeps,
} from '../../supabase/functions/_shared/siteApi';
import {
  BAD_SIGNUP_EMAIL, LONG_SIGNUP_NAME, LONG_SIGNUP_PHONE, NOT_ON_WEBSITE, NO_SIGNUP_NAME, TOO_MANY_SIGNUPS,
} from '../domain/websiteSignups';
import {
  GUESTS_LIMITS, JOB_NOT_LISTED, NOTHING_PICKED, PILLION_NEEDS_RIDER, RIDE_FULL, SIGNUP_TOO_LONG, SIGNUPS_CLOSED,
} from '../domain/charity';
import {
  BAD_ENQUIRY_EMAIL, LONG_ENQUIRY_ABOUT, LONG_ENQUIRY_NAME, NO_ENQUIRY_CHAPTER, NO_ENQUIRY_NAME, TOO_MANY_ENQUIRIES,
} from '../domain/enquiries';

const ORIGIN = 'https://www.rustnutssmc.com.au';

function deps(over: Partial<SiteApiDeps> = {}) {
  const calls: { enquiries: unknown[]; signed: string[]; signups: unknown[]; visits: string[] } = { enquiries: [], signed: [], signups: [], visits: [] };
  const d: SiteApiDeps = {
    listSponsors: async () => [
      { id: 's1', name: 'Dead Set Safety', blurb: 'Hi-vis and gear', url: 'https://deadset.example', deal: '10% off', logo_path: 'u/a.png' },
      { id: 's2', name: 'SVEA', blurb: null, url: null, deal: null, logo_path: null },
    ],
    signLogo: async (path) => { calls.signed.push(path); return `https://x.supabase.co/signed/${path}`; },
    enquire: async (e) => { calls.enquiries.push(e); return null; },
    listRides: async () => [],
    listCharityRides: async () => [],
    websiteSignup: async (w) => { calls.signups.push(w); return null; },
    listDocuments: async () => [],
    listNews: async () => [],
    countVisit: async (page) => { calls.visits.push(page); },
    listPhotos: async () => [],
    signPhoto: async (bucket, path) => { calls.signed.push(`${bucket}/${path}`); return `https://x.supabase.co/signed/${bucket}/${path}`; },
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

test('GET /rides: the public ride list straight through, cached a quarter hour', async () => {
  const rides = [
    { id: 'r1', title: 'West Sunday Run', starts_at: '2026-11-08T22:00:00+00:00', ends_at: null, all_day: false, category: 'west', location: 'Bacchus Marsh', notes: 'Meet 9am', cancelled_at: null },
  ];
  const { d } = deps({ listRides: async () => rides });
  const r = await handleSiteApi({ method: 'GET', path: '/rides', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { rides });
  assert.equal(r.headers['cache-control'], SPONSORS_CACHE);
  const post = await handleSiteApi({ method: 'POST', path: '/rides', origin: ORIGIN, body: {} }, d);
  assert.equal(post.status, 405);
  const { d: broken } = deps({ listRides: async () => { throw new Error('boom'); } });
  const down = await handleSiteApi({ method: 'GET', path: '/rides', origin: ORIGIN, body: null }, broken);
  assert.equal(down.status, 503);
  assert.equal(down.headers['cache-control'], 'no-store');
});

const RIDE = '00000000-0000-0000-0000-00000000dd01';
const signup = { ride: RIDE, name: 'Sam Rider', email: 'sam@example.com', phone: '', riding: true, pillion: false, guests: 0, guestNames: '', job: '', notes: '' };

test('the sign-up words are the app’s', () => {
  assert.deepEqual(SIGNUP_WORDS, {
    notOnWebsite: NOT_ON_WEBSITE, closed: SIGNUPS_CLOSED, noName: NO_SIGNUP_NAME, longName: LONG_SIGNUP_NAME, badEmail: BAD_SIGNUP_EMAIL,
    longPhone: LONG_SIGNUP_PHONE, nothingPicked: NOTHING_PICKED, pillionNeedsRider: PILLION_NEEDS_RIDER, guests: GUESTS_LIMITS,
    jobNotListed: JOB_NOT_LISTED, tooLong: SIGNUP_TOO_LONG, tooMany: TOO_MANY_SIGNUPS, full: RIDE_FULL,
  });
});

test('GET /charity-rides: the public list straight through, cached five minutes; 503 no-store when down', async () => {
  const rides = [{
    ride_id: RIDE, title: 'Ride for Kids', starts_at: '2026-11-15T22:00:00+00:00', all_day: false, location: 'Sunbury BP',
    cause: 'RCH', about: null, closes_on: null, jobs: ['BBQ'], places: 40, places_left: 12, open: true,
  }];
  const { d } = deps({ listCharityRides: async () => rides });
  const r = await handleSiteApi({ method: 'GET', path: '/charity-rides', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { rides });
  assert.equal(r.headers['cache-control'], CHARITY_CACHE);
  const down = deps({ listCharityRides: async () => { throw new Error('boom'); } });
  const b = await handleSiteApi({ method: 'GET', path: '/charity-rides', origin: ORIGIN, body: null }, down.d);
  assert.equal(b.status, 503);
  assert.equal(b.headers['cache-control'], 'no-store');
  assert.equal((await handleSiteApi({ method: 'POST', path: '/charity-rides', origin: ORIGIN, body: {} }, d)).status, 405);
});

test('GET /documents: the Constitution straight through, cached an hour; 503 no-store when down', async () => {
  const documents = [{
    kind: 'constitution', title: 'Constitution', label: 'v4', approving_body: null, approved_on: null, commences_on: null,
    published_at: '2026-10-25T03:00:00+00:00', body: '# CLUB-APPROVED FINAL EDITION\n\nText.',
  }];
  const { d } = deps({ listDocuments: async () => documents });
  const r = await handleSiteApi({ method: 'GET', path: '/documents', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { documents });
  assert.equal(r.headers['cache-control'], DOCUMENTS_CACHE);
  assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
  const down = deps({ listDocuments: async () => { throw new Error('boom'); } });
  const b = await handleSiteApi({ method: 'GET', path: '/documents', origin: ORIGIN, body: null }, down.d);
  assert.equal(b.status, 503);
  assert.equal(b.headers['cache-control'], 'no-store');
  assert.equal((await handleSiteApi({ method: 'POST', path: '/documents', origin: ORIGIN, body: {} }, d)).status, 405);
  const elsewhere = await handleSiteApi({ method: 'GET', path: '/documents', origin: 'https://evil.example', body: null }, d);
  assert.equal(elsewhere.status, 200);
  assert.equal(elsewhere.headers['access-control-allow-origin'], undefined, 'no CORS for other sites');
});

test('GET /news: the board’s notices straight through, cached five minutes; 503 no-store when down', async () => {
  const news = [{ id: 'n1', title: 'Toy run', body: 'Sunday 7 December.', link: 'https://www.rustnutssmc.com.au/charity.html', created_at: '2026-11-01T03:00:00+00:00' }];
  const { d } = deps({ listNews: async () => news });
  const r = await handleSiteApi({ method: 'GET', path: '/news', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { news });
  assert.equal(r.headers['cache-control'], NEWS_CACHE);
  assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
  const down = deps({ listNews: async () => { throw new Error('boom'); } });
  const b = await handleSiteApi({ method: 'GET', path: '/news', origin: ORIGIN, body: null }, down.d);
  assert.equal(b.status, 503);
  assert.equal(b.headers['cache-control'], 'no-store');
  assert.equal((await handleSiteApi({ method: 'POST', path: '/news', origin: ORIGIN, body: {} }, d)).status, 405);
});

test('GET /photos: the picked photos with signed links and captions, nothing personal; a photo that won’t sign is left out', async () => {
  const rows = [
    { id: 'p1', bucket: 'chat-media', path: 'club/a.jpg', width: 1200, height: 900, caption: 'Spring run', taken_at: '2026-10-13T06:10:00+00:00' },
    { id: 'p2', bucket: 'site-media', path: 'u/b.jpg', width: 1600, height: 1200, caption: null, taken_at: '2026-10-12T06:10:00+00:00' },
    { id: 'p3', bucket: 'site-media', path: 'u/gone.jpg', width: 1, height: 1, caption: 'Gone', taken_at: '2026-10-11T06:10:00+00:00' },
  ];
  const { d, calls } = deps({ listPhotos: async () => rows, signPhoto: async (bucket, path) => { calls.signed.push(`${bucket}/${path}`); return path.includes('gone') ? null : `https://x.supabase.co/signed/${bucket}/${path}`; } });
  const r = await handleSiteApi({ method: 'GET', path: '/photos', origin: ORIGIN, body: null }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    photos: [
      { id: 'p1', url: 'https://x.supabase.co/signed/chat-media/club/a.jpg', width: 1200, height: 900, caption: 'Spring run', taken_at: '2026-10-13T06:10:00+00:00' },
      { id: 'p2', url: 'https://x.supabase.co/signed/site-media/u/b.jpg', width: 1600, height: 1200, caption: null, taken_at: '2026-10-12T06:10:00+00:00' },
    ],
  });
  assert.equal(r.headers['cache-control'], PHOTOS_CACHE);
  assert.deepEqual(calls.signed, ['chat-media/club/a.jpg', 'site-media/u/b.jpg', 'site-media/u/gone.jpg']);
  const down = deps({ listPhotos: async () => { throw new Error('boom'); } });
  const b = await handleSiteApi({ method: 'GET', path: '/photos', origin: ORIGIN, body: null }, down.d);
  assert.equal(b.status, 503);
  assert.equal(b.headers['cache-control'], 'no-store');
  assert.equal((await handleSiteApi({ method: 'POST', path: '/photos', origin: ORIGIN, body: {} }, d)).status, 405);
});

test('POST /visit: counts a clean page path, drops the rest, never errors to the page', async () => {
  const { d, calls } = deps();
  const r = await handleSiteApi({ method: 'POST', path: '/visit', origin: ORIGIN, body: { page: '/index.html' } }, d);
  assert.equal(r.status, 204);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
  await handleSiteApi({ method: 'POST', path: '/visit', origin: ORIGIN, body: { page: '/charity.html' } }, d);
  await handleSiteApi({ method: 'POST', path: '/visit', origin: ORIGIN, body: { page: '/Nope?x=1' } }, d);
  await handleSiteApi({ method: 'POST', path: '/visit', origin: ORIGIN, body: 'junk' }, d);
  assert.deepEqual(calls.visits, ['/', '/charity.html', '/'], 'no page at all counts as the home page');
  const down = deps({ countVisit: async () => { throw new Error('boom'); } });
  assert.equal((await handleSiteApi({ method: 'POST', path: '/visit', origin: ORIGIN, body: { page: '/' } }, down.d)).status, 204);
  assert.equal((await handleSiteApi({ method: 'GET', path: '/visit', origin: ORIGIN, body: null }, d)).status, 405);
  assert.equal((await handleSiteApi({ method: 'POST', path: '/visit', origin: 'https://evil.example', body: { page: '/' } }, d)).status, 403);
  assert.equal(calls.visits.length, 3, 'nothing counted from elsewhere');
});

test('the visit page rule is the same in the app and the function', async () => {
  const app = await import('../domain/siteVisits');
  for (const raw of ['/', '', '/index.html', 'get-the-app', '/app/privacy.html', '/Charity.html', '/a b', '/x?y=1', '/' + 'a'.repeat(80), 'https://evil.example/']) {
    assert.equal(cleanVisitPage(raw), app.cleanVisitPage(raw), raw);
  }
});

test('POST /charity-signup: cleaned and stored, then a thank-you', async () => {
  const { d, calls } = deps();
  const r = await handleSiteApi({
    method: 'POST', path: '/charity-signup', origin: ORIGIN,
    body: { ...signup, name: ' Sam Rider ', email: ' Sam@Example.com ', phone: ' 0400 000 000 ', guests: 2, guestNames: ' Bec and Joe ', job: ' BBQ ', notes: '  ', website: '' },
  }, d);
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.deepEqual(calls.signups, [{
    ride: RIDE, name: 'Sam Rider', email: 'sam@example.com', phone: '0400 000 000', riding: true, pillion: false, guests: 2,
    guest_names: 'Bec and Joe', job: 'BBQ', notes: null,
  }]);
});

test('POST /charity-signup: the checks in order, as 400s with the app words', async () => {
  const { d, calls } = deps();
  const post = (body: unknown) => handleSiteApi({ method: 'POST', path: '/charity-signup', origin: ORIGIN, body }, d).then((r) => [r.status, r.body]);
  assert.deepEqual(await post({ ...signup, ride: 'nope' }), [400, { error: NOT_ON_WEBSITE }]);
  assert.deepEqual(await post({ ...signup, name: ' ' }), [400, { error: NO_SIGNUP_NAME }]);
  assert.deepEqual(await post({ ...signup, name: 'x'.repeat(81) }), [400, { error: LONG_SIGNUP_NAME }]);
  assert.deepEqual(await post({ ...signup, email: 'sam@example' }), [400, { error: BAD_SIGNUP_EMAIL }]);
  assert.deepEqual(await post({ ...signup, phone: '1'.repeat(31) }), [400, { error: LONG_SIGNUP_PHONE }]);
  assert.deepEqual(await post({ ...signup, riding: false }), [400, { error: NOTHING_PICKED }]);
  assert.deepEqual(await post({ ...signup, riding: false, pillion: true, job: 'BBQ' }), [400, { error: PILLION_NEEDS_RIDER }]);
  assert.deepEqual(await post({ ...signup, guests: 11 }), [400, { error: GUESTS_LIMITS }]);
  assert.deepEqual(await post({ ...signup, guests: '2' }), [400, { error: GUESTS_LIMITS }], 'a guests string is not a number');
  assert.deepEqual(await post({ ...signup, notes: 'x'.repeat(201) }), [400, { error: SIGNUP_TOO_LONG }]);
  assert.deepEqual(await post('not an object'), [400, { error: NOT_ON_WEBSITE }]);
  assert.equal(calls.signups.length, 0);
});

test('POST /charity-signup: honeypot, other origins, and what the database says', async () => {
  const { d, calls } = deps();
  const bot = await handleSiteApi({ method: 'POST', path: '/charity-signup', origin: ORIGIN, body: { ...signup, website: 'x' } }, d);
  assert.deepEqual([bot.status, bot.body], [200, { ok: true }]);
  const elsewhere = await handleSiteApi({ method: 'POST', path: '/charity-signup', origin: 'https://evil.example', body: signup }, d);
  assert.equal(elsewhere.status, 403);
  assert.equal(calls.signups.length, 0);
  const full = deps({ websiteSignup: async () => RIDE_FULL });
  assert.deepEqual(await handleSiteApi({ method: 'POST', path: '/charity-signup', origin: ORIGIN, body: signup }, full.d).then((r) => [r.status, r.body]), [400, { error: RIDE_FULL }]);
  const closed = deps({ websiteSignup: async () => SIGNUPS_CLOSED });
  assert.deepEqual(await handleSiteApi({ method: 'POST', path: '/charity-signup', origin: ORIGIN, body: signup }, closed.d).then((r) => [r.status, r.body]), [400, { error: SIGNUPS_CLOSED }]);
  const busy = deps({ websiteSignup: async () => TOO_MANY_SIGNUPS });
  assert.deepEqual(await handleSiteApi({ method: 'POST', path: '/charity-signup', origin: ORIGIN, body: signup }, busy.d).then((r) => [r.status, r.body]), [429, { error: TOO_MANY_SIGNUPS }]);
  const odd = deps({ websiteSignup: async () => 'permission denied for table website_signups' });
  const o = await handleSiteApi({ method: 'POST', path: '/charity-signup', origin: ORIGIN, body: signup }, odd.d);
  assert.equal(o.status, 503);
  assert.ok(String((o.body as { error: string }).error).includes('rustnutssmc@outlook.com'));
});
