import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_KIND,
  BAD_PHOTO,
  BAD_PRICE,
  LISTING_GONE,
  LISTING_TAKEN_DOWN,
  NOT_SELLER,
  NOT_SELLER_OR_BOARD,
  NO_TITLE,
  TAKEN_DOWN_ALREADY,
  TOO_MANY_PHOTOS,
  cleanListing,
  listingProblem,
  listingsFor,
  priceLabel,
  soldProblem,
  takeDownProblem,
  type Listing,
  type ListingInput,
} from './swap';
import type { Member, Position } from '../types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west',
  fullName: m.id,
  roadName: null,
  status: 'full',
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  bio: null,
  sharePhone: false,
  appliedOn: null,
  onHiatus: false,
  ...m,
});

const me = member({ id: 'me' });
const other = member({ id: 'other' });
const president: Position = { id: 'p1', memberId: 'boss', role: 'president', chapterId: 'ch-west', startedOn: '2025-01-01', endedOn: null } as Position;
const boss = member({ id: 'boss' });

const listing = (l: Partial<Listing> & Pick<Listing, 'id' | 'sellerId'>): Listing => ({
  kind: 'sell',
  title: 'Panniers',
  priceDollars: 150,
  details: null,
  photos: [],
  listedAt: '2026-10-20T01:00:00Z',
  soldAt: null,
  takenDownAt: null,
  ...l,
});

const input = (i: Partial<ListingInput> = {}): ListingInput => ({
  id: null,
  kind: 'sell',
  title: 'Panniers',
  priceDollars: 150,
  details: '',
  photos: [],
  ...i,
});

test('a good listing passes, and is stored trimmed with blanks as none', () => {
  assert.equal(listingProblem(me, input({ title: '  Panniers  ' }), []), null);
  assert.deepEqual(cleanListing(input({ title: ' Panniers ', details: '  ' })), {
    kind: 'sell',
    title: 'Panniers',
    priceDollars: 150,
    details: null,
    photos: [],
  });
});

test('only sales carry a price; anything sent with the others is dropped', () => {
  assert.equal(cleanListing(input({ kind: 'swap', priceDollars: 40 })).priceDollars, null);
  assert.equal(cleanListing(input({ kind: 'free', priceDollars: 40 })).priceDollars, null);
  assert.equal(cleanListing(input({ kind: 'wanted', priceDollars: 40 })).priceDollars, null);
  assert.equal(listingProblem(me, input({ kind: 'wanted', priceDollars: null }), []), null);
});

test('refusals, in the database order', () => {
  assert.equal(listingProblem(null, input(), []), 'Sign in first.');
  assert.equal(listingProblem(member({ id: 'p', approval: 'pending' }), input(), []), 'Only approved members can do that.');
  assert.equal(listingProblem(me, input({ kind: 'raffle' as never }), []), BAD_KIND);
  assert.equal(listingProblem(me, input({ title: '   ' }), []), NO_TITLE);
  assert.equal(listingProblem(me, input({ title: 'x'.repeat(81) }), []), 'Keep the title to 80 characters at most.');
  assert.equal(listingProblem(me, input({ title: 'x'.repeat(80) }), []), null);
  assert.equal(listingProblem(me, input({ priceDollars: null }), []), BAD_PRICE);
  assert.equal(listingProblem(me, input({ priceDollars: 0 }), []), BAD_PRICE);
  assert.equal(listingProblem(me, input({ priceDollars: 12.5 }), []), BAD_PRICE);
  assert.equal(listingProblem(me, input({ priceDollars: 100_001 }), []), BAD_PRICE);
  assert.equal(listingProblem(me, input({ priceDollars: 100_000 }), []), null);
  assert.equal(listingProblem(me, input({ details: 'd'.repeat(1001) }), []), 'Keep the details to 1,000 characters at most.');
  const seven = Array.from({ length: 7 }, (_, i) => ({ path: `me/${i}.jpg`, width: 1, height: 1 }));
  assert.equal(listingProblem(me, input({ photos: seven }), []), TOO_MANY_PHOTOS);
  // The kind is checked before the title, the title before the price.
  assert.equal(listingProblem(me, input({ kind: 'x' as never, title: '' }), []), BAD_KIND);
  assert.equal(listingProblem(me, input({ title: '', priceDollars: null }), []), NO_TITLE);
});

test('photos: in your own folder, not used by another listing, not twice', () => {
  const photo = (path: string) => ({ path, width: 800, height: 600 });
  assert.equal(listingProblem(me, input({ photos: [photo('me/a.jpg'), photo('me/b.jpg')] }), []), null);
  assert.equal(listingProblem(me, input({ photos: [photo('other/a.jpg')] }), []), BAD_PHOTO);
  assert.equal(listingProblem(me, input({ photos: [photo('me/a.jpg'), photo('me/a.jpg')] }), []), BAD_PHOTO);
  const used = [listing({ id: 'l1', sellerId: 'me', photos: [photo('me/a.jpg')] })];
  assert.equal(listingProblem(me, input({ photos: [photo('me/a.jpg')] }), used), BAD_PHOTO);
  // Keeping a listing's own photos when changing it is fine.
  assert.equal(listingProblem(me, input({ id: 'l1', photos: [photo('me/a.jpg')] }), used), null);
});

test('changing: it has to exist, be yours, and still be up', () => {
  const list = [listing({ id: 'l1', sellerId: 'other' }), listing({ id: 'l2', sellerId: 'me', takenDownAt: '2026-10-21T00:00:00Z' })];
  assert.equal(listingProblem(me, input({ id: 'nope' }), list), LISTING_GONE);
  assert.equal(listingProblem(me, input({ id: 'l1' }), list), NOT_SELLER);
  assert.equal(listingProblem(boss, input({ id: 'l1' }), list), NOT_SELLER);
  assert.equal(listingProblem(me, input({ id: 'l2' }), list), LISTING_TAKEN_DOWN);
  // These come before the field checks.
  assert.equal(listingProblem(me, input({ id: 'l1', title: '' }), list), NOT_SELLER);
});

test('marking sold: only the seller, while it is up', () => {
  const list = [listing({ id: 'l1', sellerId: 'me' }), listing({ id: 'l2', sellerId: 'me', takenDownAt: '2026-10-21T00:00:00Z' })];
  assert.equal(soldProblem(me, 'l1', list), null);
  assert.equal(soldProblem(other, 'l1', list), NOT_SELLER);
  assert.equal(soldProblem(me, 'nope', list), LISTING_GONE);
  assert.equal(soldProblem(me, 'l2', list), LISTING_TAKEN_DOWN);
  assert.equal(soldProblem(null, 'l1', list), 'Sign in first.');
});

test('taking down: the seller or the board, once', () => {
  const list = [listing({ id: 'l1', sellerId: 'me' }), listing({ id: 'l2', sellerId: 'me', takenDownAt: '2026-10-21T00:00:00Z' })];
  assert.equal(takeDownProblem(me, 'l1', list, []), null);
  assert.equal(takeDownProblem(boss, 'l1', list, [president]), null);
  assert.equal(takeDownProblem(other, 'l1', list, [president]), NOT_SELLER_OR_BOARD);
  assert.equal(takeDownProblem(me, 'l2', list, []), TAKEN_DOWN_ALREADY);
  assert.equal(takeDownProblem(me, 'nope', list, []), LISTING_GONE);
});

test('what a member sees: open ones newest first, sold in the last 30 days, never taken down, blocked or suspended', () => {
  const suspended = member({ id: 'sus', approval: 'suspended' });
  const blocked = member({ id: 'blk' });
  const members = [me, other, suspended, blocked];
  const list = [
    listing({ id: 'old', sellerId: 'other', listedAt: '2026-09-01T00:00:00Z' }),
    listing({ id: 'new', sellerId: 'me', listedAt: '2026-10-26T00:00:00Z' }),
    listing({ id: 'down', sellerId: 'other', takenDownAt: '2026-10-25T00:00:00Z' }),
    listing({ id: 'sus', sellerId: 'sus' }),
    listing({ id: 'blk', sellerId: 'blk' }),
    // Sold 27 September in Melbourne (30 days back): still shown.
    listing({ id: 'sold-edge', sellerId: 'other', soldAt: '2026-09-27T05:00:00Z' }),
    listing({ id: 'sold-old', sellerId: 'other', soldAt: '2026-09-26T05:00:00Z' }),
    listing({ id: 'sold-new', sellerId: 'other', soldAt: '2026-10-25T05:00:00Z' }),
  ];
  const seen = listingsFor(me, members, list, [{ blockerId: 'me', blockedId: 'blk' }], [], '2026-10-27');
  assert.deepEqual(seen.open.map((l) => l.id), ['new', 'old']);
  assert.deepEqual(seen.sold.map((l) => l.id), ['sold-new', 'sold-edge']);
  assert.deepEqual(listingsFor(null, members, list, [], [], '2026-10-27'), { open: [], sold: [] });
  assert.deepEqual(listingsFor(member({ id: 'p', approval: 'pending' }), members, list, [], [], '2026-10-27'), { open: [], sold: [] });
});

test('a filter keeps one kind', () => {
  const list = [listing({ id: 'a', sellerId: 'me' }), listing({ id: 'b', sellerId: 'me', kind: 'wanted', priceDollars: null })];
  assert.deepEqual(listingsFor(me, [me], list, [], [], '2026-10-27', 'wanted').open.map((l) => l.id), ['b']);
});

test('price labels', () => {
  assert.equal(priceLabel(listing({ id: 'a', sellerId: 'me', priceDollars: 1250 })), '$1,250');
  assert.equal(priceLabel(listing({ id: 'a', sellerId: 'me', kind: 'swap', priceDollars: null })), 'Swap');
  assert.equal(priceLabel(listing({ id: 'a', sellerId: 'me', kind: 'free', priceDollars: null })), 'Free');
  assert.equal(priceLabel(listing({ id: 'a', sellerId: 'me', kind: 'wanted', priceDollars: null })), 'Wanted');
});
