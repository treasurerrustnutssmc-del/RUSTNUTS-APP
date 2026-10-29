// Invites to and from other clubs. Other clubs ask Rustnuts to their rides and events (invites in,
// passed on by any member and answered by the board), and the board asks other clubs to the club's
// own rides (invites out). The app sends nothing to anyone: invitations and replies are text the
// member shares themselves. public.save_other_club, archive_other_club, save_invite_in,
// invite_club, answer_invite and archive_invite apply the same checks, with the same words, in the
// same order.

import { managesChapterRides } from './access';
import { managesRide } from './crew';
import { rideChapterId } from './attendance';
import { formatAuDate, isRealIsoDate, weekday } from './dates';
import { lastDay, melbourneDate, melbourneTime } from './rides';
import { signedInProblem } from './routes';
import type { Chapter, ClubData, Member, Ride, RideCategory } from './types';

export interface OtherClub {
  id: string;
  name: string;
  town: string | null;
  /** Who to talk to: a name, a phone number, a Facebook page. */
  contact: string | null;
  note: string | null;
  /** None once whoever added it has left. */
  addedBy: string | null;
  addedAt: string;
  archivedAt: string | null;
}

export interface OtherClubInput {
  id: string | null;
  name: string;
  town: string;
  contact: string;
  note: string;
}

export type InviteDirection = 'in' | 'out';
export type InviteAnswer = 'waiting' | 'yes' | 'no';
/** How an accepted invite goes on the club calendar: the website's two labels for other clubs' events. */
export type CalendarLabel = Extract<RideCategory, 'supported' | 'non_nuts'>;

export interface ClubInvite {
  id: string;
  direction: InviteDirection;
  clubId: string;
  /** Whose invite: a chapter's, or the whole club's (null). An outgoing one takes its ride's. */
  chapterId: string | null;
  /** Out: the club's ride they're asked to. In: the calendar ride it became, once linked. */
  rideId: string | null;
  // In only: the event as the other club described it.
  title: string | null;
  eventOn: string | null;
  place: string | null;
  details: string | null;
  answer: InviteAnswer;
  /** In, answered yes: how it goes on the club calendar. */
  calendarLabel: CalendarLabel | null;
  /** Out, answered yes: how many bikes they're bringing, when they said. */
  bikes: number | null;
  note: string | null;
  addedBy: string | null;
  addedAt: string;
  answeredBy: string | null;
  answeredAt: string | null;
  archivedAt: string | null;
}

/** What someone passing on an invite (id null) or changing one typed. */
export interface InviteInInput {
  id: string | null;
  clubId: string;
  chapterId: string | null;
  title: string;
  eventOn: string;
  place: string;
  details: string;
  rideId: string | null;
}

export interface InviteOutInput {
  rideId: string;
  clubId: string;
  note: string;
}

export interface AnswerInput {
  id: string;
  /** Text, so a hand-made call with a wrong word gets the app's words. */
  answer: string;
  label: string | null;
  bikes: number | null;
  note: string;
}

export const CLUB_NO_NAME = 'Give the club’s name.';
export const CLUB_EXISTS = 'That club’s already on the list.';
export const CLUB_GONE = 'No such club.';
export const CLUB_OFF = 'That club is off the list.';
export const CLUB_OFF_ALREADY = 'That club is already off the list.';
export const NOT_CLUB_EDITOR = 'Only whoever added it, the board or the Ride Committee can change it.';
export const INVITE_GONE = 'No such invite.';
export const INVITE_OFF = 'That invite has been taken off.';
export const INVITE_OFF_ALREADY = 'That invite has already been taken off.';
export const NOT_INVITE_EDITOR = 'Only the board or Ride Committee can change that invite.';
export const NOT_INVITE_MANAGER = 'Only the board or Ride Committee can answer invites.';
export const NO_SUCH_CHAPTER = 'No such chapter.';
export const EVENT_NO_TITLE = 'Give the event a name.';
export const BAD_EVENT_DATE = 'Pick a date.';
export const EVENT_PASSED = 'That date has passed.';
export const RIDE_GONE = 'No such ride.';
export const RIDE_WRONG_LABEL = 'Link it to a Supported or Non-Nuts ride.';
export const RIDE_CANCELLED = 'That ride was cancelled.';
export const RIDE_OTHER_DAY = 'That ride is on a different day.';
export const NOT_OUR_RIDE = 'Only the club’s own rides can go out as invites.';
export const RIDE_PASSED = 'That ride has been and gone.';
export const NOT_RIDE_INVITER = 'Only the ride’s board or Ride Committee can invite other clubs.';
export const ALREADY_INVITED = 'That club has already been invited to this ride.';
export const BAD_ANSWER = 'Pick an answer.';
export const NO_CALENDAR_LABEL = 'Pick how it goes on the club calendar.';
export const BAD_BIKES = 'Bikes expected must be a whole number from 1 to 500.';

export const MAX_CLUB_NAME = 80;
export const MAX_TOWN = 60;
export const MAX_CONTACT = 200;
export const MAX_NOTE = 300;
export const MAX_EVENT_TITLE = 80;
export const MAX_PLACE = 120;
export const MAX_DETAILS = 1000;

export const CALENDAR_LABELS: CalendarLabel[] = ['supported', 'non_nuts'];
export const CALENDAR_LABEL_NAME: Record<CalendarLabel, string> = {
  supported: 'Supported Club Rides',
  non_nuts: 'Non-Nuts Events',
};

const ANSWERS: InviteAnswer[] = ['waiting', 'yes', 'no'];

/** An answer as it reads on a chip, which depends on which way the invite went. */
export function answerLabel(direction: InviteDirection, answer: InviteAnswer): string {
  if (direction === 'in') return { waiting: 'Not answered', yes: 'We’re going', no: 'Not going' }[answer];
  return { waiting: 'No word yet', yes: 'Coming', no: 'Not coming' }[answer];
}

const chars = (s: string) => [...s].length;
const opt = (s: string) => (s.trim() === '' ? null : s.trim());
const tooLong = (value: string | null, max: number, words: string) =>
  value !== null && chars(value) > max ? `Keep ${words} to ${max.toLocaleString('en-AU')} characters at most.` : null;
const live = <T extends { archivedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.archivedAt);

/** The club's details as stored: trimmed, blanks as none. */
export function cleanClub(input: OtherClubInput) {
  return { name: input.name.trim(), town: opt(input.town), contact: opt(input.contact), note: opt(input.note) };
}

export function cleanInviteIn(input: InviteInInput) {
  return {
    clubId: input.clubId, chapterId: input.chapterId, title: input.title.trim(), eventOn: input.eventOn,
    place: opt(input.place), details: opt(input.details), rideId: input.rideId,
  };
}

/** Whoever added it, any chapter's board or Ride Committee, or the NEC. Mirrors private.can_edit_other_club. */
export function canEditClub(me: Member | null, club: OtherClub, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return club.addedBy === me.id || managesChapterRides(me, null, data);
}

export function clubProblem(me: Member | null, input: OtherClubInput, clubs: OtherClub[], data: ClubData): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (input.id !== null) {
    const club = clubs.find((c) => c.id === input.id);
    if (!club) return CLUB_GONE;
    if (club.archivedAt) return CLUB_OFF;
    if (!canEditClub(me, club, data)) return NOT_CLUB_EDITOR;
  }
  const clean = cleanClub(input);
  if (clean.name === '') return CLUB_NO_NAME;
  const long = tooLong(clean.name, MAX_CLUB_NAME, 'the name');
  if (long) return long;
  const key = clean.name.toLowerCase();
  if (live(clubs).some((c) => c.id !== input.id && c.name.trim().toLowerCase() === key)) return CLUB_EXISTS;
  return (
    tooLong(clean.town, MAX_TOWN, 'the town') ??
    tooLong(clean.contact, MAX_CONTACT, 'how to reach them') ??
    tooLong(clean.note, MAX_NOTE, 'the note')
  );
}

export function archiveClubProblem(me: Member | null, id: string, clubs: OtherClub[], data: ClubData): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const club = clubs.find((c) => c.id === id);
  if (!club) return CLUB_GONE;
  if (club.archivedAt) return CLUB_OFF_ALREADY;
  if (!canEditClub(me, club, data)) return NOT_CLUB_EDITOR;
  return null;
}

/** A club an invite can name: on the list. */
function clubOnListProblem(clubId: string, clubs: OtherClub[]): string | null {
  const club = clubs.find((c) => c.id === clubId);
  if (!club) return CLUB_GONE;
  if (club.archivedAt) return CLUB_OFF;
  return null;
}

/**
 * Who answers for the club: for an incoming invite, its chapter's ride managers (any chapter's for
 * a whole-club one); for an outgoing one, its ride's. Mirrors private.manages_invite.
 */
export function canAnswer(me: Member | null, invite: ClubInvite, data: ClubData): boolean {
  if (invite.direction === 'out') {
    const ride = data.rides.find((r) => r.id === invite.rideId);
    return ride ? managesRide(me, ride, data) : false;
  }
  return managesChapterRides(me, invite.chapterId, data);
}

/** Its managers; or, for an incoming invite still waiting, whoever passed it on. */
export function canChangeInvite(me: Member | null, invite: ClubInvite, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (invite.direction === 'in' && invite.answer === 'waiting' && invite.addedBy === me.id) return true;
  return canAnswer(me, invite, data);
}

/** Why `me` can't pass on (id null) or change this incoming invite, or null when they can. */
export function inviteInProblem(
  me: Member | null,
  input: InviteInInput,
  clubs: OtherClub[],
  invites: ClubInvite[],
  data: ClubData,
  today: string,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const existing = input.id === null ? null : invites.find((i) => i.id === input.id && i.direction === 'in');
  if (input.id !== null) {
    if (!existing) return INVITE_GONE;
    if (existing.archivedAt) return INVITE_OFF;
    if (!canChangeInvite(me, existing, data)) return NOT_INVITE_EDITOR;
  }
  const onList = clubOnListProblem(input.clubId, clubs);
  if (onList) return onList;
  if (input.chapterId !== null && !data.chapters.some((c) => c.id === input.chapterId)) return NO_SUCH_CHAPTER;
  // Moving it to another chapter: whoever passed it on may, while it waits; a manager needs that chapter too.
  if (existing && existing.chapterId !== input.chapterId) {
    const asAdder = existing.answer === 'waiting' && existing.addedBy === me?.id;
    if (!asAdder && !managesChapterRides(me, input.chapterId, data)) return NOT_INVITE_EDITOR;
  }
  const clean = cleanInviteIn(input);
  if (clean.title === '') return EVENT_NO_TITLE;
  const longTitle = tooLong(clean.title, MAX_EVENT_TITLE, 'the name');
  if (longTitle) return longTitle;
  if (!isRealIsoDate(input.eventOn)) return BAD_EVENT_DATE;
  if (input.eventOn < today && !(existing && existing.eventOn === input.eventOn)) return EVENT_PASSED;
  const long = tooLong(clean.place, MAX_PLACE, 'the place') ?? tooLong(clean.details, MAX_DETAILS, 'the details');
  if (long) return long;
  if (input.rideId !== null) {
    const ride = data.rides.find((r) => r.id === input.rideId);
    if (!ride) return RIDE_GONE;
    if (ride.category !== 'supported' && ride.category !== 'non_nuts') return RIDE_WRONG_LABEL;
    if (ride.cancelledAt) return RIDE_CANCELLED;
    if (melbourneDate(ride.startsAt) !== input.eventOn) return RIDE_OTHER_DAY;
  }
  return null;
}

/** The club's own rides: a chapter's or the whole club's, not another club's. */
const OUR_RIDES: RideCategory[] = ['north', 'west', 'club'];

/** Why `me` can't invite this club to this ride, or null when they can. */
export function inviteOutProblem(
  me: Member | null,
  input: InviteOutInput,
  clubs: OtherClub[],
  invites: ClubInvite[],
  data: ClubData,
  today: string,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const ride = data.rides.find((r) => r.id === input.rideId);
  if (!ride) return RIDE_GONE;
  if (!OUR_RIDES.includes(ride.category)) return NOT_OUR_RIDE;
  if (ride.cancelledAt) return RIDE_CANCELLED;
  if (lastDay(ride) < today) return RIDE_PASSED;
  if (!managesRide(me, ride, data)) return NOT_RIDE_INVITER;
  const onList = clubOnListProblem(input.clubId, clubs);
  if (onList) return onList;
  if (live(invites).some((i) => i.direction === 'out' && i.rideId === ride.id && i.clubId === input.clubId)) return ALREADY_INVITED;
  return tooLong(opt(input.note), MAX_NOTE, 'the note');
}

export function answerProblem(me: Member | null, input: AnswerInput, invites: ClubInvite[], data: ClubData): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const invite = invites.find((i) => i.id === input.id);
  if (!invite) return INVITE_GONE;
  if (invite.archivedAt) return INVITE_OFF;
  if (!canAnswer(me, invite, data)) return NOT_INVITE_MANAGER;
  if (!(ANSWERS as string[]).includes(input.answer)) return BAD_ANSWER;
  if (invite.direction === 'in' && input.answer === 'yes' && !(CALENDAR_LABELS as (string | null)[]).includes(input.label)) {
    return NO_CALENDAR_LABEL;
  }
  if (invite.direction === 'out' && input.answer === 'yes' && input.bikes !== null) {
    if (!Number.isInteger(input.bikes) || input.bikes < 1 || input.bikes > 500) return BAD_BIKES;
  }
  return tooLong(opt(input.note), MAX_NOTE, 'the note');
}

/** The answer as stored: a label only on an incoming yes, bikes only on an outgoing yes. */
export function cleanAnswer(invite: ClubInvite, input: AnswerInput) {
  const answer = input.answer as InviteAnswer;
  return {
    answer,
    calendarLabel: invite.direction === 'in' && answer === 'yes' ? (input.label as CalendarLabel) : null,
    bikes: invite.direction === 'out' && answer === 'yes' ? input.bikes : null,
    note: opt(input.note),
  };
}

export function archiveInviteProblem(me: Member | null, id: string, invites: ClubInvite[], data: ClubData): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const invite = invites.find((i) => i.id === id);
  if (!invite) return INVITE_GONE;
  if (invite.archivedAt) return INVITE_OFF_ALREADY;
  if (!canChangeInvite(me, invite, data)) return NOT_INVITE_EDITOR;
  return null;
}

// ---------------------------------------------------------------------------------------------
// The calendar tie-in

export type CalendarState =
  | { kind: 'none' }
  | { kind: 'linked'; rideId: string }
  /** Accepted, not on the calendar yet: the label to put it on with, and rides that may be it. */
  | { kind: 'add'; label: string; suggestions: Ride[] };

export function calendarState(invite: ClubInvite, invites: ClubInvite[], rides: Ride[]): CalendarState {
  if (invite.rideId) return { kind: 'linked', rideId: invite.rideId };
  if (invite.direction !== 'in' || invite.answer !== 'yes' || !invite.calendarLabel) return { kind: 'none' };
  const taken = new Set(live(invites).filter((i) => i.id !== invite.id && i.rideId).map((i) => i.rideId));
  const suggestions = rides
    .filter((r) => r.category === invite.calendarLabel && !r.cancelledAt && melbourneDate(r.startsAt) === invite.eventOn && !taken.has(r.id))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { kind: 'add', label: CALENDAR_LABEL_NAME[invite.calendarLabel], suggestions };
}

/** The invites on the list that point at this ride. */
export function invitesForRide(rideId: string, invites: ClubInvite[]): ClubInvite[] {
  return live(invites)
    .filter((i) => i.rideId === rideId)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

/** Incoming invites: coming up (unanswered first, then by date), and the last ten gone by. */
export function invitesIn(invites: ClubInvite[], today: string): { upcoming: ClubInvite[]; earlier: ClubInvite[] } {
  const incoming = live(invites).filter((i) => i.direction === 'in' && i.eventOn);
  const upcoming = incoming
    .filter((i) => (i.eventOn as string) >= today)
    .sort(
      (a, b) =>
        Number(b.answer === 'waiting') - Number(a.answer === 'waiting') ||
        (a.eventOn as string).localeCompare(b.eventOn as string) ||
        a.addedAt.localeCompare(b.addedAt),
    );
  const earlier = incoming
    .filter((i) => (i.eventOn as string) < today)
    .sort((a, b) => (b.eventOn as string).localeCompare(a.eventOn as string))
    .slice(0, 10);
  return { upcoming, earlier };
}

/** Outgoing invites to rides still to come, by ride in date order. */
export function invitesOutByRide(invites: ClubInvite[], rides: Ride[], today: string): { ride: Ride; invites: ClubInvite[] }[] {
  const groups: { ride: Ride; invites: ClubInvite[] }[] = [];
  for (const invite of live(invites).filter((i) => i.direction === 'out').sort((a, b) => a.addedAt.localeCompare(b.addedAt))) {
    const ride = rides.find((r) => r.id === invite.rideId);
    if (!ride || lastDay(ride) < today) continue;
    const group = groups.find((g) => g.ride.id === ride.id);
    if (group) group.invites.push(invite);
    else groups.push({ ride, invites: [invite] });
  }
  return groups.sort((a, b) => a.ride.startsAt.localeCompare(b.ride.startsAt));
}

/** Incoming invites still to come that `me` could answer and nobody has. */
export function waitingCount(me: Member | null, invites: ClubInvite[], data: ClubData, today: string): number {
  return invitesIn(invites, today).upcoming.filter((i) => i.answer === 'waiting' && canAnswer(me, i, data)).length;
}

/** "West", or "Whole club". */
export function chapterLabel(chapterId: string | null, chapters: Chapter[]): string {
  if (chapterId === null) return 'Whole club';
  return chapters.find((c) => c.id === chapterId)?.name ?? 'A chapter';
}

/** "Rustnuts SMC West", or "Rustnuts SMC" for the whole club. */
function us(chapterId: string | null, chapters: Chapter[]): string {
  const name = chapterId === null ? null : chapters.find((c) => c.id === chapterId)?.name;
  return name ? `Rustnuts SMC ${name}` : 'Rustnuts SMC';
}

const dayAndDate = (iso: string) => `${weekday(iso)} ${formatAuDate(iso)}`;

/** When a ride is, for someone outside the club: "Sun 08/11/2026 8:30 am". */
function rideWhen(ride: Ride): string {
  const first = melbourneDate(ride.startsAt);
  const last = lastDay(ride);
  if (last > first) return `${dayAndDate(first)} to ${dayAndDate(last)}`;
  return ride.allDay ? `${dayAndDate(first)}, all day` : `${dayAndDate(first)} ${melbourneTime(ride.startsAt)}`;
}

/** The invitation a member sends another club themselves. It never mentions the app. */
export function invitationText(ride: Ride, club: OtherClub, chapters: Chapter[]): string {
  const place = ride.location?.trim();
  return (
    `G’day ${club.name}. ${us(rideChapterId(ride, chapters), chapters)} would love you to join us for ${ride.title}, ` +
    `${rideWhen(ride)}${place ? `, ${place}` : ''}. Let us know if you’re coming and roughly how many bikes. Cheers, Rustnuts SMC.`
  );
}

/** The reply to an incoming invite, by its answer. It never mentions the app. */
export function replyText(invite: ClubInvite, club: OtherClub, chapters: Chapter[]): string {
  const opening = `G’day ${club.name}, thanks for the invite to ${invite.title ?? 'your event'}${invite.eventOn ? ` on ${dayAndDate(invite.eventOn)}` : ''}.`;
  const who = us(invite.chapterId, chapters);
  if (invite.answer === 'yes') return `${opening} ${who} will be there. See you on the day.`;
  if (invite.answer === 'no') return `${opening} ${who} can’t make this one, but we hope it’s a ripper.`;
  return `${opening} We’ll let you know soon. Rustnuts SMC.`;
}
