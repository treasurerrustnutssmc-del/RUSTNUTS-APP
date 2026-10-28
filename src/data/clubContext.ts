// What every screen can ask of the club data, whichever source is behind it:
// the demo members in memory, or the live Supabase database.

import { createContext, useContext } from 'react';
import type { AccessLevel } from '../domain/access';
import type { BriefingInput } from '../domain/briefings';
import type { RoadRulesInput } from '../domain/roadRules';
import type { BusInput } from '../domain/bus';
import type { HubInput, RegisterInput } from '../domain/hubs'; // Ride planning extras
import type { ActionItemInput, MeetingInput } from '../domain/meetings';
import type { Casting, VoteInput } from '../domain/votes';
import type { CreditInput, DebitInput } from '../domain/ledger'; // Stage 5B
import type { ApprovalInput, DocumentInput, VersionInput } from '../domain/documents'; // Stage 5C
import type {
  BallotChoice,
  Bike,
  BikeRegistration,
  ClubData,
  CrewRole,
  EmergencyContact,
  LedgerCode, // Stage 5B
  AppealOutcome, // Stage 5D
  LicenceClass,
  Member,
  MemberPrivate,
  MemberStatus,
  PaymentDetails,
  PaymentMethod,
  NotificationPrefs, // Lane E: notifications
  PlanStop, // Ride planning extras
  RideCallState, // Ride planning extras
  PositionRole,
  RsvpAnswer,
  Votes,
} from '../domain/types';
// Stage 4
import type { OpenCheckinInput } from '../domain/attendance';
import type { FngOutcome } from '../domain/joining';
// Stage 5D: board and admin
import type { ConductInput } from '../domain/conduct';
import type { MerchInput, OrderInput } from '../domain/merch';
import type { ChapterInput, ContributionInput } from '../domain/national';

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
  /** Sends the draft minutes to members (10.8). */
  shareMinutes: (meetingId: string) => Promise<void>;
  approveMinutes: (meetingId: string) => Promise<void>;
  saveActionItem: (input: ActionItemInput) => Promise<void>;
  setActionDone: (itemId: string, done: boolean) => Promise<void>;
  /** Opens a vote; resolves to its id. */
  openVote: (input: VoteInput) => Promise<string>;
  /** A ballot is final. */
  castBallot: (voteId: string, choice: BallotChoice) => Promise<void>;
  /** On a tie the chair passes a casting vote, or 'decline' to let it fall. */
  closeVote: (voteId: string, casting: Casting | null) => Promise<void>;
  // Stage 4: members and money
  /** Opens a check-in at a ride or meeting. Resolves to the new session's id. */
  openCheckin: (input: OpenCheckinInput) => Promise<string>;
  /** The session's code, for the people running it. */
  checkinCode: (sessionId: string) => Promise<string>;
  /** Checks you in with a typed or scanned code. Resolves to the session's id. */
  checkIn: (code: string) => Promise<string>;
  markAttendance: (sessionId: string, memberId: string, present: boolean) => Promise<void>;
  closeCheckin: (sessionId: string) => Promise<void>;
  // Attendance rules and Big 4 rides
  /** Makes a ride a Big 4 (chapterId null = every chapter), or changes its chapter. */
  designateBig4: (rideId: string, chapterId: string | null) => Promise<void>;
  undesignateBig4: (rideId: string) => Promise<void>;
  /** Excuses a member from a check-in with a reason; null or blank clears it. */
  setExemption: (sessionId: string, memberId: string, reason: string | null) => Promise<void>;
  /** Approves an applicant as `status`, or declines them (null), recording the board's tally. */
  decideApplication: (memberId: string, status: MemberStatus | null, votes: Votes, note: string) => Promise<void>;
  recordFngReview: (memberId: string, atMonths: number, outcome: FngOutcome, votes: Votes, note: string) => Promise<void>;
  setFeeRate: (chapterId: string, fy: number, status: MemberStatus, amountCents: number, dueOn: string) => Promise<void>;
  setContinuationFee: (chapterId: string, fy: number, amountCents: number) => Promise<void>;
  setPaymentDetails: (details: PaymentDetails) => Promise<void>;
  /** Resolves to how many charges were added. */
  raiseFees: (chapterId: string, fy: number) => Promise<number>;
  /** Records the date of a year's AGM, which starts that club year (fees run AGM to AGM). */
  recordAgm: (heldOn: string) => Promise<void>;
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
  // Ride planning extras
  /** Sets (or with null clears) the range of one of your own bikes, in km. */
  setBikeRange: (bikeId: string, rangeKm: number | null) => Promise<void>;
  /** Writes or replaces a ride's stops. `seen` is the plan's `updatedAt` the editor opened on (null: none). */
  saveRidePlan: (rideId: string, stops: PlanStop[], seen: string | null) => Promise<void>;
  /** Rates a route 1 to 5 stars, or changes your rating. */
  rateRoute: (routeId: string, stars: number, comment: string) => Promise<void>;
  /** Calls a ride Off, Postponed (with an optional new day) or Back on, and posts it in the ride's chat. */
  callRide: (rideId: string, state: RideCallState, reason: string, newDay: string | null) => Promise<void>;
  /** Opens or changes a ride's hub (its crew managers). */
  saveHub: (rideId: string, input: HubInput) => Promise<void>;
  /** Registers you for a ride's hub, or changes your registration. */
  registerHub: (rideId: string, input: RegisterInput) => Promise<void>;
  withdrawHub: (rideId: string) => Promise<void>;
  /** Asks someone to take your crew spot (or trade); resolves to the ask's id. */
  askSwap: (rideId: string, toId: string, note: string) => Promise<string>;
  /** The person asked says yes or no. */
  answerSwap: (swapId: string, yes: boolean) => Promise<void>;
  withdrawSwap: (swapId: string) => Promise<void>;
  // Stage 5B: treasurer
  /** Money in, banked. Resolves to the entry's id. */
  recordCredit: (input: CreditInput) => Promise<string>;
  /** Money out, waiting for two approvals (bank fees are paid straight away). Resolves to the entry's id. */
  recordDebit: (input: DebitInput) => Promise<string>;
  approveDebit: (entryId: string) => Promise<void>;
  payDebit: (entryId: string, paidOn: string) => Promise<void>;
  voidEntry: (entryId: string, reason: string) => Promise<void>;
  /** Puts a confirmed fee payment in the ledger as CR-001. */
  addFeePayment: (paymentId: string) => Promise<void>;
  setOpening: (chapterId: string | null, fy: number, amountCents: number) => Promise<void>;
  setCashFloat: (fy: number, amountCents: number) => Promise<void>;
  saveBudget: (chapterId: string | null, fy: number, lines: Partial<Record<LedgerCode, number>>) => Promise<void>;
  /** Approves a budget by a carried board (or NEC) vote, and locks it (13.4). */
  approveBudget: (chapterId: string | null, fy: number, voteId: string) => Promise<void>;
  reopenBudget: (chapterId: string | null, fy: number) => Promise<void>;
  /** Presents a month's Treasurer's Report to members (13.8). `month` is its first day. */
  presentReport: (month: string) => Promise<void>;
  // Stage 5D: board and admin
  /** Writes up a conduct matter on a member's record (6.5, 6.6, 6.9). Resolves to the record's id. */
  recordConduct: (input: ConductInput) => Promise<string>;
  /** Keeps a record past its 12 months for a stated reason, or lets it go again (until null). */
  holdConduct: (recordId: string, until: string | null, reason: string) => Promise<void>;
  removeConduct: (recordId: string) => Promise<void>;
  /** The member's own appeal, inside 7 days (formal) or 14 days of written notice (internal). */
  lodgeAppeal: (recordId: string, grounds: string) => Promise<void>;
  setHearing: (recordId: string, panelIds: string[], hearingOn: string) => Promise<void>;
  decideAppeal: (recordId: string, outcome: AppealOutcome, note: string) => Promise<void>;
  withdrawAppeal: (recordId: string) => Promise<void>;
  /** Proposes an item for the board's yes (CR-005). Resolves to the item's id. */
  proposeMerch: (input: MerchInput) => Promise<string>;
  decideMerch: (itemId: string, yes: boolean, reason: string) => Promise<void>;
  closeMerch: (itemId: string) => Promise<void>;
  orderMerch: (input: OrderInput) => Promise<string>;
  decideOrder: (orderId: string, yes: boolean, reason: string) => Promise<void>;
  /** The treasurer marks an approved order paid; it goes in the ledger as CR-005. Resolves to the entry's id. */
  payOrder: (orderId: string, paidOn: string) => Promise<string>;
  handOver: (orderId: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
  /** The NEC asks the chapters for a national contribution, split by voting members. Resolves to its id. */
  proposeContribution: (input: ContributionInput) => Promise<string>;
  /** Puts a chapter board's carried or lost vote against the contribution. */
  decideContribution: (contributionId: string, chapterId: string, voteId: string) => Promise<void>;
  withdrawContribution: (contributionId: string) => Promise<void>;
  /** Proposes a new chapter with its plan and founders (11.4). Resolves to the proposal's id. */
  proposeChapter: (input: ChapterInput) => Promise<string>;
  /** Puts the NEC's vote against the proposal. Resolves to the new chapter's id when it carried. */
  settleChapter: (proposalId: string, voteId: string) => Promise<string | null>;
  withdrawChapter: (proposalId: string) => Promise<void>;
  // Stage 5C: document library
  /** Adds a document to the library. Resolves to its id. */
  createDocument: (input: DocumentInput) => Promise<string>;
  /** Publishes the next version. `expected` is the version number the editor opened on (0 for none). Resolves to its id. */
  publishDocumentVersion: (documentId: string, expected: number, input: VersionInput) => Promise<string>;
  recordDocumentApproval: (versionId: string, approval: ApprovalInput) => Promise<void>;
  markDocumentReviewed: (documentId: string) => Promise<void>;
  signDocument: (versionId: string) => Promise<void>;
  /** A version's text. Live loads it on first open and keeps it for the session. */
  loadDocumentBody: (versionId: string) => Promise<string>;
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
