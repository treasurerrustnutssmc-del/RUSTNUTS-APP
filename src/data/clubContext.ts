// What every screen can ask of the club data, whichever source is behind it:
// the demo members in memory, or the live Supabase database.

import { createContext, useContext } from 'react';
import type { AccessLevel } from '../domain/access';
import type { BriefingInput } from '../domain/briefings';
import type { RoadRulesInput } from '../domain/roadRules';
import type { BusInput } from '../domain/bus';
import type { ActionItemInput, MeetingInput } from '../domain/meetings';
import type { VoteInput } from '../domain/votes';
import type {
  BallotChoice,
  Bike,
  BikeRegistration,
  ClubData,
  CrewRole,
  EmergencyContact,
  LicenceClass,
  Member,
  MemberPrivate,
  MemberStatus,
  PaymentDetails,
  PaymentMethod,
  NotificationPrefs, // Lane E: notifications
  PositionRole,
  RsvpAnswer,
  Votes,
} from '../domain/types';
// Stage 4
import type { OpenCheckinInput } from '../domain/attendance';
import type { FngOutcome } from '../domain/joining';

export class NotAllowedError extends Error {}

export interface ApplicationInput {
  chapterId: string;
  fullName: string;
  roadName: string;
  email: string;
  phone: string;
  introducedBy: string;
  note: string;
  status: Extract<MemberStatus, 'introduced' | 'supporter' | 'family'>;
  bike?: { make: string; model: string; year: number | null } | null;
}

export interface ProfileInput {
  fullName: string;
  roadName: string | null;
  bio: string | null;
  sharePhone: boolean;
}

export type PrivateInput = Pick<MemberPrivate, 'email' | 'phone' | 'licenceExpiry' | 'firstAidExpiry'> & {
  licenceClass: LicenceClass | null;
};

export type BikeInput = Omit<Bike, 'memberId' | 'id'> & { id: string | null };
export type RegoInput = Omit<BikeRegistration, 'bikeId'>;
export type ContactInput = Omit<EmergencyContact, 'memberId' | 'id'> & { id: string | null };

/**
 * A route to add (id null) or change. `gpx` is the GPX file's text, read on the phone before
 * saving; null keeps the route's file and changes only the name, chapter and notes.
 */
export interface RouteInput {
  id: string | null;
  name: string;
  chapterId: string | null;
  notes: string;
  gpx: string | null;
}

export interface ClubContextValue {
  mode: 'demo' | 'live';
  isDemo: boolean;
  /** True until the first load finishes. */
  loading: boolean;
  data: ClubData;
  me: Member | null;
  level: AccessLevel;
  today: string;
  /** Email of whoever is signed in (live mode). */
  authEmail: string | null;
  /** Signed in with a confirmed email, but hasn't asked to join yet (live mode). */
  needsApplication: boolean;
  /** The club data couldn't be loaded for whoever is signed in (live mode). Retry with refresh(). */
  loadError: string | null;
  /** A refresh failed while data is still on screen (live mode). */
  refreshError: string | null;
  // Lane E: offline
  /** When the data on screen was saved on the phone, while showing that copy after a failed load. */
  savedAt?: string | null;
  // Lane E: notifications
  /** Saves the signed-in member's notification settings. */
  saveNotificationPrefs?: (prefs: NotificationPrefs) => Promise<void>;

  // signing in
  signInAs: (memberId: string | null) => void; // demo only
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;

  // actions
  submitApplication: (input: ApplicationInput) => Promise<void>;
  approveMember: (memberId: string, status: MemberStatus) => Promise<void>;
  declineMember: (memberId: string) => Promise<void>;
  setMemberStatus: (memberId: string, status: MemberStatus) => Promise<void>;
  /** Saves profile and (when given) private details together: both or neither. */
  saveProfile: (profile: ProfileInput, priv: PrivateInput | null) => Promise<void>;
  saveBike: (bike: BikeInput, reg: RegoInput) => Promise<void>;
  removeBike: (bikeId: string) => Promise<void>;
  saveContact: (contact: ContactInput) => Promise<void>;
  removeContact: (contactId: string) => Promise<void>;
  appoint: (memberId: string, chapterId: string | null, role: PositionRole) => Promise<void>;
  endPosition: (positionId: string) => Promise<void>;
  /** Your answer to a ride: going, maybe or no. */
  setRsvp: (rideId: string, answer: RsvpAnswer) => Promise<void>;

  // Stage 5: meetings and votes
  /** Saves a new meeting (id null) or changes one; resolves to its id. */
  saveMeeting: (input: MeetingInput) => Promise<string>;
  cancelMeeting: (meetingId: string) => Promise<void>;
  saveMinutes: (meetingId: string, text: string) => Promise<void>;
  approveMinutes: (meetingId: string) => Promise<void>;
  saveActionItem: (input: ActionItemInput) => Promise<void>;
  setActionDone: (itemId: string, done: boolean) => Promise<void>;
  /** Opens a vote; resolves to its id. */
  openVote: (input: VoteInput) => Promise<string>;
  /** A ballot is final. */
  castBallot: (voteId: string, choice: BallotChoice) => Promise<void>;
  closeVote: (voteId: string, casting: 'yes' | 'no' | null) => Promise<void>;
  // Stage 4: members and money
  /** Opens a check-in at a ride or meeting. Resolves to the new session's id. */
  openCheckin: (input: OpenCheckinInput) => Promise<string>;
  /** The session's code, for the people running it. */
  checkinCode: (sessionId: string) => Promise<string>;
  /** Checks you in with a typed or scanned code. Resolves to the session's id. */
  checkIn: (code: string) => Promise<string>;
  markAttendance: (sessionId: string, memberId: string, present: boolean) => Promise<void>;
  closeCheckin: (sessionId: string) => Promise<void>;
  /** Approves an applicant as `status`, or declines them (null), recording the board's tally. */
  decideApplication: (memberId: string, status: MemberStatus | null, votes: Votes, note: string) => Promise<void>;
  recordFngReview: (memberId: string, atMonths: number, outcome: FngOutcome, votes: Votes, note: string) => Promise<void>;
  setFeeRate: (chapterId: string, fy: number, status: MemberStatus, amountCents: number, dueOn: string) => Promise<void>;
  setContinuationFee: (chapterId: string, fy: number, amountCents: number) => Promise<void>;
  setPaymentDetails: (details: PaymentDetails) => Promise<void>;
  /** Resolves to how many charges were added. */
  raiseFees: (chapterId: string, fy: number) => Promise<number>;
  raiseCharge: (memberId: string, description: string, amountCents: number, dueOn: string) => Promise<void>;
  waiveCharge: (chargeId: string) => Promise<void>;
  claimPayment: (chargeId: string, amountCents: number, paidOn: string, method: PaymentMethod, reference: string) => Promise<void>;
  recordPayment: (chargeId: string, amountCents: number, paidOn: string, method: PaymentMethod, reference: string) => Promise<void>;
  confirmPayment: (paymentId: string) => Promise<void>;
  rejectPayment: (paymentId: string) => Promise<void>;
  /** Puts a member in a spot on a ride's crew (yourself, or anyone if you manage the ride). They are then going. */
  setCrew: (rideId: string, memberId: string, role: CrewRole) => Promise<void>;
  /** Takes a member off a ride's crew (yourself, or anyone if you manage the ride). */
  leaveCrew: (rideId: string, memberId: string) => Promise<void>;
  /** Adds or changes a route in the library (route managers only). Resolves to the route's id. */
  saveRoute: (input: RouteInput) => Promise<string>;
  /** Hides a route from the library and from choosing. Rides that use it keep it. */
  archiveRoute: (routeId: string) => Promise<void>;
  /** Chooses a ride's route, or clears it with null (the ride's crew managers only). */
  setRideRoute: (rideId: string, routeId: string | null) => Promise<void>;
  /** One route's GPX file, for opening in a maps app. Archived routes still read. */
  routeGpx: (routeId: string) => Promise<string>;
  /**
   * Writes or replaces a ride's briefing (its crew managers and its Road Captain only), until the
   * ride day ends. `seen` is the `updatedAt` the editor opened on (null when there was none);
   * refused if someone else has saved since. Also marks the writer's own read.
   */
  saveBriefing: (rideId: string, input: BriefingInput, seen: string | null) => Promise<void>;
  /**
   * Got it: marks the ride's briefing read by you, now. `seen` is the `updatedAt` of the briefing
   * on screen; refused if it has changed since. Works on past and cancelled rides too.
   */
  readBriefing: (rideId: string, seen: string | null) => Promise<void>;
  /**
   * Publishes the next version of the Road Rules (the NEC only). `seen` is the current version
   * number the editor opened on (0 when there were none); refused if someone else has published
   * since. Version 1 always asks everyone to sign.
   */
  publishRoadRules: (input: RoadRulesInput, seen: number) => Promise<void>;
  /**
   * Signs the Road Rules, now. `version` is the number on screen; refused if a newer version has
   * been published since. Signing again while signed moves the date on.
   */
  signRoadRules: (version: number) => Promise<void>;
  /**
   * Books the Rusty Bus; resolves to the new booking's id. It's Booked straight away when a bus
   * manager books or it's a recovery for today or tomorrow, and otherwise waits for a yes.
   */
  bookBus: (input: BusInput) => Promise<string>;
  /** A bus manager's yes or no to a Waiting booking. The reason only counts on a no. */
  decideBus: (bookingId: string, yes: boolean, reason: string) => Promise<void>;
  /** Calls off a Waiting or Booked booking (whoever booked it, its driver or the board). */
  cancelBus: (bookingId: string) => Promise<void>;
}

export const ClubContext = createContext<ClubContextValue | null>(null);

export function useClub(): ClubContextValue {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error('useClub must be used inside ClubProvider');
  return ctx;
}

export const EMPTY_DATA: ClubData = {
  chapters: [],
  members: [],
  privates: [],
  bikes: [],
  registrations: [],
  emergencyContacts: [],
  positions: [],
  rides: [],
  rsvps: [],
  // Stage 5: meetings and votes
  meetings: [],
  actionItems: [],
  votes: [],
  // Stage 4
  checkinSessions: [],
  attendance: [],
  decisions: [],
  feeRates: [],
  continuationFees: [],
  charges: [],
  payments: [],
  paymentDetails: [],
  crew: [],
  routes: [],
  rideRoutes: [],
  briefings: [],
  briefingReads: [],
  roadRules: [],
  roadRulesSignoffs: [],
  busBookings: [],
};

/** Oldest motorcycle ever made, to next year's models. The database checks the same range. */
function bikeYearProblem(year: number | null, today: string): string | null {
  if (year === null) return null;
  const latest = Number(today.slice(0, 4)) + 1;
  if (!Number.isInteger(year) || year < 1885 || year > latest) return `Check the year: 1885 to ${latest}.`;
  return null;
}

export function validateBike(bike: Pick<BikeInput, 'make' | 'model' | 'year'>, today: string): string | null {
  if (!bike.make.trim() || !bike.model.trim()) return 'Add the make and model.';
  return bikeYearProblem(bike.year, today);
}

/** The join form's bike is optional, but it's all or nothing. */
export function validateApplicationBike(
  bike: { make: string; model: string; year: number | null } | null,
  today: string,
): string | null {
  if (!bike) return null;
  if (!bike.make.trim() && !bike.model.trim()) {
    return bike.year === null ? null : 'Add the bike’s make and model too, or clear the year.';
  }
  if (!bike.make.trim() || !bike.model.trim()) return 'Add the bike’s make and model, or leave both blank.';
  return bikeYearProblem(bike.year, today);
}

export function validateContact(contact: ContactInput): string | null {
  if (!contact.name.trim() || !contact.phone.trim()) return 'Add their name and number.';
  return null;
}
