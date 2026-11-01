/**
 * Club photos on the public website (website-and-app task 23). The Social Media Officer, a crew
 * they approve, and the NEC put photos from the club's chats (or their phone) on the website. A
 * photo someone else posted waits for that member's OK. The database mirrors these rules
 * (supabase/migrations/*_site_photos.sql) in the same order with the same words; change both
 * together. Spec: docs/superpowers/specs/2026-11-02-website-photos-design.md
 */
import { activePositions, isNational } from './access';
import type { MessageMedia } from './chat';
import { signedInProblem } from './routes';
import type { Member, Position } from './types';

export const NOT_PHOTO_EDITOR = 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
export const NOT_CREW_MANAGER = 'Only the Social Media Officer or the NEC can change the website photo crew.';
export const PHOTO_GONE = 'No such photo.';
export const NOT_A_PHOTO = 'Only photos go on the website, not videos or GIFs.';
export const PRIVATE_PHOTO = 'Photos from private chats stay private.';
export const PHOTO_ALREADY_PICKED = 'That photo is already on the list.';
export const NO_CONSENT_TICK = 'Tick that everyone in the photo is happy to be on the website.';
export const LONG_CAPTION = 'Keep the caption to 120 characters.';
export const BAD_UPLOAD = 'That photo didn’t upload properly. Try again.';
export const NOT_YOUR_ASK = 'Only the member who posted the photo can answer.';
export const ASK_ANSWERED = 'That one has already been answered.';
export const NOT_PHOTO_REMOVER = 'Only the website photo crew or the member who posted it can take it down.';
export const PHOTO_REMOVED_ALREADY = 'That photo has already been taken down.';
export const CREW_NOT_MEMBER = 'Only approved members can join the crew.';
export const CREW_ON_HIATUS = 'Members on hiatus can’t join the crew.';
export const CREW_ALREADY = 'They’re already on the crew.';
export const NOT_ON_CREW = 'They’re not on the crew.';

export const CAPTION_MAX = 120;
/** How many photos the website shows at most. */
export const PHOTOS_SHOWN = 60;
/** The consent line on the pick form. */
export const CONSENT_LINE = 'Everyone in this photo is happy for it to be on the club website.';

export type SitePhotoStatus = 'waiting' | 'live' | 'declined' | 'removed';
export type SitePhotoSource = 'chat' | 'upload';

/** Someone the Social Media Officer put on the crew. */
export interface SitePhotoCrew {
  memberId: string;
  addedBy: string | null;
  addedAt: string;
}

/** A photo on the website list, as list_site_photos returns it to the app. */
export interface SitePhoto {
  id: string;
  source: SitePhotoSource;
  /** The chat photo's message_media row (source chat). */
  mediaId: string | null;
  bucket: 'chat-media' | 'site-media';
  path: string;
  width: number;
  height: number;
  caption: string | null;
  /** The member whose photo it is: the chat message's author, or the uploader. */
  postedBy: string | null;
  pickedBy: string | null;
  pickedAt: string;
  status: SitePhotoStatus;
  decidedAt: string | null;
  removedAt: string | null;
}

/** A photo as the website receives it: nothing personal. Column names as public_site_photos returns them. */
export interface PublicSitePhoto {
  id: string;
  bucket: string;
  path: string;
  width: number;
  height: number;
  caption: string | null;
  taken_at: string;
}

/** What the pick and upload forms send. */
export interface PhotoPickInput {
  caption: string;
  consent: boolean;
}

/** Holds the Social Media Officer seat in either chapter (an active position). */
export function isSocialMediaOfficer(me: Member | null, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return activePositions(me.id, positions).some((p) => p.role === 'social_media_officer');
}

/** The SMO or the NEC: who runs the crew. Mirrors private.manages_site_photo_crew. */
export function managesSitePhotoCrew(me: Member | null, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return isSocialMediaOfficer(me, positions) || isNational(me.id, positions);
}

/** The SMO, the NEC or a crew member: who puts photos up. Mirrors private.is_site_photo_editor. */
export function isSitePhotoEditor(me: Member | null, positions: Position[], crew: SitePhotoCrew[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return managesSitePhotoCrew(me, positions) || crew.some((c) => c.memberId === me.id);
}

/** The caption as stored: trimmed, empty kept as null. */
export function cleanCaption(raw: string): string | null {
  const caption = raw.trim();
  return caption ? caption : null;
}

function formProblem(input: PhotoPickInput): string | null {
  if (!input.consent) return NO_CONSENT_TICK;
  if (input.caption.trim().length > CAPTION_MAX) return LONG_CAPTION;
  return null;
}

/** A chat photo as the pick screen knows it: the media row plus where it came from. */
export interface PickablePhoto {
  media: MessageMedia;
  /** 'direct' for a private chat; anything else is a club chat. */
  chatKind: string;
  authorId: string;
}

/**
 * Why `me` can't put this chat photo on the website, or null when they can. Mirrors
 * pick_site_photo: signed in → approved → editor → exists → a photo → not private → not already
 * on the list → consent → caption.
 */
export function pickProblem(
  me: Member | null,
  positions: Position[],
  crew: SitePhotoCrew[],
  photo: PickablePhoto | undefined,
  list: SitePhoto[],
  input: PhotoPickInput,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!isSitePhotoEditor(me, positions, crew)) return NOT_PHOTO_EDITOR;
  if (!photo) return PHOTO_GONE;
  if (photo.media.kind !== 'photo') return NOT_A_PHOTO;
  if (photo.chatKind === 'direct') return PRIVATE_PHOTO;
  if (list.some((p) => p.mediaId === photo.media.id && p.status !== 'removed')) return PHOTO_ALREADY_PICKED;
  return formProblem(input);
}

/** Whether a pick of this chat photo goes live at once (my own) or waits for the poster's OK. */
export function pickGoesLive(me: Member, photo: PickablePhoto): boolean {
  return photo.authorId === me.id;
}

/** Why `me` can't put a photo from their phone up, or null when they can. Mirrors upload_site_photo (before the file check). */
export function uploadProblem(me: Member | null, positions: Position[], crew: SitePhotoCrew[], input: PhotoPickInput): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!isSitePhotoEditor(me, positions, crew)) return NOT_PHOTO_EDITOR;
  return formProblem(input);
}

/** Why `me` can't answer this ask, or null when they can. Mirrors answer_site_photo. */
export function answerProblem(me: Member | null, photo: SitePhoto | undefined): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!photo) return PHOTO_GONE;
  if (photo.postedBy !== me!.id) return NOT_YOUR_ASK;
  if (photo.status !== 'waiting') return ASK_ANSWERED;
  return null;
}

/** Why `me` can't take this photo down, or null when they can. Mirrors remove_site_photo. */
export function removeProblem(
  me: Member | null,
  positions: Position[],
  crew: SitePhotoCrew[],
  photo: SitePhoto | undefined,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!photo) return PHOTO_GONE;
  if (!isSitePhotoEditor(me, positions, crew) && photo.postedBy !== me!.id) return NOT_PHOTO_REMOVER;
  if (photo.status === 'removed') return PHOTO_REMOVED_ALREADY;
  return null;
}

/** Why `me` can't put `target` on the crew (on) or take them off, or null when they can. Mirrors set_site_photo_crew. */
export function crewProblem(
  me: Member | null,
  positions: Position[],
  crew: SitePhotoCrew[],
  target: Member | undefined,
  on: boolean,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!managesSitePhotoCrew(me, positions)) return NOT_CREW_MANAGER;
  if (!target || target.approval !== 'approved') return CREW_NOT_MEMBER;
  const onCrew = crew.some((c) => c.memberId === target.id);
  if (on) {
    if (target.onHiatus) return CREW_ON_HIATUS;
    if (onCrew) return CREW_ALREADY;
  } else if (!onCrew) {
    return NOT_ON_CREW;
  }
  return null;
}

const STATUS_ORDER: Record<SitePhotoStatus, number> = { live: 0, waiting: 1, declined: 2, removed: 3 };

/** The editor's list: live, then waiting, declined and taken down; newest pick first within each. */
export function editorListOrder(list: SitePhoto[]): SitePhoto[] {
  return [...list].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.pickedAt.localeCompare(a.pickedAt) || a.id.localeCompare(b.id),
  );
}

/** The asks waiting for `me`: photos of mine someone wants on the website. */
export function myAsks(me: Member | null, list: SitePhoto[]): SitePhoto[] {
  if (!me) return [];
  return list.filter((p) => p.postedBy === me.id && p.status === 'waiting').sort((a, b) => a.pickedAt.localeCompare(b.pickedAt) || a.id.localeCompare(b.id));
}

/** The website's list: the newest PHOTOS_SHOWN live photos, nothing personal. Mirrors public_site_photos(). */
export function publicSitePhotos(list: SitePhoto[], takenAt: (p: SitePhoto) => string): PublicSitePhoto[] {
  return list
    .filter((p) => p.status === 'live')
    .map((p) => ({ id: p.id, bucket: p.bucket, path: p.path, width: p.width, height: p.height, caption: p.caption, taken_at: takenAt(p) }))
    .sort((a, b) => b.taken_at.localeCompare(a.taken_at) || a.id.localeCompare(b.id))
    .slice(0, PHOTOS_SHOWN);
}
