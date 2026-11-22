import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEYS,
  startsNewVisit,
  USAGE_BATCH_MAX,
  USAGE_QUEUE_MAX,
  UsageQueue,
  errorKind,
  cleanUsageName,
  focusedRouteName,
  journeyCounts,
  screenLabel,
  screenTable,
  type UsageVisit,
} from './appUsage';

test('cleanUsageName keeps route names and drops anything else', () => {
  assert.equal(cleanUsageName('Home'), 'Home');
  assert.equal(cleanUsageName('ShopCheckout'), 'ShopCheckout');
  assert.equal(cleanUsageName('  Rides '), 'Rides');
  assert.equal(cleanUsageName(''), null);
  assert.equal(cleanUsageName('home page'), null, 'space');
  assert.equal(cleanUsageName('a'.repeat(61)), null, 'too long');
  assert.equal(cleanUsageName('9Lives'), null, 'starts with a digit');
});

test('errorKind keeps only what sort of error it was, never the words', () => {
  assert.equal(errorKind('Couldn’t load rides. Check your connection.'), 'connection');
  assert.equal(errorKind('You’re offline'), 'connection');
  assert.equal(errorKind('Network request failed'), 'connection');
  assert.equal(errorKind('Only the board can see app usage.'), 'not-allowed');
  assert.equal(errorKind('You can’t do that.'), 'not-allowed');
  assert.equal(errorKind('Check the fields marked in red.'), 'form');
  assert.equal(errorKind('Fill in your road name'), 'form');
  assert.equal(errorKind('No from Dave Smith'), 'other');
  assert.equal(errorKind('   '), null);
});

test('focusedRouteName finds the deepest screen in nested navigators', () => {
  assert.equal(focusedRouteName(undefined), null);
  assert.equal(focusedRouteName({ index: 0, routes: [{ name: 'Welcome' }] }), 'Welcome');
  const nested = {
    index: 1,
    routes: [
      { name: 'Tabs', state: { index: 0, routes: [{ name: 'Home' }] } },
      { name: 'Tabs2', state: { index: 2, routes: [{ name: 'Home' }, { name: 'Chats' }, { name: 'Rides' }] } },
    ],
  };
  assert.equal(focusedRouteName(nested), 'Rides');
  // A tab navigator that hasn't built its state yet: the tab route itself.
  assert.equal(focusedRouteName({ index: 0, routes: [{ name: 'Tabs' }] }), 'Tabs');
});

test('UsageQueue numbers events, skips repeats of the same screen, and caps its size', () => {
  const q = new UsageQueue();
  q.screen('Home');
  q.screen('Home'); // a re-render of the same screen isn't a new view
  q.screen('Rides');
  q.error('Rides', 'Couldn’t load rides. Check your connection.');
  q.screen('Home');
  const batch = q.take();
  assert.deepEqual(batch, [
    { seq: 1, kind: 'screen', name: 'Home', detail: null },
    { seq: 2, kind: 'screen', name: 'Rides', detail: null },
    { seq: 3, kind: 'error', name: 'Rides', detail: 'connection' },
    { seq: 4, kind: 'screen', name: 'Home', detail: null },
  ]);
  assert.deepEqual(q.take(), [], 'taken events leave the queue');
  for (let i = 0; i < USAGE_QUEUE_MAX + 50; i++) q.screen(i % 2 ? 'Home' : 'Rides');
  assert.equal(q.size, USAGE_QUEUE_MAX, 'the oldest drop off past the cap');
  assert.equal(q.take().length, USAGE_BATCH_MAX);
});

test('UsageQueue drops the same error repeated on the same screen and junk names', () => {
  const q = new UsageQueue();
  q.error('Rides', 'Offline');
  q.error('Rides', 'Offline');
  q.screen('not a route');
  q.error('Rides', '  ');
  assert.equal(q.take().length, 1);
});

test('UsageQueue clear forgets the last screen, so it counts again when switched back on', () => {
  const q = new UsageQueue();
  q.screen('Home');
  q.clear();
  q.screen('Home');
  assert.equal(q.size, 1);
});

test('UsageQueue records nothing while switched off', () => {
  const q = new UsageQueue();
  q.enabled = false;
  q.screen('Home');
  q.error('Home', 'x');
  assert.equal(q.size, 0);
});

const visits: UsageVisit[] = [
  { screens: ['Welcome', 'SignIn', 'Home', 'Rides', 'RideDetail'] },
  { screens: ['Welcome', 'SignIn'] },
  { screens: ['Home', 'Shop', 'ShopCart', 'ShopCheckout', 'ShopOrder'] },
  { screens: ['Home', 'Shop', 'ShopCart'] },
  { screens: ['Home', 'Shop', 'ShopCart', 'ShopCheckout'] },
  { screens: ['Welcome', 'Join'] },
];

test('screenTable counts views, visits and visits that ended there', () => {
  const t = screenTable(visits);
  const home = t.find((r) => r.name === 'Home')!;
  assert.deepEqual(home, { name: 'Home', views: 4, visits: 4, endedHere: 0 });
  const cart = t.find((r) => r.name === 'ShopCart')!;
  assert.deepEqual(cart, { name: 'ShopCart', views: 3, visits: 3, endedHere: 1 });
  assert.equal(t[0].name, 'Home', 'busiest first');
  assert.equal(screenTable([]).length, 0);
});

test('journeyCounts follows each journey in order within a visit', () => {
  const counts = journeyCounts(visits);
  const shop = counts.find((j) => j.id === 'shop')!;
  assert.deepEqual(shop.steps, [
    { name: 'ShopCart', visits: 3 },
    { name: 'ShopCheckout', visits: 2 },
    { name: 'ShopOrder', visits: 1 },
  ]);
  assert.equal(shop.finished, 1);
  assert.equal(shop.started, 3);
  const signIn = counts.find((j) => j.id === 'sign-in')!;
  assert.equal(signIn.started, 2);
  assert.equal(signIn.finished, 1);
  const join = counts.find((j) => j.id === 'join')!;
  assert.equal(join.started, 1);
  assert.equal(join.finished, 0);
});

test('journeyCounts needs the steps in order: a later step seen first does not count', () => {
  const [shop] = journeyCounts([{ screens: ['ShopCheckout', 'ShopCart'] }]).filter((j) => j.id === 'shop');
  assert.equal(shop.started, 1);
  assert.equal(shop.steps[1].visits, 0);
});

test('screenLabel reads route names as words', () => {
  assert.equal(screenLabel('ShopCheckout'), 'Shop checkout');
  assert.equal(screenLabel('Home'), 'Home');
  assert.equal(screenLabel('Chat'), 'A chat');
  assert.equal(screenLabel('Chats'), 'Chat list');
});

test('every journey step is a real route name', () => {
  for (const j of JOURNEYS) {
    assert.ok(j.steps.length >= 2, j.id);
    for (const s of j.steps) assert.equal(cleanUsageName(s), s);
  }
});

// Weekly note, 22 Nov 2026: 3 visits reached Sign in and none reached Home. Signing in used to start a new
// visit (to keep two people on one phone apart), so the Sign in → Home journey could never finish in one
// visit. A visit now carries on from signed out into signing in, and only a sign-out or a switch of
// person starts a new one.
test('signing in carries the visit on; signing out or switching person starts a new one', () => {
  // The first argument is the last person signed in this visit (null if nobody yet).
  assert.equal(startsNewVisit(null, 'm-1'), false, 'signing in');
  assert.equal(startsNewVisit(null, 'applying'), false, 'asking to join');
  assert.equal(startsNewVisit(null, 'load-error'), false, 'a load error');
  assert.equal(startsNewVisit('m-1', 'load-error'), false, 'a load error is not a sign-out');
  assert.equal(startsNewVisit('m-1', 'm-1'), false, 'same person, after a load error');
  assert.equal(startsNewVisit('m-1', 'signed-out'), true, 'signing out');
  assert.equal(startsNewVisit('m-1', 'applying'), true, 'signed out, then a new email asks to join');
  assert.equal(startsNewVisit('m-1', 'm-2'), true, 'someone else');
});
