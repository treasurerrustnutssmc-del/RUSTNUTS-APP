// Jeff, 21 Nov 2026: "simplify the other pages", Board first. The admin rows (Club documents, the
// Auditor, Conduct, Merch, National) are one card instead of three, and the long Website and app
// group (enquiry cards, the news form, visits, feedback, usage) is one row that opens its own page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');
const board = read('board.tsx');
const screen = board.slice(board.indexOf('export function BoardScreen'), board.indexOf('function BoardRequest'));

test('the admin rows share one card', () => {
  const card = screen.slice(screen.indexOf('{/* Club admin'), screen.indexOf('{groups.map'));
  for (const row of ['<DocumentsBoardRow', '<BoardAuditRow bare', '<BoardAdminCard bare', '<WebsiteAppRow']) assert.ok(card.includes(row), row);
  assert.equal(card.match(/<Card/g)?.length, 1, 'one card');
});

test('the Website and app sections live on their own page, not inline on Board', () => {
  for (const s of ['<WebsiteEnquiries', '<WebsiteNews', '<WebsiteVisits', '<AppFeedbackSection', '<AppUsage']) {
    assert.ok(!screen.includes(s), `${s} is off the Board page`);
  }
  const page = read('websiteApp.tsx');
  for (const s of ['<WebsiteEnquiries', '<WebsiteNews', '<WebsiteVisits', '<AppFeedbackSection', '<AppUsage']) assert.ok(page.includes(s), s);
  const nav = fs.readFileSync(path.resolve(import.meta.dirname, '../navigation/RootNavigator.tsx'), 'utf8');
  assert.match(nav, /name="WebsiteApp" component=\{WebsiteAppScreen\}/);
});

test('the Website and app row says how many enquiries are waiting', () => {
  const page = read('websiteApp.tsx');
  const row = page.slice(page.indexOf('export function WebsiteAppRow'));
  assert.match(row, /useEnquiries\(\)/);
  assert.match(row, /waiting/);
});
