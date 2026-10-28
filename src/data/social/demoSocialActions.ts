// What each social action does to the demo's social data. Plain functions, like ../demoActions:
// they take the data as it is and hand back the data as it should be, or throw with the same words
// the database uses. src/data/parity.test.ts checks them against the database's rules.

import { approvalProblem } from '../../domain/chat';
import {
  archiveProblem,
  cleanMechanic,
  mechanicProblem,
  skillsProblem,
  vouchProblem,
  type HelpSkill,
  type Mechanic,
  type MechanicInput,
  type MechanicVouch,
  type MemberSkills,
} from '../../domain/social/help';
import { birthdayProblem, type Birthday } from '../../domain/social/shoutouts';
import {
  cleanListing,
  listingProblem,
  soldProblem,
  takeDownProblem,
  type Listing,
  type ListingInput,
  type ListingKind,
  type ListingPhoto,
} from '../../domain/social/swap';
import { buildPostProblem, buildTakeDownProblem, cleanBuildPost, type BuildPost, type BuildUpdate } from '../../domain/social/builds';
import type { ClubData, Member } from '../../domain/types';
import type { FeedItem } from '../chat/chatContext';
import { NotAllowedError } from '../clubContext';

export interface SocialData {
  /** Shared birthdays only: taking one off removes it here (the database keeps a "not shared" row). */
  birthdays: Birthday[];
  /** Photos from earlier years, for On this day (the demo's chats only go back a fortnight). */
  pastPhotos: FeedItem[];
  // Who can help
  skills: MemberSkills[];
  /** Every workshop, archived ones included. */
  mechanics: Mechanic[];
  vouches: MechanicVouch[];
  /** Every listing, taken-down ones included. */
  listings: Listing[];
  /** Every build update, taken-down ones included. */
  buildUpdates: BuildUpdate[];
}

export interface SocialCtx {
  social: SocialData;
  club: ClubData;
  me: Member | null;
  /** The club's date (Melbourne), ISO. */
  today: string;
  /** The current instant (ISO), for stamps. */
  now?: string;
}

const refuse = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

/** Shares (or changes) my birthday; two nulls take it off. */
export function setBirthday(ctx: SocialCtx, month: number | null, day: number | null): SocialData {
  refuse(approvalProblem(ctx.me));
  refuse(birthdayProblem(month, day));
  const me = ctx.me as Member;
  const others = ctx.social.birthdays.filter((b) => b.memberId !== me.id);
  return {
    ...ctx.social,
    birthdays: month === null || day === null ? others : [...others, { memberId: me.id, month, day }],
  };
}

/** Sets my skills: each once, in the order given. */
export function setSkills(ctx: SocialCtx, skills: string[]): SocialData {
  refuse(skillsProblem(ctx.me, skills));
  const me = ctx.me as Member;
  const once = [...new Set(skills)] as HelpSkill[];
  return { ...ctx.social, skills: [...ctx.social.skills.filter((s) => s.memberId !== me.id), { memberId: me.id, skills: once }] };
}

/** Adds (input.id null) or changes a workshop; hands back its id. */
export function saveMechanic(ctx: SocialCtx, input: MechanicInput): { social: SocialData; id: string } {
  refuse(mechanicProblem(ctx.me, input, ctx.social.mechanics, ctx.club.positions));
  const me = ctx.me as Member;
  const clean = cleanMechanic(input);
  if (input.id === null) {
    const id = `mech-${ctx.social.mechanics.length + 1}-${Date.now().toString(36)}`;
    const added: Mechanic = { id, ...clean, addedBy: me.id, addedAt: ctx.now ?? new Date().toISOString(), archivedAt: null };
    return { social: { ...ctx.social, mechanics: [...ctx.social.mechanics, added] }, id };
  }
  return {
    social: { ...ctx.social, mechanics: ctx.social.mechanics.map((m) => (m.id === input.id ? { ...m, ...clean } : m)) },
    id: input.id,
  };
}

export function archiveMechanic(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveProblem(ctx.me, id, ctx.social.mechanics, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, mechanics: ctx.social.mechanics.map((m) => (m.id === id ? { ...m, archivedAt: at } : m)) };
}

export function vouchMechanic(ctx: SocialCtx, id: string, on: boolean): SocialData {
  refuse(vouchProblem(ctx.me, id, ctx.social.mechanics));
  const me = ctx.me as Member;
  const others = ctx.social.vouches.filter((v) => !(v.mechanicId === id && v.memberId === me.id));
  return { ...ctx.social, vouches: [...others, { mechanicId: id, memberId: me.id, vouched: on }] };
}

/** Lists something (input.id null) or changes my listing; hands back its id. */
export function saveListing(ctx: SocialCtx, input: ListingInput): { social: SocialData; id: string } {
  refuse(listingProblem(ctx.me, input, ctx.social.listings));
  const me = ctx.me as Member;
  const clean = cleanListing(input);
  const photos = clean.photos.map((p) => ({ path: p.path, width: Math.round(p.width), height: Math.round(p.height) }));
  if (input.id === null) {
    const id = `listing-${ctx.social.listings.length + 1}-${Date.now().toString(36)}`;
    const at = ctx.now ?? new Date().toISOString();
    const added: Listing = { id, sellerId: me.id, ...clean, photos, listedAt: at, soldAt: null, takenDownAt: null };
    return { social: { ...ctx.social, listings: [...ctx.social.listings, added] }, id };
  }
  return {
    social: { ...ctx.social, listings: ctx.social.listings.map((l) => (l.id === input.id ? { ...l, ...clean, photos } : l)) },
    id: input.id,
  };
}

export function markListingSold(ctx: SocialCtx, id: string, sold: boolean): SocialData {
  refuse(soldProblem(ctx.me, id, ctx.social.listings));
  const at = ctx.now ?? new Date().toISOString();
  return {
    ...ctx.social,
    listings: ctx.social.listings.map((l) => (l.id === id ? { ...l, soldAt: sold ? l.soldAt ?? at : null } : l)),
  };
}

export function takeDownListing(ctx: SocialCtx, id: string): SocialData {
  refuse(takeDownProblem(ctx.me, id, ctx.social.listings, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, listings: ctx.social.listings.map((l) => (l.id === id ? { ...l, takenDownAt: at } : l)) };
}

/** Posts an update on my project bike's build; hands back its id. */
export function postBuildUpdate(ctx: SocialCtx, post: BuildPost): { social: SocialData; id: string } {
  refuse(buildPostProblem(ctx.me, post, ctx.club.bikes, ctx.social.buildUpdates));
  const me = ctx.me as Member;
  const clean = cleanBuildPost(post);
  const id = `build-${ctx.social.buildUpdates.length + 1}-${Date.now().toString(36)}`;
  const added: BuildUpdate = {
    id, bikeId: clean.bikeId, authorId: me.id, body: clean.body,
    photos: clean.photos.map((p) => ({ path: p.path, width: Math.round(p.width), height: Math.round(p.height) })),
    postedAt: ctx.now ?? new Date().toISOString(), takenDownAt: null,
  };
  return { social: { ...ctx.social, buildUpdates: [...ctx.social.buildUpdates, added] }, id };
}

export function takeDownBuildUpdate(ctx: SocialCtx, id: string): SocialData {
  refuse(buildTakeDownProblem(ctx.me, id, ctx.social.buildUpdates, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, buildUpdates: ctx.social.buildUpdates.map((u) => (u.id === id ? { ...u, takenDownAt: at } : u)) };
}

/** A parity.json case, as the social action it names. */
export type SocialAction =
  | { action: 'socialSetBirthday'; month: number | null; day: number | null }
  | { action: 'socialSetSkills'; skills: string[] }
  // The workshop's name is `workshop`: a case's `name` is the case's own.
  | ({ action: 'socialSaveMechanic'; mechanic: string | null; workshop: string } & Omit<MechanicInput, 'id' | 'name'>)
  | { action: 'socialArchiveMechanic'; mechanic: string }
  | { action: 'socialVouchMechanic'; mechanic: string; on: boolean }
  // Photos are file names in the signed-in member's own folder, or `other:<name>` for someone else's.
  | { action: 'socialSaveListing'; listing: string | null; kind: ListingKind; title: string; price: number | null; details: string; photos: string[] }
  | { action: 'socialMarkListingSold'; listing: string; sold: boolean }
  | { action: 'socialTakeDownListing'; listing: string }
  | { action: 'socialPostBuildUpdate'; bike: string; body: string; photos: string[] }
  | { action: 'socialTakeDownBuildUpdate'; update: string };

/** A parity case's photo names as the photos the action is sent. */
export function parityPhotos(me: Member | null, names: string[], otherId: string): ListingPhoto[] {
  return names.map((n) => ({
    path: n.startsWith('other:') ? `${otherId}/${n.slice(6)}` : `${me?.id ?? 'nobody'}/${n}`,
    width: 800,
    height: 600,
  }));
}

export function runSocialAction(ctx: SocialCtx, a: SocialAction): SocialData {
  switch (a.action) {
    case 'socialSetBirthday':
      return setBirthday(ctx, a.month, a.day);
    case 'socialSetSkills':
      return setSkills(ctx, a.skills);
    case 'socialSaveMechanic':
      return saveMechanic(ctx, {
        id: a.mechanic, name: a.workshop, suburb: a.suburb, phone: a.phone, website: a.website, speciality: a.speciality, notes: a.notes,
      }).social;
    case 'socialArchiveMechanic':
      return archiveMechanic(ctx, a.mechanic);
    case 'socialVouchMechanic':
      return vouchMechanic(ctx, a.mechanic, a.on);
    case 'socialSaveListing':
      return saveListing(ctx, {
        id: a.listing, kind: a.kind, title: a.title, priceDollars: a.price, details: a.details,
        photos: parityPhotos(ctx.me, a.photos, 'someone-else'),
      }).social;
    case 'socialMarkListingSold':
      return markListingSold(ctx, a.listing, a.sold);
    case 'socialTakeDownListing':
      return takeDownListing(ctx, a.listing);
    case 'socialPostBuildUpdate':
      return postBuildUpdate(ctx, { bikeId: a.bike, body: a.body, photos: parityPhotos(ctx.me, a.photos, 'someone-else') }).social;
    case 'socialTakeDownBuildUpdate':
      return takeDownBuildUpdate(ctx, a.update);
  }
}
