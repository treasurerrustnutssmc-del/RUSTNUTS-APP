// Garage build threads: updates with photos on a project bike in someone's garage. The database's
// post_build_update and take_down_build_update apply the same checks with the same words, in the
// same order.

import type { Block } from '../chat';
import { postingRulesProblem } from '../postingRules';
import { signedInProblem } from '../routes';
import type { Bike, Member, Position } from '../types';
import { isAnyBoard } from './help';
import type { ListingPhoto } from './swap';

export const MAX_BUILD_BODY = 2000;
export const MAX_BUILD_PHOTOS = 4;

export const NO_BIKE = 'No such bike.';
export const NOT_BIKE_OWNER = 'Only the bike’s owner can post on its build.';
export const NOT_PROJECT = 'Build threads are for project bikes. Mark it as a project in your garage first.';
export const BUILD_EMPTY = 'Write something or add a photo.';
export const TOO_MANY_BUILD_PHOTOS = 'Up to 4 photos.';
export const BAD_BUILD_PHOTO = 'That photo didn’t upload properly. Try again.';
export const NO_UPDATE = 'No such update.';
export const NOT_POSTER_OR_BOARD = 'Only whoever posted it or the board can take it down.';
export const BUILD_TAKEN_DOWN_ALREADY = 'That update has already been taken down.';

/** Same shape as a listing photo: a path in the poster's own folder of the build-media bucket. */
export type BuildPhoto = ListingPhoto;

export interface BuildUpdate {
  id: string;
  bikeId: string;
  authorId: string;
  body: string | null;
  photos: BuildPhoto[];
  postedAt: string;
  takenDownAt: string | null;
}

export interface BuildPost {
  bikeId: string;
  body: string;
  photos: BuildPhoto[];
}

export interface Build {
  bike: Bike;
  owner: Member;
  /** Newest first. */
  updates: BuildUpdate[];
}

const chars = (s: string) => [...s].length;

export function cleanBuildPost(p: BuildPost) {
  const body = p.body.trim();
  return { bikeId: p.bikeId, body: body === '' ? null : body, photos: p.photos };
}

export function buildPostProblem(me: Member | null, p: BuildPost, bikes: Bike[], updates: BuildUpdate[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const self = me as Member;
  const bike = bikes.find((b) => b.id === p.bikeId);
  if (!bike) return NO_BIKE;
  if (bike.memberId !== self.id) return NOT_BIKE_OWNER;
  if (!bike.isProject) return NOT_PROJECT;
  const clean = cleanBuildPost(p);
  if (clean.body === null && p.photos.length === 0) return BUILD_EMPTY;
  if (clean.body !== null && chars(clean.body) > MAX_BUILD_BODY) return 'Keep it to 2,000 characters at most.';
  if (p.photos.length > MAX_BUILD_PHOTOS) return TOO_MANY_BUILD_PHOTOS;
  const used = new Set(updates.flatMap((u) => u.photos.map((x) => x.path)));
  const seen = new Set<string>();
  for (const photo of p.photos) {
    if (photo.path.split('/')[0] !== self.id || used.has(photo.path) || seen.has(photo.path)) return BAD_BUILD_PHOTO;
    seen.add(photo.path);
  }
  // Last, as the row goes in (a database trigger): agreed to the club rules for chats and posts?
  return postingRulesProblem(me);
}

export function buildTakeDownProblem(me: Member | null, id: string, updates: BuildUpdate[], positions: Position[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const u = updates.find((x) => x.id === id);
  if (!u) return NO_UPDATE;
  if (u.authorId !== (me as Member).id && !isAnyBoard(me, positions)) return NOT_POSTER_OR_BOARD;
  if (u.takenDownAt) return BUILD_TAKEN_DOWN_ALREADY;
  return null;
}

export const canTakeDownUpdate = (me: Member | null, u: BuildUpdate, positions: Position[]) =>
  !!me && me.approval === 'approved' && !u.takenDownAt && (u.authorId === me.id || isAnyBoard(me, positions));

const newestFirst = (a: BuildUpdate, b: BuildUpdate) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0);

/**
 * Bikes with at least one update up, by approved owners the viewer hasn't blocked (or been blocked
 * by), the most recently updated first. A bike that stops being a project keeps its thread.
 */
export function buildsFor(viewer: Member | null, members: Member[], bikes: Bike[], updates: BuildUpdate[], blocks: Block[]): Build[] {
  if (!viewer || viewer.approval !== 'approved') return [];
  const blocked = (id: string) =>
    blocks.some((b) => (b.blockerId === viewer.id && b.blockedId === id) || (b.blockerId === id && b.blockedId === viewer.id));
  const builds: Build[] = [];
  for (const bike of bikes) {
    const owner = members.find((m) => m.id === bike.memberId);
    if (!owner || owner.approval !== 'approved' || blocked(owner.id)) continue;
    const up = updates.filter((u) => u.bikeId === bike.id && !u.takenDownAt).sort(newestFirst);
    if (up.length) builds.push({ bike, owner, updates: up });
  }
  return builds.sort((a, b) => newestFirst(a.updates[0], b.updates[0]));
}

/** "The Resurrection", or "1978 Honda CB750". */
export function bikeLabel(b: Pick<Bike, 'nickname' | 'make' | 'model' | 'year'>): string {
  if (b.nickname) return b.nickname;
  return [b.year, b.make, b.model].filter(Boolean).join(' ');
}
