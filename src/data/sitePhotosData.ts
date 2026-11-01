// Club photos for the website as rows from the database, and the demo build's made-up list.
import type { SitePhoto, SitePhotoCrew, SitePhotoSource, SitePhotoStatus } from '../domain/sitePhotos';
import { demoChatData } from './chat/demoChatData';

/** The demo chat's media ids are made in order, so a sample photo finds its chat photo by path. */
const demoMediaId = (path: string): string | null => {
  for (const m of demoChatData().messages) {
    const hit = m.media.find((x) => x.path === path);
    if (hit) return hit.id;
  }
  return null;
};

export interface SitePhotoRow {
  id: string;
  source: SitePhotoSource;
  media_id: string | null;
  bucket: 'chat-media' | 'site-media';
  path: string;
  width: number;
  height: number;
  caption: string | null;
  posted_by: string | null;
  picked_by: string | null;
  picked_at: string;
  status: SitePhotoStatus;
  decided_at: string | null;
  removed_at: string | null;
  removed_by: string | null;
}

export interface SitePhotoCrewRow {
  member_id: string;
  added_by: string | null;
  added_at: string;
}

export function toSitePhotos(rows: SitePhotoRow[]): SitePhoto[] {
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    mediaId: r.media_id,
    bucket: r.bucket,
    path: r.path,
    width: r.width,
    height: r.height,
    caption: r.caption,
    postedBy: r.posted_by,
    pickedBy: r.picked_by,
    pickedAt: r.picked_at,
    status: r.status,
    decidedAt: r.decided_at,
    removedAt: r.removed_at,
  }));
}

export function toSitePhotoCrew(rows: SitePhotoCrewRow[]): SitePhotoCrew[] {
  return rows.map((r) => ({ memberId: r.member_id, addedBy: r.added_by, addedAt: r.added_at }));
}

/** The demo's crew: Torque and Jet, put on by Rusty. Jet is never the demo's own account, so Jet does the asking. */
export const DEMO_SITE_PHOTO_CREW: SitePhotoCrew[] = [
  { memberId: 'm-torque', addedBy: 'm-rusty', addedAt: '2026-10-12T03:00:00.000Z' },
  { memberId: 'm-jet', addedBy: 'm-rusty', addedAt: '2026-10-12T03:00:00.000Z' },
];

/**
 * Three sample photos so the demo shows what the list looks like: one live from the ride wall,
 * one the demo member is being asked about (so the Home card shows), one declined whose chat
 * message is no longer in the demo chats (so the servo-night chat photo stays free to pick).
 */
export function demoSitePhotos(meId: string): SitePhoto[] {
  return [
    {
      id: 'demo-sp-1', source: 'chat', mediaId: demoMediaId('demo/coast-road.jpg'), bucket: 'chat-media', path: 'demo/coast-road.jpg', width: 1200, height: 900,
      caption: 'Spring run to Lorne', postedBy: 'm-sparks', pickedBy: 'm-torque', pickedAt: '2026-10-13T06:10:00.000Z', status: 'live',
      decidedAt: '2026-10-13T08:30:00.000Z', removedAt: null,
    },
    {
      id: 'demo-sp-2', source: 'chat', mediaId: demoMediaId('demo/dusk-run.jpg'), bucket: 'chat-media', path: 'demo/dusk-run.jpg', width: 1200, height: 900,
      caption: 'Dusk run out past Bacchus Marsh', postedBy: meId, pickedBy: 'm-jet', pickedAt: '2026-10-30T09:00:00.000Z', status: 'waiting',
      decidedAt: null, removedAt: null,
    },
    {
      id: 'demo-sp-3', source: 'chat', mediaId: 'demo-media-gone', bucket: 'chat-media', path: 'demo/twisties.jpg', width: 1200, height: 900,
      caption: null, postedBy: 'm-sparks', pickedBy: 'm-torque', pickedAt: '2026-10-14T06:10:00.000Z', status: 'declined',
      decidedAt: '2026-10-14T10:00:00.000Z', removedAt: null,
    },
  ];
}

/** Adds a pick or an upload to the demo list. */
export function demoAddPhoto(
  list: SitePhoto[],
  photo: Pick<SitePhoto, 'source' | 'mediaId' | 'bucket' | 'path' | 'width' | 'height' | 'caption' | 'postedBy'>,
  pickedBy: string,
  now: string,
): SitePhoto[] {
  const live = photo.postedBy === pickedBy;
  return [
    { id: `demo-sp-${now}`, ...photo, pickedBy, pickedAt: now, status: live ? 'live' : 'waiting', decidedAt: live ? now : null, removedAt: null },
    ...list,
  ];
}

export function demoAnswerPhoto(list: SitePhoto[], id: string, yes: boolean, now: string): SitePhoto[] {
  return list.map((p) => (p.id === id ? { ...p, status: yes ? 'live' : 'declined', decidedAt: now } : p));
}

export function demoRemovePhoto(list: SitePhoto[], id: string, now: string): SitePhoto[] {
  return list.map((p) => (p.id === id ? { ...p, status: 'removed', removedAt: now } : p));
}

export function demoSetCrew(crew: SitePhotoCrew[], memberId: string, on: boolean, by: string, now: string): SitePhotoCrew[] {
  if (!on) return crew.filter((c) => c.memberId !== memberId);
  return [...crew, { memberId, addedBy: by, addedAt: now }];
}
