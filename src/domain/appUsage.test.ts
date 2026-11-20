import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEYS,
  USAGE_BATCH_MAX,
  USAGE_QUEUE_MAX,
  UsageQueue,
  cleanErrorDetail,
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

test('cleanErrorDetail cuts to 120 characters and blanks out emails and long numbers', () => {
  assert.equal(cleanErrorDetail('Couldn’t save the ride.'), 'Couldn’t save the ride.');
  assert.equal(cleanErrorDetail('No member with jeff@example.com'), 'No member with [email]');
  assert.equal(cleanErrorDetail('Call 0412 345 678 now'), 'Call [number] now');
  assert.equal(cleanErrorDetail('Ref 123456789'), 'Ref [number]');
  assert.equal(cleanErrorDetail('Pick 1 of 3'), 'Pick 1 of 3', 'short numbers stay');
  assert.equal(cleanErrorDetail('x'.repeat(200)).length, 120);
  assert.equal(cleanErrorDetail('   '), null);
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
  q.error('Rides', 'Couldn’t load rides.');
  q.screen('Home');
  const batch = q.take();
  assert.deepEqual(batch, [
    { seq: 1, kind: 'screen', name: 'Home', detail: null },
    { seq: 2, kind: 'screen', name: 'Rides', detail: null },
    { seq: 3, kind: 'error', name: 'Rides', detail: 'Couldn’t load rides.' },
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
