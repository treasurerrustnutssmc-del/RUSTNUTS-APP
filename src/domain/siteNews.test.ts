import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_NEWS_LINK,
  LONG_NEWS_BODY,
  LONG_NEWS_TITLE,
  NEWS_DAYS,
  NEWS_GONE,
  NEWS_REMOVED_ALREADY,
  NO_NEWS_BODY,
  NO_NEWS_TITLE,
  NOT_NEWS_POSTER,
  boardNewsOrder,
  cleanNews,
  newsProblem,
  publicNews,
  removeNewsProblem,
  type SiteNews,
} from './siteNews';
import type { Member, Position } from './types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west',
  fullName: m.id,
  roadName: null,
  status: 'full',
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  phone: null,
  sharePhone: false,
  bikes: [],
  ...m,
} as Member);
const seat = (memberId: string, role: Position['role'], chapterId: string | null = 'ch-west'): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});
const pres = member({ id: 'pres' });
const nell = member({ id: 'nell' });
const pending = member({ id: 'pending', approval: 'pending' });
const positions = [seat('pres', 'president')];

const notice = (n: Partial<SiteNews> & Pick<SiteNews, 'id' | 'createdAt'>): SiteNews => ({
  title: `Notice ${n.id}`,
  body: 'Some words.',
  link: null,
  postedBy: 'pres',
  removedAt: null,
  ...n,
});
const input = { title: 'Toy run', body: 'Sunday 7 December, meet at the clubhouse 9am.', link: '' };

test('newsProblem checks in order with the shared words', () => {
  assert.equal(newsProblem(null, positions, input), 'Sign in first.');
  assert.equal(newsProblem(pending, positions, input), 'Only approved members can do that.');
  assert.equal(newsProblem(nell, positions, input), NOT_NEWS_POSTER);
  assert.equal(newsProblem(pres, positions, { ...input, title: '  ' }), NO_NEWS_TITLE);
  assert.equal(newsProblem(pres, positions, { ...input, title: 'x'.repeat(81) }), LONG_NEWS_TITLE);
  assert.equal(newsProblem(pres, positions, { ...input, body: '' }), NO_NEWS_BODY);
  assert.equal(newsProblem(pres, positions, { ...input, body: 'x'.repeat(401) }), LONG_NEWS_BODY);
  assert.equal(newsProblem(pres, positions, { ...input, link: 'http://rustnutssmc.com.au' }), BAD_NEWS_LINK);
  assert.equal(newsProblem(pres, positions, { ...input, link: 'https://' + 'x'.repeat(300) }), BAD_NEWS_LINK);
  assert.equal(newsProblem(pres, positions, { ...input, link: 'https://www.rustnutssmc.com.au/charity.html' }), null);
  assert.equal(newsProblem(pres, positions, input), null);
});

test('a national seat may post', () => {
  assert.equal(newsProblem(member({ id: 'chair' }), [seat('chair', 'nec_chair', null)], input), null);
});

test('cleanNews trims and keeps an empty link as null', () => {
  assert.deepEqual(cleanNews({ title: ' Toy run ', body: ' Words. ', link: ' ' }), { title: 'Toy run', body: 'Words.', link: null });
  assert.deepEqual(cleanNews({ ...input, link: ' https://a.b/c ' }).link, 'https://a.b/c');
});

test('removeNewsProblem refuses in order', () => {
  const live = notice({ id: 'a', createdAt: '2026-11-01T00:00:00Z' });
  assert.equal(removeNewsProblem(null, positions, live), 'Sign in first.');
  assert.equal(removeNewsProblem(nell, positions, live), NOT_NEWS_POSTER);
  assert.equal(removeNewsProblem(pres, positions, null), NEWS_GONE);
  assert.equal(removeNewsProblem(pres, positions, { ...live, removedAt: '2026-11-02T00:00:00Z' }), NEWS_REMOVED_ALREADY);
  assert.equal(removeNewsProblem(pres, positions, live), null);
});

test('publicNews: newest five live notices under 60 days, with nothing personal', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const list: SiteNews[] = [
    notice({ id: 'old', createdAt: '2026-09-01T00:00:00Z' }),
    notice({ id: 'edge', createdAt: new Date(now.getTime() - NEWS_DAYS * 86400000).toISOString() }),
    notice({ id: 'gone', createdAt: '2026-10-30T00:00:00Z', removedAt: '2026-10-31T00:00:00Z' }),
    ...[1, 2, 3, 4, 5, 6].map((i) => notice({ id: `n${i}`, createdAt: `2026-10-${10 + i}T00:00:00Z`, link: i === 1 ? 'https://x.y' : null })),
  ];
  const shown = publicNews(list, now);
  assert.deepEqual(shown.map((n) => n.id), ['n6', 'n5', 'n4', 'n3', 'n2']);
  assert.deepEqual(Object.keys(shown[0]).sort(), ['body', 'created_at', 'id', 'link', 'title']);
  assert.equal(publicNews([notice({ id: 'fresh', createdAt: '2026-11-01T00:00:00Z' })], now).length, 1);
});

test('boardNewsOrder: live newest first, then taken down', () => {
  const list = [
    notice({ id: 'gone', createdAt: '2026-10-30T00:00:00Z', removedAt: '2026-10-31T00:00:00Z' }),
    notice({ id: 'older', createdAt: '2026-10-01T00:00:00Z' }),
    notice({ id: 'newer', createdAt: '2026-10-20T00:00:00Z' }),
  ];
  assert.deepEqual(boardNewsOrder(list).map((n) => n.id), ['newer', 'older', 'gone']);
});
