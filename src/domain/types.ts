// Core club records. These mirror the Supabase tables in supabase/migrations.

export type MemberStatus =
  | 'introduced' // in the 3-month introduction phase (constitution 3.2)
  | 'fng' // trial member
  | 'full' // fully patched
  | 'nomad' // full member living away from an active chapter
  | 'supporter'
  | 'family'
  | 'legacy'; // left the club in good standing

export type ApprovalState = 'pending' | 'approved' | 'declined' | 'suspended';

export type PositionRole =
  // Executive board (constitution 9.1)
  | 'president'
  | 'vice_president'
  | 'secretary'
  | 'treasurer'
  | 'sergeant_at_arms'
  | 'road_captain'
  // Non-board club positions (constitution 11)
  | 'officer'
  | 'tail_gunner'
  | 'social_media_officer'
  | 'club_coach'
  | 'ride_committee'
  | 'assistant_tail_gunner'
  // National Executive Committee roles (constitution 13, 15.5)
  | 'nec_chair'
  | 'nec_secretary'
  | 'nec_auditor'
  // Honours: shown on the vest, carry no powers, recorded by the admin
  | 'founder';

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
  /** When the live calendar last synced (live mode only). */
  ridesSyncedAt?: string | null;

  // Stage 4: members and money
  checkinSessions?: CheckinSession[];
  attendance?: Attendance[];
  decisions?: MemberDecision[];
  feeRates?: FeeRate[];
  continuationFees?: ContinuationFee[];
  charges?: Charge[];
  payments?: Payment[];
  paymentDetails?: PaymentDetails[];
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

/** What the board decided about an applicant or at an FNG review: the member's board and themselves only. */
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
