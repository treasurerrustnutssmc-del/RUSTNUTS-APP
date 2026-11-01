import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanVisitPage, pageLabel, topPages, visitTotals, type VisitRow } from './siteVisits';

test('cleanVisitPage keeps site paths and drops the rest', () => {
  assert.equal(cleanVisitPage('/'), '/');
  assert.equal(cleanVisitPage(''), '/');
  assert.equal(cleanVisitPage('/index.html'), '/');
  assert.equal(cleanVisitPage('/charity.html'), '/charity.html');
  assert.equal(cleanVisitPage('/app/privacy.html'), '/app/privacy.html');
  assert.equal(cleanVisitPage('get-the-app'), '/get-the-app');
  assert.equal(cleanVisitPage('/Charity.html'), null, 'upper case');
  assert.equal(cleanVisitPage('/a b'), null, 'space');
  assert.equal(cleanVisitPage('/x?y=1'), null, 'query');
  assert.equal(cleanVisitPage('/' + 'a'.repeat(80)), null, 'too long');
  assert.equal(cleanVisitPage('https://evil.example/'), null);
});

const rows: VisitRow[] = [
  { day: '2026-11-01', page: '/', hits: 40 },
  { day: '2026-11-01', page: '/charity.html', hits: 5 },
  { day: '2026-10-27', page: '/', hits: 10 },
  { day: '2026-10-20', page: '/shop.html', hits: 7 },
  { day: '2026-10-01', page: '/', hits: 100 },
];

test('visitTotals counts the last 7 and 30 days up to today, today included', () => {
  assert.deepEqual(visitTotals(rows, '2026-11-01'), { week: 55, month: 62 });
  assert.deepEqual(visitTotals([], '2026-11-01'), { week: 0, month: 0 });
});

test('topPages adds up the last 30 days by page, biggest first, five at most', () => {
  assert.deepEqual(topPages(rows, '2026-11-01'), [
    { page: '/', hits: 50 },
    { page: '/shop.html', hits: 7 },
    { page: '/charity.html', hits: 5 },
  ]);
  const many = Array.from({ length: 8 }, (_, i) => ({ day: '2026-11-01', page: `/p${i}.html`, hits: i + 1 }));
  assert.equal(topPages(many, '2026-11-01').length, 5);
});

test('pageLabel names the club pages in plain words', () => {
  assert.equal(pageLabel('/'), 'Home');
  assert.equal(pageLabel('/charity.html'), 'Charity Rides');
  assert.equal(pageLabel('/app/privacy.html'), 'Privacy policy');
  assert.equal(pageLabel('/get-the-app'), 'Get the app taps');
  assert.equal(pageLabel('/something-else.html'), '/something-else.html');
});
