// Turns the social tables' rows into the app's records.

import type { HelpSkill, Mechanic, MechanicVouch, MemberSkills } from '../../domain/social/help';
import type { Birthday } from '../../domain/social/shoutouts';
import type { Listing, ListingInput, ListingKind, ListingPhoto } from '../../domain/social/swap';
import type { BuildUpdate } from '../../domain/social/builds';

export interface BirthdayRow {
  member_id: string;
  month: number | null;
  day: number | null;
}

/** Shared birthdays only: a row with no month and day is one that was taken off. */
export function toBirthdays(rows: BirthdayRow[]): Birthday[] {
  return rows.flatMap((r) => (r.month === null || r.day === null ? [] : [{ memberId: r.member_id, month: r.month, day: r.day }]));
}

export interface SkillsRow {
  member_id: string;
  skills: HelpSkill[] | null;
}

export interface MechanicRow {
  id: string;
  name: string;
  suburb: string | null;
  phone: string | null;
  website: string | null;
  speciality: string | null;
  notes: string | null;
  added_by: string | null;
  added_at: string;
  archived_at: string | null;
}

export interface VouchRow {
  mechanic_id: string;
  member_id: string;
  vouched: boolean;
}

export const toSkills = (rows: SkillsRow[]): MemberSkills[] =>
  rows.map((r) => ({ memberId: r.member_id, skills: r.skills ?? [] }));

export const toMechanics = (rows: MechanicRow[]): Mechanic[] =>
  rows.map((r) => ({
    id: r.id, name: r.name, suburb: r.suburb, phone: r.phone, website: r.website, speciality: r.speciality, notes: r.notes,
    addedBy: r.added_by, addedAt: r.added_at, archivedAt: r.archived_at,
  }));

export const toVouches = (rows: VouchRow[]): MechanicVouch[] =>
  rows.map((r) => ({ mechanicId: r.mechanic_id, memberId: r.member_id, vouched: r.vouched }));

/** The save_mechanic call for what was typed: the database trims and checks it the same way. */
export const saveMechanicArgs = (i: { id: string | null; name: string; suburb: string; phone: string; website: string; speciality: string; notes: string }) => ({
  p_id: i.id, p_name: i.name, p_suburb: i.suburb, p_phone: i.phone, p_website: i.website, p_speciality: i.speciality, p_notes: i.notes,
});

export interface ListingRow {
  id: string;
  seller_id: string;
  kind: ListingKind;
  title: string;
  price_dollars: number | null;
  details: string | null;
  photos: { path: string; width: number | null; height: number | null }[] | null;
  listed_at: string;
  sold_at: string | null;
  taken_down_at: string | null;
}

export const toListings = (rows: ListingRow[]): Listing[] =>
  rows.map((r) => ({
    id: r.id, sellerId: r.seller_id, kind: r.kind, title: r.title, priceDollars: r.price_dollars, details: r.details,
    photos: (r.photos ?? []).map((p) => ({ path: p.path, width: p.width ?? 0, height: p.height ?? 0 })),
    listedAt: r.listed_at, soldAt: r.sold_at, takenDownAt: r.taken_down_at,
  }));

/** The save_listing call: the database trims and checks it the same way. */
export const saveListingArgs = (i: ListingInput, photos: ListingPhoto[]) => ({
  p_id: i.id, p_kind: i.kind, p_title: i.title, p_price: i.priceDollars, p_details: i.details, p_photos: photos,
});

export interface BuildUpdateRow {
  id: string;
  bike_id: string;
  author_id: string;
  body: string | null;
  photos: { path: string; width: number | null; height: number | null }[] | null;
  posted_at: string;
  taken_down_at: string | null;
}

export const toBuildUpdates = (rows: BuildUpdateRow[]): BuildUpdate[] =>
  rows.map((r) => ({
    id: r.id, bikeId: r.bike_id, authorId: r.author_id, body: r.body,
    photos: (r.photos ?? []).map((p) => ({ path: p.path, width: p.width ?? 0, height: p.height ?? 0 })),
    postedAt: r.posted_at, takenDownAt: r.taken_down_at,
  }));
