/**
 * The club gallery: photos and videos members add straight to Photos (not through a chat), filed
 * under a ride or "Club life". The member who adds them can tick "OK for the website"; the Social
 * Media Officer, their crew or the NEC then approve them onto the public website (Jeff's design
 * tap, 24 Nov 2026). The database mirrors these rules (supabase/migrations/*_gallery.sql) in the
 * same order with the same words; change both together.
 * Spec: docs/superpowers/specs/2026-11-23-club-gallery-design.md
 */
import { addDays } from './dates';
import { melbourneDate } from './rides';
import { signedInProblem } from './routes';
import { CAPTION_MAX, isSitePhotoEditor, LONG_CAPTION, NOT_PHOTO_EDITOR, type SitePhotoCrew } from './sitePhotos';
import type { Member, Position, Ride } from './types';

/** Most photos and videos added in one go (the same as a chat message). */
export const GALLERY_MAX = 10;
/** How far back a ride can still take photos in the album picker. */
export const ALBUM_DAYS = 30;
export const CLUB_LIFE = 'Club life';
/** Where gallery files sit in the chat-media bucket: gallery/<member id>/<file>. */
export const GALLERY_FOLDER = 'gallery';

export const NO_FILES = 'Pick at least one photo or video.';
export const TOO_MANY = 'Up to 10 photos or videos at a time.';
export const NO_SUCH_RIDE = 'No such ride.';
export const WEBSITE_NEEDS_CONSENT = 'Tick that everyone in them is happy to be on the website.';
export const BAD_GALLERY_UPLOAD = 'That file didn’t upload properly. Try again.';
export const GALLERY_GONE = 'No such photo or video.';
export const NOT_GALLERY_REMOVER = 'Only the member who added it or the website photo crew can take it down.';
export const GALLERY_REMOVED_ALREADY = 'That has already been taken down.';
export const NOT_WAITING = 'That one isn’t waiting for the website any more.';
/** The consent line beside "OK for the website". */
export const GALLERY_CONSENT_LINE = 'Everyone in these is happy for them to be on the club website.';

/** A photo or video added straight to the gallery. */
export interface GalleryItem {
  id: string;
  uploadedBy: string | null;
  rideId: string | null;
  kind: 'photo' | 'video';
  path: string;
  posterPath: string | null;
  width: number;
  height: number;
  durationMs: number | null;
  caption: string | null;
  /** The uploader ticked "OK for the website". */
  websiteOk: boolean;
  websiteDeclinedAt: string | null;
  /** It has been on the website list (live or since taken down). */
  onWebsite: boolean;
  createdAt: string;
  removedAt: string | null;
  /** The album's name as the database gives it (the ride may be older than the app has loaded). */
  albumTitle?: string | null;
}

/** What the Add to the gallery form sends (the files go separately). */
export interface GalleryInput {
  rideId: string | null;
  caption: string;
  websiteOk: boolean;
  consent: boolean;
  /** How many files are picked. */
  count: number;
}

/** Approved members who aren't Family. Mirrors private.is_approved_member. */
export function canAddToGallery(me: Member | null): boolean {
  return !!me && me.approval === 'approved' && me.status !== 'family';
}

function approvedProblem(me: Member | null): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!canAddToGallery(me)) return 'Only approved members can do that.';
  return null;
}

/** A ride the gallery can file under (from the app's rides or the database's album list). */
export type Album = Pick<Ride, 'id' | 'title' | 'startsAt' | 'cancelledAt'>;

/**
 * Why `me` can't add these, or null. Mirrors add_gallery_items (before the file checks). `rides` is
 * every ride the caller knows of; null when it can't know them all (the database then checks).
 */
export function addProblem(me: Member | null, input: GalleryInput, rides: { id: string }[] | null): string | null {
  const who = approvedProblem(me);
  if (who) return who;
  if (input.count < 1) return NO_FILES;
  if (input.count > GALLERY_MAX) return TOO_MANY;
  if (input.rideId !== null && rides !== null && !rides.some((r) => r.id === input.rideId)) return NO_SUCH_RIDE;
  if (input.caption.trim().length > CAPTION_MAX) return LONG_CAPTION;
  if (input.websiteOk && !input.consent) return WEBSITE_NEEDS_CONSENT;
  return null;
}

/** Why `me` can't take this down, or null. Mirrors remove_gallery_item. */
export function removeProblem(me: Member | null, positions: Position[], crew: SitePhotoCrew[], item: GalleryItem | undefined): string | null {
  const who = approvedProblem(me);
  if (who) return who;
  if (!item) return GALLERY_GONE;
  if (item.uploadedBy !== me!.id && !isSitePhotoEditor(me, positions, crew)) return NOT_GALLERY_REMOVER;
  if (item.removedAt) return GALLERY_REMOVED_ALREADY;
  return null;
}

/** It's waiting for an editor's yes: ticked, not declined, never on the website list. */
export const waitsForWebsite = (item: GalleryItem) => item.websiteOk && !item.websiteDeclinedAt && !item.onWebsite && !item.removedAt;

/** Why `me` can't approve (or decline) this for the website, or null. Mirrors approve_gallery_for_site. */
export function approveProblem(me: Member | null, positions: Position[], crew: SitePhotoCrew[], item: GalleryItem | undefined, caption: string): string | null {
  const who = approvedProblem(me);
  if (who) return who;
  if (!isSitePhotoEditor(me, positions, crew)) return NOT_PHOTO_EDITOR;
  if (!item || item.removedAt) return GALLERY_GONE;
  if (!waitsForWebsite(item)) return NOT_WAITING;
  if (caption.trim().length > CAPTION_MAX) return LONG_CAPTION;
  return null;
}

/** Rides the Add form offers as albums: started in the last ALBUM_DAYS days up to today, newest first. */
export function albumChoices<T extends Album>(rides: T[], today: string): T[] {
  const from = addDays(today, -ALBUM_DAYS);
  return rides
    .filter((r) => !r.cancelledAt)
    .filter((r) => {
      const d = melbourneDate(r.startsAt);
      return d >= from && d <= today;
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id));
}

/** The album's name: the ride's title, or Club life. */
export function albumLabel(rideId: string | null, rides: Ride[]): string {
  return (rideId && rides.find((r) => r.id === rideId)?.title) || CLUB_LIFE;
}
