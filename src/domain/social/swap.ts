// Swap and sell: members' listings of parts and gear. The database's save_listing,
// mark_listing_sold and take_down_listing apply the same checks with the same words, in the same
// order.

import { canSeeMember } from '../access';
import type { Block } from '../chat';
import { addDays } from '../dates';
import { melbourneDate } from '../rides';
import { signedInProblem } from '../routes';
import type { Member, Position } from '../types';
import { isAnyBoard } from './help';

export const LISTING_KINDS = ['sell', 'swap', 'free', 'wanted'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

const KIND_LABELS: Record<ListingKind, string> = { sell: 'For sale', swap: 'Swap', free: 'Free', wanted: 'Wanted' };
export const kindLabel = (k: ListingKind) => KIND_LABELS[k];

export const MAX_TITLE = 80;
export const MAX_DETAILS = 1000;
export const MAX_PRICE = 100_000;
export const MAX_LISTING_PHOTOS = 6;
/** How long a sold listing stays on show, in days. */
export const SOLD_SHOWN_DAYS = 30;

export const BAD_KIND = 'Pick what kind of listing it is.';
export const NO_TITLE = 'Give it a title.';
export const BAD_PRICE = 'Put a price on it, in whole dollars.';
export const TOO_MANY_PHOTOS = 'Up to 6 photos.';
export const BAD_PHOTO = 'That photo didn’t upload properly. Try again.';
export const LISTING_GONE = 'No such listing.';
export const NOT_SELLER = 'Only whoever listed it can change it.';
export const NOT_SELLER_OR_BOARD = 'Only whoever listed it or the board can take it down.';
export const LISTING_TAKEN_DOWN = 'That listing has been taken down.';
export const TAKEN_DOWN_ALREADY = 'That listing has already been taken down.';

export interface ListingPhoto {
  /** Inside the swap-media bucket, in the seller's own folder: `<seller id>/<name>`. */
  path: string;
  width: number;
  height: number;
}

export interface Listing {
  id: string;
  sellerId: string;
  kind: ListingKind;
  title: string;
  /** Whole dollars, for sales only. */
  priceDollars: number | null;
  details: string | null;
  /** In the order the seller put them; the first is the cover. */
  photos: ListingPhoto[];
  listedAt: string;
  soldAt: string | null;
  takenDownAt: string | null;
}

export interface ListingInput {
  /** null adds a new listing. */
  id: string | null;
  kind: ListingKind;
  title: string;
  priceDollars: number | null;
  details: string;
  photos: ListingPhoto[];
}

const chars = (s: string) => [...s].length;

/** The listing as stored: trimmed, blank details as none, a price only on a sale. */
export function cleanListing(input: ListingInput) {
  const details = input.details.trim();
  return {
    kind: input.kind,
    title: input.title.trim(),
    priceDollars: input.kind === 'sell' ? input.priceDollars : null,
    details: details === '' ? null : details,
    photos: input.photos,
  };
}

/** Only the seller changes a listing, board or not (the board can take it down). */
export function listingProblem(me: Member | null, input: ListingInput, listings: Listing[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const self = me as Member;
  if (input.id !== null) {
    const l = listings.find((x) => x.id === input.id);
    if (!l) return LISTING_GONE;
    if (l.sellerId !== self.id) return NOT_SELLER;
    if (l.takenDownAt) return LISTING_TAKEN_DOWN;
  }
  if (!(LISTING_KINDS as readonly string[]).includes(input.kind)) return BAD_KIND;
  const clean = cleanListing(input);
  if (clean.title === '') return NO_TITLE;
  if (chars(clean.title) > MAX_TITLE) return `Keep the title to ${MAX_TITLE} characters at most.`;
  if (clean.kind === 'sell') {
    const p = clean.priceDollars;
    if (p === null || !Number.isInteger(p) || p < 1 || p > MAX_PRICE) return BAD_PRICE;
  }
  if (clean.details !== null && chars(clean.details) > MAX_DETAILS) return 'Keep the details to 1,000 characters at most.';
  if (input.photos.length > MAX_LISTING_PHOTOS) return TOO_MANY_PHOTOS;
  const usedElsewhere = new Set(listings.filter((l) => l.id !== input.id).flatMap((l) => l.photos.map((p) => p.path)));
  const seen = new Set<string>();
  for (const p of input.photos) {
    if (p.path.split('/')[0] !== self.id || usedElsewhere.has(p.path) || seen.has(p.path)) return BAD_PHOTO;
    seen.add(p.path);
  }
  return null;
}

export function soldProblem(me: Member | null, id: string, listings: Listing[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const l = listings.find((x) => x.id === id);
  if (!l) return LISTING_GONE;
  if (l.sellerId !== (me as Member).id) return NOT_SELLER;
  if (l.takenDownAt) return LISTING_TAKEN_DOWN;
  return null;
}

export function takeDownProblem(me: Member | null, id: string, listings: Listing[], positions: Position[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const l = listings.find((x) => x.id === id);
  if (!l) return LISTING_GONE;
  if (l.sellerId !== (me as Member).id && !isAnyBoard(me, positions)) return NOT_SELLER_OR_BOARD;
  if (l.takenDownAt) return TAKEN_DOWN_ALREADY;
  return null;
}

export const canTakeDown = (me: Member | null, l: Listing, positions: Position[]) =>
  !!me && me.approval === 'approved' && !l.takenDownAt && (l.sellerId === me.id || isAnyBoard(me, positions));

const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/**
 * What the viewer sees: listings up by approved sellers they can see and haven't blocked (or been
 * blocked by). Open ones newest first; sold ones from the last 30 days (Melbourne dates), most
 * recently sold first.
 */
export function listingsFor(
  viewer: Member | null,
  members: Member[],
  listings: Listing[],
  blocks: Block[],
  positions: Position[],
  today: string,
  kind: ListingKind | null = null,
): { open: Listing[]; sold: Listing[] } {
  if (!viewer || viewer.approval !== 'approved') return { open: [], sold: [] };
  const sellers = new Map(members.map((m) => [m.id, m]));
  const blocked = (id: string) =>
    blocks.some((b) => (b.blockerId === viewer.id && b.blockedId === id) || (b.blockerId === id && b.blockedId === viewer.id));
  const shown = listings.filter((l) => {
    const seller = sellers.get(l.sellerId);
    return (
      !l.takenDownAt &&
      (kind === null || l.kind === kind) &&
      !!seller &&
      seller.approval === 'approved' &&
      (seller.id === viewer.id || canSeeMember(viewer, seller, positions)) &&
      !blocked(seller.id)
    );
  });
  const since = addDays(today, -SOLD_SHOWN_DAYS);
  return {
    open: shown.filter((l) => !l.soldAt).sort((a, b) => newestFirst(a.listedAt, b.listedAt)),
    sold: shown
      .filter((l) => l.soldAt && melbourneDate(l.soldAt) >= since)
      .sort((a, b) => newestFirst(a.soldAt as string, b.soldAt as string)),
  };
}

/** "$1,250", "Swap", "Free" or "Wanted". */
export function priceLabel(l: Pick<Listing, 'kind' | 'priceDollars'>): string {
  if (l.kind === 'sell' && l.priceDollars !== null) return `$${l.priceDollars.toLocaleString('en-AU')}`;
  return kindLabel(l.kind);
}
