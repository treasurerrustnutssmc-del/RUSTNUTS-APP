// Club photos for the website as rows from the database, and the demo build's made-up list.
import type { SitePhoto, SitePhotoCrew, SitePhotoSource, SitePhotoStatus } from '../domain/sitePhotos';
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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const before = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();
const after = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** The demo's crew: Torque and Jet, put on by Rusty 20 days ago. Jet is never the demo's own account, so Jet does the asking. */
export function demoSitePhotoCrew(now: Date): SitePhotoCrew[] {
  const addedAt = before(now, 20 * DAY_MS);
  return [
    { memberId: 'm-torque', addedBy: 'm-rusty', addedAt },
    { memberId: 'm-jet', addedBy: 'm-rusty', addedAt },
  ];
}

/**
 * Three sample photos so the demo shows what the list looks like: one live from the ride wall,
 * one of the demo member's own that Jet put up, and one taken down whose chat message is no
 * longer in the demo chats (so the servo-night chat photo stays free to pick). `mediaIdFor` finds
 * a demo chat photo's media id by its path (the demo chat makes them in order). Stamps count back
 * from `now`: the dusk-run photo is picked 10 hours ago, after its chat picture went up (20 hours ago).
 */
export function demoSitePhotos(meId: string, mediaIdFor: (path: string) => string | null, now: Date): SitePhoto[] {
  const lornePicked = before(now, 12 * DAY_MS);
  const duskPicked = before(now, 10 * HOUR_MS);
  const gonePicked = before(now, 11 * DAY_MS);
  return [
    {
      id: 'demo-sp-1', source: 'chat', mediaId: mediaIdFor('demo/coast-road.jpg'), bucket: 'chat-media', path: 'demo/coast-road.jpg', width: 1200, height: 900,
      caption: 'Run to Lorne', postedBy: 'm-sparks', pickedBy: 'm-torque', pickedAt: lornePicked, status: 'live',
      decidedAt: after(lornePicked, 2 * HOUR_MS + 20 * MINUTE_MS), removedAt: null,
    },
    {
      id: 'demo-sp-2', source: 'chat', mediaId: mediaIdFor('demo/dusk-run.jpg'), bucket: 'chat-media', path: 'demo/dusk-run.jpg', width: 1200, height: 900,
      caption: 'Dusk run out past Bacchus Marsh', postedBy: meId, pickedBy: 'm-jet', pickedAt: duskPicked, status: 'live',
      decidedAt: duskPicked, removedAt: null,
    },
    {
      id: 'demo-sp-3', source: 'chat', mediaId: 'demo-media-gone', bucket: 'chat-media', path: 'demo/twisties.jpg', width: 1200, height: 900,
      caption: null, postedBy: 'm-sparks', pickedBy: 'm-torque', pickedAt: gonePicked, status: 'removed',
      decidedAt: gonePicked, removedAt: after(gonePicked, 4 * HOUR_MS),
    },
  ];
}

/** Adds a pick or an upload to the demo list: live at once, whoever posted it. */
export function demoAddPhoto(
  list: SitePhoto[],
  photo: Pick<SitePhoto, 'source' | 'mediaId' | 'bucket' | 'path' | 'width' | 'height' | 'caption' | 'postedBy'>,
  pickedBy: string,
  now: string,
): SitePhoto[] {
  return [
    { id: `demo-sp-${now}`, ...photo, pickedBy, pickedAt: now, status: 'live', decidedAt: now, removedAt: null },
    ...list,
  ];
}

export function demoRemovePhoto(list: SitePhoto[], id: string, now: string): SitePhoto[] {
  return list.map((p) => (p.id === id ? { ...p, status: 'removed', removedAt: now } : p));
}

export function demoSetCrew(crew: SitePhotoCrew[], memberId: string, on: boolean, by: string, now: string): SitePhotoCrew[] {
  if (!on) return crew.filter((c) => c.memberId !== memberId);
  return [...crew, { memberId, addedBy: by, addedAt: now }];
}
