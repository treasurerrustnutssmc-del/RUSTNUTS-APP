// Turns the social tables' rows into the app's records.

import type { HelpSkill, Mechanic, MechanicVouch, MemberSkills } from '../../domain/social/help';
import type { Birthday } from '../../domain/social/shoutouts';
import type { Listing, ListingInput, ListingKind, ListingPhoto } from '../../domain/social/swap';
import type { BuildUpdate } from '../../domain/social/builds';
import type { HistoryEntry, HistoryInput, HistoryPrecision, Honour, HonourInput } from '../../domain/social/history';
import type { Award, AwardInput, BragKind, Nomination, NominationInput, Tally, Vote } from '../../domain/social/brag';
import type { Ride, RideCategory, RideRoute } from '../../domain/types';
import type {
  AnswerInput, CalendarLabel, ClubInvite, InviteAnswer, InviteDirection, InviteInInput, InviteOutInput, OtherClub, OtherClubInput,
} from '../../domain/invites';

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
  /** None once the bike was removed from its garage. */
  bike_id: string | null;
  author_id: string;
  body: string | null;
  photos: { path: string; width: number | null; height: number | null }[] | null;
  posted_at: string;
  taken_down_at: string | null;
}

export const toBuildUpdates = (rows: BuildUpdateRow[]): BuildUpdate[] =>
  rows.map((r) => ({
    id: r.id, bikeId: r.bike_id ?? '', authorId: r.author_id, body: r.body,
    photos: (r.photos ?? []).map((p) => ({ path: p.path, width: p.width ?? 0, height: p.height ?? 0 })),
    postedAt: r.posted_at, takenDownAt: r.taken_down_at,
  }));

export interface HistoryRow {
  id: string;
  happened_on: string;
  precision: HistoryPrecision;
  title: string;
  story: string | null;
  /** None once whoever added it has left. */
  added_by: string | null;
  archived_at: string | null;
}

export const toHistory = (rows: HistoryRow[]): HistoryEntry[] =>
  rows.map((r) => ({
    id: r.id, happenedOn: r.happened_on, precision: r.precision, title: r.title, story: r.story,
    addedBy: r.added_by ?? '', archivedAt: r.archived_at,
  }));

export interface HonourRow {
  id: string;
  member_id: string | null;
  name: string | null;
  honour: string;
  year: number;
  note: string | null;
  added_by: string | null;
  archived_at: string | null;
}

export const toHonours = (rows: HonourRow[]): Honour[] =>
  rows.map((r) => ({
    id: r.id, memberId: r.member_id, name: r.name, honour: r.honour, year: r.year, note: r.note,
    addedBy: r.added_by ?? '', archivedAt: r.archived_at,
  }));

/** The save_history_entry call: the database trims and checks it the same way. */
export const saveHistoryArgs = (i: HistoryInput) => ({
  p_id: i.id, p_happened_on: i.happenedOn, p_precision: i.precision, p_title: i.title, p_story: i.story,
});

export const saveHonourArgs = (i: HonourInput) => ({
  p_id: i.id, p_member: i.memberId, p_name: i.name, p_honour: i.honour, p_year: i.year, p_note: i.note,
});

export interface AwardRow {
  id: string;
  kind: BragKind;
  title: string;
  year: number;
  nominations_close: string;
  voting_close: string;
  opened_by: string | null;
  archived_at: string | null;
}

export const toAwards = (rows: AwardRow[]): Award[] =>
  rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, year: r.year, nominationsClose: r.nominations_close, votingClose: r.voting_close,
    openedBy: r.opened_by ?? '', archivedAt: r.archived_at,
  }));

export interface NominationRow {
  id: string;
  award_id: string;
  /** None once whoever nominated it has left. */
  nominated_by: string | null;
  ride_id: string | null;
  title: string | null;
  photo: { path: string; width: number | null; height: number | null } | null;
  story: string | null;
  reason: string | null;
  nominated_at: string;
  withdrawn_at: string | null;
}

export const toNominations = (rows: NominationRow[]): Nomination[] =>
  rows.map((r) => ({
    id: r.id, awardId: r.award_id, nominatedBy: r.nominated_by ?? '', rideId: r.ride_id, title: r.title,
    photo: r.photo ? { path: r.photo.path, width: r.photo.width ?? 0, height: r.photo.height ?? 0 } : null,
    story: r.story, reason: r.reason, nominatedAt: r.nominated_at, withdrawnAt: r.withdrawn_at,
  }));

export interface BragVoteRow {
  award_id: string;
  member_id: string;
  nomination_id: string;
}

export const toVotes = (rows: BragVoteRow[]): Vote[] =>
  rows.map((r) => ({ awardId: r.award_id, memberId: r.member_id, nominationId: r.nomination_id }));

export const toTallies = (rows: { nomination_id: string; votes: number }[]): Tally[] =>
  rows.map((r) => ({ nominationId: r.nomination_id, votes: r.votes }));

export const openAwardArgs = (i: AwardInput) => ({
  p_kind: i.kind, p_title: i.title, p_year: i.year, p_nominations_close: i.nominationsClose, p_voting_close: i.votingClose,
});

export const nominateArgs = (i: NominationInput) => ({
  p_award: i.awardId, p_ride: i.rideId, p_title: i.title, p_photo: i.photo, p_story: i.story, p_reason: i.reason,
});

export interface BragRideRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  category: RideCategory;
  cancelled_at: string | null;
}

const instant = (ts: string) => new Date(ts).toISOString();

export const toBragRides = (rows: BragRideRow[]): Ride[] =>
  rows.map((r) => ({
    id: r.id, title: r.title, startsAt: instant(r.starts_at), endsAt: r.ends_at ? instant(r.ends_at) : null, allDay: r.all_day,
    location: r.location, notes: r.notes, category: r.category, cancelledAt: r.cancelled_at ? instant(r.cancelled_at) : null,
  }));

/** The window of rides the ride awards need: their years, a day either side for Melbourne time. Null when there are none. */
export function bragRideWindow(awards: Award[]): { from: string; to: string } | null {
  const years = awards.filter((a) => a.kind === 'ride').map((a) => a.year);
  if (years.length === 0) return null;
  return { from: `${Math.min(...years) - 1}-12-31T00:00:00Z`, to: `${Math.max(...years) + 1}-01-02T00:00:00Z` };
}

// Badges
export interface RideRouteRow {
  ride_id: string;
  route_id: string | null;
}

/** Which route each ride used (past rides too). A cleared route is a row with no route. */
export const toRideRoutes = (rows: RideRouteRow[]): RideRoute[] =>
  rows.filter((r) => r.route_id != null).map((r) => ({ rideId: r.ride_id, routeId: r.route_id as string }));

/** Every ride's route: the table's, with the calendar's (fresher, loaded more often) winning. */
export function mergeRideRoutes(all: RideRoute[], calendar: RideRoute[]): RideRoute[] {
  const fresh = new Set(calendar.map((r) => r.rideId));
  return [...all.filter((r) => !fresh.has(r.rideId)), ...calendar];
}

/** PostgREST hands back at most 1,000 rows a request: read the lot, a page at a time. */
export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 1000,
): Promise<{ data: T[] | null; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < size) return { data: rows, error: null };
  }
}

// Invites to and from other clubs ------------------------------------------------------------

export interface OtherClubRow {
  id: string;
  name: string;
  town: string | null;
  contact: string | null;
  note: string | null;
  added_by: string | null;
  added_at: string;
  archived_at: string | null;
}

export const toOtherClubs = (rows: OtherClubRow[]): OtherClub[] =>
  rows.map((r) => ({
    id: r.id, name: r.name, town: r.town, contact: r.contact, note: r.note, addedBy: r.added_by, addedAt: r.added_at,
    archivedAt: r.archived_at,
  }));

export interface InviteRow {
  id: string;
  direction: InviteDirection;
  club_id: string;
  chapter_id: string | null;
  ride_id: string | null;
  title: string | null;
  event_on: string | null;
  place: string | null;
  details: string | null;
  answer: InviteAnswer;
  calendar_label: CalendarLabel | null;
  bikes: number | null;
  note: string | null;
  added_by: string | null;
  added_at: string;
  answered_by: string | null;
  answered_at: string | null;
  archived_at: string | null;
}

export const INVITE_COLUMNS =
  'id, direction, club_id, chapter_id, ride_id, title, event_on, place, details, answer, calendar_label, bikes, note, ' +
  'added_by, added_at, answered_by, answered_at, archived_at';

export const toInvites = (rows: InviteRow[]): ClubInvite[] =>
  rows.map((r) => ({
    id: r.id, direction: r.direction, clubId: r.club_id, chapterId: r.chapter_id, rideId: r.ride_id, title: r.title,
    eventOn: r.event_on, place: r.place, details: r.details, answer: r.answer, calendarLabel: r.calendar_label, bikes: r.bikes,
    note: r.note, addedBy: r.added_by, addedAt: r.added_at, answeredBy: r.answered_by, answeredAt: r.answered_at,
    archivedAt: r.archived_at,
  }));

/** The database calls: it trims and checks them the same way. */
export const saveOtherClubArgs = (i: OtherClubInput) => ({
  p_id: i.id, p_name: i.name, p_town: i.town, p_contact: i.contact, p_note: i.note,
});

export const saveInviteInArgs = (i: InviteInInput) => ({
  p_id: i.id, p_club: i.clubId, p_chapter: i.chapterId, p_title: i.title, p_event_on: i.eventOn, p_place: i.place,
  p_details: i.details, p_ride: i.rideId,
});

export const inviteClubArgs = (i: InviteOutInput) => ({ p_ride: i.rideId, p_club: i.clubId, p_note: i.note });

export const answerInviteArgs = (i: AnswerInput) => ({
  p_id: i.id, p_answer: i.answer, p_label: i.label, p_bikes: i.bikes, p_note: i.note,
});
