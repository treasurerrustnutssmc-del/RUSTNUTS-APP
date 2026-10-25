// Core club records. These mirror the Supabase tables in supabase/migrations.

export type MemberStatus =
  | 'introduced' // in the 3-month introduction phase (constitution v4 4.2)
  | 'fng' // trial member
  | 'full' // fully patched
  | 'nomad' // full member living away from an active chapter
  | 'supporter'
  | 'family' // app-only: family who use the app, no Club rights (v4 has no Family category)
  | 'legacy'; // left the club in good standing

export type ApprovalState = 'pending' | 'approved' | 'declined' | 'suspended';

export type PositionRole =
  // Chapter Board (constitution v4 8.1)
  | 'president'
  | 'vice_president'
  | 'secretary'
  | 'treasurer'
  | 'sergeant_at_arms'
  | 'road_captain'
  // Non-Board Club positions (constitution v4 8.2, 8.3)
  | 'officer'
  | 'tail_gunner'
  | 'social_media_officer'
  | 'club_coach'
  | 'ride_committee'
  | 'assistant_tail_gunner'
  // National roles (constitution v4 11.2, 11.3, 11.8)
  | 'nec_chair'
  | 'nec_secretary'
  | 'nec_auditor'
  // Honours: shown on the vest, carry no powers, recorded by the admin
  | 'founder'
  // Stage 3 (lane B): a club position held on top of any rank or other position
  | 'charity_committee';

export type LicenceClass = 'full_open' | 'probationary_open' | 'learner';

export interface Chapter {
  id: string;
  slug: string;
  name: string;
  area: string;
  state: string;
}

export interface Member {
  id: string;
  chapterId: string;
  fullName: string;
  roadName: string | null;
  status: MemberStatus;
  approval: ApprovalState;
  joinedOn: string | null; // ISO date
  patchedOn: string | null;
  fngStartedOn: string | null;
  bio: string | null;
  sharePhone: boolean;
  appliedOn: string | null;
  /** A patched member taking a break: keeps status and patch, flagged as away. */
  onHiatus: boolean;
}

/** Contact and compliance details: the member and their chapter board only. */
export interface MemberPrivate {
  memberId: string;
  email: string | null;
  phone: string | null;
  licenceClass: LicenceClass | null;
  licenceExpiry: string | null;
  firstAidExpiry: string | null;
  introducedBy: string | null;
  applicationNote: string | null;
}

export interface Bike {
  id: string;
  memberId: string;
  make: string;
  model: string;
  year: number | null;
  nickname: string | null;
  isProject: boolean;
}

/** Registration details: the member and their chapter board only. */
export interface BikeRegistration {
  bikeId: string;
  rego: string | null;
  regoExpiry: string | null;
}

export interface EmergencyContact {
  id: string;
  memberId: string;
  name: string;
  relationship: string;
  phone: string;
}

export interface Position {
  id: string;
  memberId: string;
  chapterId: string | null; // null = national role
  role: PositionRole;
  startedOn: string;
  endedOn: string | null;
}

export type RideCategory = 'north' | 'west' | 'club' | 'supported' | 'non_nuts';
export type RsvpAnswer = 'going' | 'maybe' | 'no';

/** A ride from the club calendar. Times are instants (ISO with Z); shown in Melbourne time. */
export interface Ride {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  category: RideCategory;
  cancelledAt: string | null;
}

export interface Rsvp {
  rideId: string;
  memberId: string;
  answer: RsvpAnswer;
  updatedAt: string;
}

/** The positions a ride's crew can hold. Officers have no limit; the others are one per ride. */
export type CrewRole = Extract<PositionRole, 'road_captain' | 'tail_gunner' | 'assistant_tail_gunner' | 'officer'>;

/** One member's spot on one ride's crew. */
export interface CrewSpot {
  rideId: string;
  memberId: string;
  role: CrewRole;
  assignedBy: string | null;
  assignedAt: string;
}

/** A GPX route in the club's library. The file itself stays on the server; this is its summary. */
export interface Route {
  id: string;
  name: string;
  /** The chapter it belongs to, or null for the whole club. */
  chapterId: string | null;
  notes: string;
  distanceM: number;
  /** Total ascent in metres, when the file has elevation. */
  climbM: number | null;
  /** The simplified line for drawing, `[lat, lng]` pairs. */
  line: [number, number][];
  stops: { name: string; lat: number; lng: number }[];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  archivedAt: string | null;
  updatedAt: string;
}

/** The route a ride uses. A ride has at most one. */
export interface RideRoute {
  rideId: string;
  routeId: string;
}

/** The Road Captain's part of a ride's briefing card. A ride has at most one. */
export interface Briefing {
  rideId: string;
  /** Short lines, one hazard each. */
  hazards: string[];
  /** One-off changes to the Road Rules for this ride (constitution 7.10). Empty when none. */
  changes: string;
  notes: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** A member's tap on Got it. It is current while it is at or after the briefing's `updatedAt`. */
export interface BriefingRead {
  rideId: string;
  memberId: string;
  readAt: string;
}

/**
 * One published text of the Road Rules (constitution 7.10). The current version is the highest
 * number. Versions are never edited or removed: a correction is a new version.
 */
export interface RoadRulesVersion {
  number: number;
  body: string;
  /** What changed since the last version. Empty when none. */
  changes: string;
  /** Whether everyone signs again. Version 1 always does. */
  fresh: boolean;
  publishedAt: string;
  publishedBy: string | null;
}

/** A member's latest Road Rules sign-off: one per member, moved on each signing. */
export interface RoadRulesSignoff {
  memberId: string;
  version: number;
  signedAt: string;
}

/** What the Rusty Bus is booked for. */
export type BusPurpose = 'charity_ride' | 'recovery' | 'club_event' | 'other';

/** Waiting (`requested`), Booked (`approved`), Declined or Cancelled. Only Booked ones block days. */
export type BusStatus = 'requested' | 'approved' | 'declined' | 'cancelled';

/**
 * The Rusty Bus (the club van) for whole Melbourne days, first to last (14 days at most). People
 * and rides are null once they've left or been deleted.
 */
export interface BusBooking {
  id: string;
  /** ISO dates, both included. */
  firstDay: string;
  lastDay: string;
  purpose: BusPurpose;
  rideId: string | null;
  driverId: string | null;
  /** Empty when none. */
  notes: string;
  status: BusStatus;
  bookedBy: string | null;
  bookedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Empty when none. */
  declineReason: string;
  cancelledBy: string | null;
  cancelledAt: string | null;
}

export interface ClubData {
  chapters: Chapter[];
  members: Member[];
  privates: MemberPrivate[];
  bikes: Bike[];
  registrations: BikeRegistration[];
  emergencyContacts: EmergencyContact[];
  positions: Position[];
  rides: Ride[];
  rsvps: Rsvp[];
  /** Who is crewing which ride. Missing means none. */
  crew?: CrewSpot[];
  /** The club's route library. Missing means none. */
  routes?: Route[];
  /** Which route each ride uses. Missing means none. */
  rideRoutes?: RideRoute[];
  /** The briefing for each ride that has one. Missing means none. */
  briefings?: Briefing[];
  /** Who has tapped Got it on which ride's briefing. Missing means none. */
  briefingReads?: BriefingRead[];
  /** Every published version of the Road Rules. Missing means none. */
  roadRules?: RoadRulesVersion[];
  /** Each member's latest Road Rules sign-off. Missing means none. */
  roadRulesSignoffs?: RoadRulesSignoff[];
  /** Every Rusty Bus booking, in any status. Missing means none. */
  busBookings?: BusBooking[];
  /** When the live calendar last synced (live mode only). */
  ridesSyncedAt?: string | null;
  // Lane E: notifications
  /** The signed-in member's saved notification settings, or null for the defaults. */
  notificationPrefs?: NotificationPrefs | null;

  // Stage 4: members and money
  checkinSessions?: CheckinSession[];
  attendance?: Attendance[];
  decisions?: MemberDecision[];
  feeRates?: FeeRate[];
  continuationFees?: ContinuationFee[];
  charges?: Charge[];
  payments?: Payment[];
  paymentDetails?: PaymentDetails[];
  // Stage 5: meetings and votes
  meetings?: Meeting[];
  actionItems?: ActionItem[];
  votes?: Vote[];
}

// ---------------------------------------------------------------------------
// Stage 4: members and money (attendance, joining, FNG reviews, fees)
// ---------------------------------------------------------------------------

export type CheckinKind = 'ride' | 'meeting';

/** A check-in opened at a ride or meeting. The code is only ever loaded for people who run it. */
export interface CheckinSession {
  id: string;
  kind: CheckinKind;
  chapterId: string | null; // null = a whole-club ride
  rideId: string | null;
  title: string;
  heldOn: string; // Melbourne date
  openedBy: string | null;
  closedAt: string | null;
  code?: string | null;
}

export interface Attendance {
  sessionId: string;
  memberId: string;
  checkedInAt: string;
  /** Who ticked them off; null when they checked themselves in. */
  markedBy: string | null;
}

export type DecisionKind = 'application' | 'fng_review';
export type DecisionOutcome = 'approved' | 'declined' | 'continue' | 'patch' | 'not_continuing';

/** A vote's tally as the board took it. Any count can be left out. */
export interface Votes {
  for: number | null;
  against: number | null;
  abstained: number | null;
}

/** What the board decided about an applicant or at an FNG review: the member's board only. */
export interface MemberDecision {
  id: string;
  memberId: string;
  kind: DecisionKind;
  atMonths: number | null; // the FNG review slot (6, 9, 12, 15 …)
  outcome: DecisionOutcome;
  status: MemberStatus | null; // what an applicant was let in as
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstained: number | null;
  note: string | null;
  decidedOn: string;
  recordedBy: string | null;
}

export type ChargeKind = 'annual' | 'continuation' | 'other';
export type PaymentMethod = 'payid' | 'bank' | 'cash' | 'card';
export type PaymentState = 'claimed' | 'confirmed' | 'rejected';

/** A chapter's fee for one status in one financial year (fy 2026 = 1 Jul 2026 to 30 Jun 2027). */
export interface FeeRate {
  chapterId: string;
  fy: number;
  status: MemberStatus;
  amountCents: number;
  dueOn: string;
}

export interface ContinuationFee {
  chapterId: string;
  fy: number;
  amountCents: number;
}

/** Something a member owes: the member and their chapter's board only. */
export interface Charge {
  id: string;
  memberId: string;
  chapterId: string;
  fy: number;
  kind: ChargeKind;
  description: string | null;
  amountCents: number;
  dueOn: string;
  createdAt: string;
  waivedAt: string | null;
}

export interface Payment {
  id: string;
  chargeId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  state: PaymentState;
  claimedBy: string | null;
  receiptNo: string | null;
  decidedAt: string | null;
}

/** Where members pay a chapter: shown to approved members. */
export interface PaymentDetails {
  chapterId: string;
  payid: string | null;
  payidName: string | null;
  bsb: string | null;
  accountNo: string | null;
  // Lane E: notifications
  /** The signed-in member's saved notification settings, or null for the defaults. */
  notificationPrefs?: NotificationPrefs | null;
}

// Stage 5: meetings and votes ----------------------------------------------------------------

export type MeetingKind = 'board' | 'general' | 'agm' | 'special' | 'nec';

export interface AgendaItem {
  title: string;
  notes: string | null;
}

/** A chapter's meeting, or the whole club's (chapterId null, run by the NEC). */
export interface Meeting {
  id: string;
  chapterId: string | null;
  kind: MeetingKind;
  title: string;
  startsAt: string; // instant (ISO with Z), shown in Melbourne time
  location: string | null;
  agenda: AgendaItem[];
  /** Draft or approved minutes. Left out for people who don't run the meeting until approved. */
  minutes: string | null;
  minutesApprovedAt: string | null;
  minutesApprovedBy: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
}

export interface ActionItem {
  id: string;
  meetingId: string | null;
  chapterId: string | null;
  title: string;
  ownerId: string;
  dueOn: string | null; // ISO date
  doneOn: string | null;
}

export type Electorate = 'chapter_board' | 'chapter_patched' | 'club_patched' | 'nec';
export type Threshold = 'majority' | 'two_thirds' | 'unanimous';
export type BallotChoice = 'yes' | 'no' | 'abstain';
export type VoteResult = 'carried' | 'lost' | 'no_quorum';

export interface Tally {
  yes: number;
  no: number;
  abstain: number;
}

export interface Vote {
  id: string;
  chapterId: string | null;
  meetingId: string | null;
  /** The member a patch vote is about. */
  subjectMemberId: string | null;
  question: string;
  details: string | null;
  electorate: Electorate;
  threshold: Threshold;
  secret: boolean;
  quorum: number;
  openedAt: string;
  closesAt: string;
  closedAt: string | null;
  result: VoteResult | null;
  castingVote: 'yes' | 'no' | null;
  /** The counts, once the vote has closed. */
  tally: Tally | null;
  /** Who could vote, taken when it opened. */
  electorIds: string[];
  /** Who has voted (never how). */
  votedIds: string[];
  /** How people voted: open votes only, after closing. A secret ballot never carries a member. */
  ballots: { memberId: string | null; choice: BallotChoice }[];
  createdBy: string | null;
}

// Lane E: live ride
/** 'out' is "I've dropped out" (the database keeps the word drop out of its SQL). */
export type AlertKind = 'emergency' | 'out' | 'regroup';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A rider sharing their location on a live ride: their latest fix only, never a trail. */
export interface LiveRider {
  memberId: string;
  name: string;
  leader: boolean;
  position: LatLng | null;
  accuracyM: number | null;
  updatedAt: string | null;
  /** A leader's number, or (for leaders) the number of a rider with an open emergency. */
  phone: string | null;
}

export interface RideAlert {
  id: string;
  rideId: string;
  memberId: string;
  kind: AlertKind;
  /** Road name, or full name. */
  name: string;
  position: LatLng | null;
  /** For leaders: the number of the rider who raised an emergency or dropped out. */
  phone: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** What someone sharing on a live ride can see. Contacts are filled for leaders during an emergency only. */
export interface LiveState {
  rideId: string;
  me: { stopsAt: string } | null;
  riders: LiveRider[];
  alerts: RideAlert[];
  contacts: EmergencyContact[];
}

// Lane E: notifications
/** Which notifications a member wants. No saved row means DEFAULT_PREFS (src/domain/notifications.ts). */
export interface NotificationPrefs {
  rideReminders: boolean;
  rideChanges: boolean;
  newRides: boolean;
  /** Board only: someone in the chapter is waiting for approval. */
  approvals: boolean;
}
