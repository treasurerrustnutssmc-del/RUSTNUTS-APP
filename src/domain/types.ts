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

/** The national seats the NEC votes people into by two-thirds: the Secretary (11.6) and the Auditor (11.8). */
export type NecSeatRole = Extract<PositionRole, 'nec_auditor' | 'nec_secretary'>;

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
  /** Ride planning extras: km on a full tank before the fuel light comes on. Missing or null: not set. */
  rangeKm?: number | null;
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
  /** Who last changed its days or details, and when (Rusty Bus extras). Missing or null: never changed. */
  changedBy?: string | null;
  changedAt?: string | null;
}

/** How many roster places of one status in one chapter nobody has claimed yet. */
export interface RosterTally {
  chapterId: string;
  status: MemberStatus;
  count: number;
}

export interface ClubData extends LedgerData, AdminData, AuditData {
  chapters: Chapter[];
  members: Member[];
  /** Roster places not yet claimed (live mode only). Missing means none. */
  unclaimedRoster?: RosterTally[];
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
  // Ride planning extras. Missing means none.
  ridePlans?: RidePlan[];
  routeRatings?: RouteRating[];
  rideCalls?: RideCall[];
  rideHubs?: RideHub[];
  hubRegistrations?: HubRegistration[];
  crewSwaps?: CrewSwap[];
  // Charity ride sign-ups. Missing means none.
  charityRides?: CharityRide[];
  charitySignups?: CharitySignup[];
  /** The numbers behind each ride's sign-ups, for everyone approved. Missing means count the rows. */
  signupCounts?: SignupCounts[];
  // Lane E: notifications
  /** The signed-in member's saved notification settings, or null for the defaults. */
  notificationPrefs?: NotificationPrefs | null;

  // Stage 4: members and money
  checkinSessions?: CheckinSession[];
  attendance?: Attendance[];
  decisions?: MemberDecision[];
  feeRates?: FeeRate[];
  /** Recorded AGM dates (fees run AGM to AGM). */
  agms?: Agm[];
  charges?: Charge[];
  payments?: Payment[];
  paymentDetails?: PaymentDetails[];
  // Stage 5: meetings and votes
  meetings?: Meeting[];
  actionItems?: ActionItem[];
  votes?: Vote[];
  // Stage 5C: the document library
  documents?: ClubDocument[];
  documentVersions?: DocumentVersion[];
  documentSignoffs?: DocumentSignoff[];
  // Attendance rules and Big 4 rides (constitution v4 4.6, 5.2–5.11)
  /** Rides the NEC has designated Big 4. Missing means none. */
  big4Rides?: Big4Ride[];
  /** Members excused from a meeting or ride. Missing means none. */
  exemptions?: AttendanceExemption[];
  // Big 4 RSVP rules and the 5.5 notice
  /** Members the board excused from 5.4 for one Big 4. Missing means none. */
  big4Waivers?: Big4Waiver[];
  /** 5.5 notices: the member's own, or their chapter's for its board. Missing means none. */
  statusNotices?: StatusNotice[];
  /** Every status change, with the 5.5 notice or the member's request behind it. Missing means none. */
  statusChanges?: StatusChange[];
  // Rusty Bus extras: keys, odometer and running costs. Missing means none.
  busKeys?: BusKeyHandover[];
  busKm?: BusKm[];
  /** Only the costs this person may see: all of them for a bus manager, otherwise their own. */
  busCosts?: BusCost[];
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
  /** A meeting's category, set when it's opened. Null or missing on a meeting means ordinary; rides have none. */
  meetingType?: MeetingType | null;
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

/** The date of a year's Association AGM, which starts that club year. */
export interface Agm {
  year: number;
  heldOn: string;
}

/** A chapter's fee for one status in one club year (fy 2026 = the 2026 AGM to the 2027 AGM). */
export interface FeeRate {
  chapterId: string;
  fy: number;
  status: MemberStatus;
  amountCents: number;
  dueOn: string;
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
  /** Draft or confirmed minutes. Left out for people who don't run the meeting until the draft is shared. */
  minutes: string | null;
  /** When the board shared the draft with members (10.8). Missing means not shared. */
  minutesSharedAt?: string | null;
  /** When the board confirmed the minutes (shown as "confirmed"; the field keeps its first name). */
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
  /** The member a patch, reinstatement, national seat or removal vote is about. */
  subjectMemberId: string | null;
  /**
   * The role a vote about a member names: the national seat a two-thirds NEC vote would fill (11.6,
   * 11.8), or the chapter role its holder faces removal from (9.3). Null for every other vote.
   */
  subjectRole: PositionRole | null;
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
  /** Notifications play the Harley rev (live ride alerts never do). */
  revSound: boolean;
  /** New messages in the chats they're in. */
  chatMessages: boolean;
}

// Stage 5B: treasurer ---------------------------------------------------------------------------

export type LedgerCode =
  | 'CR-001' | 'CR-002' | 'CR-003' | 'CR-004' | 'CR-005' | 'CR-006' | 'CR-007'
  | 'DB-001' | 'DB-002' | 'DB-003' | 'DB-004' | 'DB-005' | 'DB-006' | 'DB-007';

/** A debit waits for two approvals, then is paid; a credit is paid (banked) when recorded. */
export type EntryState = 'awaiting' | 'approved' | 'paid' | 'void';

/** One line of the club's books, in a chapter's fund or the Club fund (chapterId null). */
export interface LedgerEntry {
  id: string;
  chapterId: string | null;
  code: LedgerCode;
  description: string;
  amountCents: number;
  /** Credits: when the money came in. */
  receivedOn: string | null;
  /** When it was banked, or a debit paid. Null until then. */
  entryOn: string | null;
  payeeMemberId: string | null;
  payeeName: string | null;
  /** The Stage 4 fee payment it came from. */
  paymentId: string | null;
  state: EntryState;
  recordedBy: string | null;
  recordedAt: string;
  updatedAt: string;
  voidReason: string | null;
  voidedBy: string | null;
  approvals: { memberId: string; approvedAt: string }[];
}

/** A fund's balance on 1 July of a financial year. */
export interface FundOpening {
  chapterId: string | null;
  fy: number;
  amountCents: number;
}

export interface CashFloat {
  fy: number;
  amountCents: number;
}

/** A fund's budget for a year: cents per code. Locked once a carried vote approves it (13.4). */
export interface Budget {
  chapterId: string | null;
  fy: number;
  lines: Partial<Record<LedgerCode, number>>;
  approvedVoteId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /** Last saved or reopened. The approving vote has to close after it (13.4). */
  updatedAt: string;
}

/** A month the treasurer has presented to members (13.8). `month` is its first day. */
export interface TreasurerReport {
  month: string;
  presentedAt: string;
  presentedBy: string | null;
}

/** The monthly Treasurer's Report, laid out like the club's own. */
export interface MonthReport {
  month: string;
  openingCents: number;
  credits: { code: LedgerCode; cents: number }[];
  creditTotal: number;
  debits: { code: LedgerCode; cents: number }[];
  debitTotal: number;
  /** Each fund's balance at the end of the month, keyed 'club' or by chapter id. */
  funds: Record<string, number>;
  totalCents: number;
  floatCents: number;
  bankCents: number;
  /** The last change to any entry in the month. */
  lastChangeAt: string | null;
}

/** A Treasurer's Report for a meeting: any period inside one financial year, with the treasurer's notes. */
export interface MeetingReport {
  id: string;
  fromOn: string;
  toOn: string;
  notes: string;
  savedBy: string | null;
  savedAt: string;
  /** Null while it's a draft. Presented reports are locked and every member can read them (13.8). */
  presentedBy: string | null;
  presentedAt: string | null;
}

export interface FundMovement {
  openingCents: number;
  receiptsCents: number;
  paymentsCents: number;
  closingCents: number;
}

/** A meeting report's figures, worked out from the paid lines dated in the period. */
export interface MeetingFigures {
  from: string;
  to: string;
  /** Keyed 'club' or by chapter id. */
  funds: Record<string, FundMovement>;
  credits: { code: LedgerCode; cents: number }[];
  debits: { code: LedgerCode; cents: number }[];
  receiptsCents: number;
  paymentsCents: number;
  /** Total funds (bank plus float) as the period starts and at its end. */
  openingCents: number;
  closingCents: number;
  floatCents: number;
  /** Each calendar month the period touches, cut to the period. */
  months: { month: string; from: string; to: string; receiptsCents: number; paymentsCents: number }[];
  lineCount: number;
  lastChangeAt: string | null;
}

export interface LedgerData {
  ledger?: LedgerEntry[];
  fundOpenings?: FundOpening[];
  cashFloats?: CashFloat[];
  budgets?: Budget[];
  treasurerReports?: TreasurerReport[];
  /** Live only: presented months worked out by the database, for members who can't read the lines. */
  reportTotals?: MonthReport[];
  meetingReports?: MeetingReport[];
  /** Live only: each meeting report's figures, worked out by the database. */
  meetingTotals?: (MeetingFigures & { id: string })[];
}

// Stage 5D: conduct records, merch, national contributions and new chapters ----------------------

/**
 * Internal decisions (vest 6.9, ride safety 7.9, attendance 5.5, other) get a 14-day review;
 * formal Association outcomes (reprimand, suspension, expulsion, 14.4) a 7-day appeal.
 */
export type ConductKind = 'vest' | 'ride_safety' | 'attendance' | 'other' | 'reprimand' | 'suspension' | 'expulsion';

/** Set aside deletes the record (6.9). A formal appeal is only confirmed (upheld) or set aside (revoked). */
export type AppealOutcome = 'confirmed' | 'varied' | 'set_aside';

/** The member's review or appeal of one record. */
export interface ConductAppeal {
  lodgedOn: string;
  lodgedBy: string | null;
  grounds: string;
  /** The three hearing it, once set up. */
  panelIds: string[];
  hearingOn: string | null;
  outcome: AppealOutcome | null;
  /** Empty when none. */
  outcomeNote: string;
  decidedOn: string | null;
  decidedBy: string | null;
  withdrawnOn: string | null;
}

/** A short factual record of a conduct decision. It deletes itself (src/domain/conduct.ts). */
export interface ConductRecord {
  id: string;
  memberId: string;
  /** The member's chapter when it was recorded. */
  chapterId: string;
  kind: ConductKind;
  summary: string;
  /** Empty when none. */
  rule: string;
  decidedOn: string;
  /** When written notice was given: the decision date for formal outcomes. */
  noticeOn: string;
  suspendedUntil: string | null;
  recordedBy: string | null;
  recordedAt: string;
  /** Kept through this date for an active matter (6.9). */
  holdUntil: string | null;
  /** Empty when none. */
  holdReason: string;
  appeal: ConductAppeal | null;
}

export type MerchStatus = 'proposed' | 'on_sale' | 'declined' | 'closed';

/** A chapter's merch (or the whole club's, chapterId null). Designs need board approval (15.1). */
export interface MerchItem {
  id: string;
  chapterId: string | null;
  name: string;
  /** Empty when none. */
  details: string;
  /** Empty means one size. */
  sizes: string[];
  priceCents: number;
  /** Carries the patch: Full and Nomad members only. */
  patchedOnly: boolean;
  status: MerchStatus;
  proposedBy: string | null;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Empty when none. */
  declineReason: string;
}

export type OrderStatus = 'waiting' | 'approved' | 'paid' | 'handed_over' | 'declined' | 'cancelled';

export interface MerchOrder {
  id: string;
  itemId: string;
  memberId: string;
  /** Null for a one-size item. */
  size: string | null;
  qty: number;
  /** The price when ordered. */
  unitCents: number;
  /** Empty when none. */
  note: string;
  status: OrderStatus;
  orderedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Empty when none. */
  declineReason: string;
  paidOn: string | null;
  /** The CR-005 ledger line it made. */
  ledgerEntryId: string | null;
  handedOverOn: string | null;
}

export type ContributionStatus = 'proposed' | 'approved' | 'not_approved' | 'withdrawn';

/** A chapter's part of a national contribution, fixed when it was proposed (13.6). */
export interface ContributionShare {
  chapterId: string;
  votingMembers: number;
  cents: number;
}

/** A chapter board's decision, by its closed vote (13.6 "each decision minuted"). */
export interface ContributionDecision {
  chapterId: string;
  yes: boolean;
  voteId: string;
  recordedBy: string | null;
  recordedAt: string;
}

/** A national event or project budget the NEC asks the chapters to fund (13.6). */
export interface Contribution {
  id: string;
  title: string;
  purpose: string;
  totalCents: number;
  status: ContributionStatus;
  proposedBy: string | null;
  proposedAt: string;
  settledAt: string | null;
  shares: ContributionShare[];
  decisions: ContributionDecision[];
}

/** The parts a new chapter's written proposal covers (12.1). */
export type ChapterPart = 'location' | 'membership' | 'leadership' | 'budget' | 'operations';

export type ProposalStatus = 'proposed' | 'approved' | 'not_approved' | 'withdrawn';

/** A proposed new chapter (12.1). Approval creates it. */
export interface ChapterProposal {
  id: string;
  name: string;
  area: string;
  state: string;
  plan: Record<ChapterPart, string>;
  founderIds: string[];
  presidentId: string;
  saaId: string;
  status: ProposalStatus;
  proposedBy: string | null;
  proposedAt: string;
  voteId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** The chapter it became. */
  chapterId: string | null;
}

export interface AdminData {
  /** Conduct records the viewer may see, still kept. Missing means none. */
  conduct?: ConductRecord[];
  merchItems?: MerchItem[];
  merchOrders?: MerchOrder[];
  contributions?: Contribution[];
  chapterProposals?: ChapterProposal[];
}

// ---------------------------------------------------------------------------
// Stage 5C: the document library (constitution v4 2.2, 15.3 to 15.7)
// ---------------------------------------------------------------------------

/** Registered Rules and Constitution are club-wide; a policy or procedure can be a chapter's. */
export type DocumentKind = 'registered_rules' | 'constitution' | 'policy' | 'procedure';

/** Who approved a version (15.5). */
export type ApprovingBody = 'association_general_meeting' | 'association_committee' | 'full_members' | 'nec' | 'chapter_board';

/** One controlled document. Its versions hold the text. */
export interface ClubDocument {
  id: string;
  /** Null for a club-wide document. */
  chapterId: string | null;
  kind: DocumentKind;
  title: string;
  asksSignOff: boolean;
  /** Months between reviews, or null for no review cycle. */
  reviewMonths: number | null;
  /** The last review marked without a change, as an ISO date. */
  reviewedOn: string | null;
  createdBy: string | null;
  createdAt: string;
}

/**
 * One published text of a document. Versions are never edited: a correction is a new version.
 * The three approval facts are all set or all null (not recorded yet).
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  number: number;
  label: string;
  /** The text. Null in live until it's been loaded for reading. */
  body: string | null;
  /** Empty when none. */
  whatChanged: string;
  freshSignOff: boolean;
  approvingBody: ApprovingBody | null;
  approvedOn: string | null;
  commencesOn: string | null;
  /** Null for an imported version. */
  publishedBy: string | null;
  publishedAt: string;
}

/** A member's sign-off on one version. Signing again moves the date. */
export interface DocumentSignoff {
  versionId: string;
  documentId: string;
  memberId: string;
  signedAt: string;
}

// ---------------------------------------------------------------------------
// Attendance rules, Big 4 rides and terms (constitution v4 4.6, 5.2–5.11, 9.2)
// ---------------------------------------------------------------------------

/** A ride the NEC designated, ahead of time, as a Big 4 (5.11). chapterId null = every chapter. */
export interface Big4Ride {
  rideId: string;
  chapterId: string | null;
  designatedBy: string | null;
  designatedAt: string;
}

/** What a meeting check-in counts towards: ordinary monthly meetings, special or annual meetings, or other events. */
export type MeetingType = 'ordinary' | 'special' | 'event';

/** A member the board excused from one check-in (4.12, 5.3, 5.11): it drops out of their count. */
export interface AttendanceExemption {
  sessionId: string;
  memberId: string;
  reason: string;
  grantedBy: string | null;
  grantedAt: string;
}

/** The grounds 5.4 lets the board excuse a member from its meetings rule on. */
export type Big4Ground = 'work' | 'family' | 'health' | 'injury' | 'distance';

/** A member the board excused from 5.4 for one Big 4, so they can say Going. */
export interface Big4Waiver {
  rideId: string;
  memberId: string;
  ground: Big4Ground;
  grantedBy: string | null;
  grantedAt: string;
}

export type NoticeAbout = 'attendance' | 'dues';
export type NoticeOutcome = 'withdrawn' | 'decided';

/**
 * A 5.5 notice: before proposing a change in internal status, the member gets the record, the
 * proposed consequence and at least 14 days to explain, correct an error or ask for an exemption
 * or payment arrangement.
 */
export interface StatusNotice {
  id: string;
  memberId: string;
  /** The member's chapter when it was given. */
  chapterId: string;
  about: NoticeAbout;
  record: string;
  proposal: string;
  givenOn: string;
  respondBy: string;
  givenBy: string | null;
  /** Empty when they haven't replied. */
  response: string;
  respondedAt: string | null;
  /** Null while open. */
  outcome: NoticeOutcome | null;
  /** Empty when none. */
  outcomeNote: string;
  closedOn: string | null;
  closedBy: string | null;
}

/**
 * A status change the board made, as the database records it. A move to Supporter follows a decided
 * 5.5 notice (noticeId) unless the board recorded that the member asked for it (byRequest).
 */
export interface StatusChange {
  id: string;
  memberId: string;
  /** The member's chapter at the time. */
  chapterId: string;
  fromStatus: MemberStatus;
  toStatus: MemberStatus;
  byRequest: boolean;
  noticeId: string | null;
  changedBy: string | null;
  changedOn: string;
  changedAt: string;
}

// Ride planning extras --------------------------------------------------------------------------

export type StopKind = 'fuel' | 'coffee' | 'lunch' | 'regroup' | 'other';

/** One stop on a ride's plan. km is how far along the route; time is 24-hour HH:MM. */
export interface PlanStop {
  kind: StopKind;
  name: string;
  km: number | null;
  time: string | null;
}

/** The RC's plan of stops for a ride. A ride has at most one. */
export interface RidePlan {
  rideId: string;
  /** In km order, stops without a km after those with one. */
  stops: PlanStop[];
  updatedAt: string;
  updatedBy: string | null;
}

/** A member's stars for a route. One each; rating again replaces it. */
export interface RouteRating {
  routeId: string;
  memberId: string;
  stars: number;
  /** Empty when none. */
  comment: string;
  ratedAt: string;
}

/** Off, Postponed, or Back on (which counts as no call). */
export type RideCallState = 'off' | 'postponed' | 'on';

/** The writer's word on a ride, apart from the club calendar. A ride has at most one. */
export interface RideCall {
  rideId: string;
  state: RideCallState;
  /** Empty when none. */
  reason: string;
  /** Postponed only: the new day, when one was given. */
  newDay: string | null;
  calledBy: string | null;
  calledAt: string;
}

/** Registrations and accommodation for an overnight or big ride (the Big 4, the Not Dead Yet Run). */
export interface RideHub {
  rideId: string;
  /** Only FNG, Full and Nomad members can register (Supporters can't join Club-only rides). */
  membersOnly: boolean;
  /** The last day to register, when there is one. */
  closesOn: string | null;
  /** How many places the group booking has, when it's limited. */
  beds: number | null;
  /** Empty when none. */
  accommodation: string;
  notes: string;
  updatedBy: string | null;
  updatedAt: string;
}

export type HubStaying = 'group' | 'own' | 'camping' | 'day';

/** A member's registration. A withdrawn one keeps its row. */
export interface HubRegistration {
  rideId: string;
  memberId: string;
  staying: HubStaying;
  pillion: boolean;
  /** Empty when none. */
  shareWith: string;
  notes: string;
  registeredAt: string;
  withdrawnAt: string | null;
}

export type SwapState = 'asked' | 'accepted' | 'declined' | 'withdrawn';

/** A crew member's ask for someone to take their spot, or trade when the other holds one. */
export interface CrewSwap {
  id: string;
  rideId: string;
  askedBy: string;
  role: CrewRole;
  askedTo: string;
  /** The spot the person asked held when asked (a trade), or null. */
  theirRole: CrewRole | null;
  /** Empty when none. */
  note: string;
  state: SwapState;
  askedAt: string;
  answeredAt: string | null;
}

// Charity ride sign-ups

/** A ride raising money for a cause, taking sign-ups for riders, guests and helpers. No payments yet. */
export interface CharityRide {
  rideId: string;
  /** Who the ride is raising money for. */
  cause: string;
  /** Empty when none. */
  about: string;
  /** The last day to sign up, when there is one. */
  closesOn: string | null;
  /** People on bikes the ride can take (riders, pillions and guests), when it's limited. */
  places: number | null;
  /** Helper jobs people can pick, in order. */
  jobs: string[];
  updatedBy: string | null;
  updatedAt: string;
}

/** A member's sign-up. A withdrawn one keeps its row. */
/**
 * A ride's hub registrations and charity sign-ups by the numbers (withdrawn ones left out), as
 * signup_counts() hands them to members who can't see the rows themselves.
 */
export interface SignupCounts {
  rideId: string;
  hubRiders: number;
  hubPillions: number;
  hubGroup: number;
  hubOwn: number;
  hubCamping: number;
  hubDay: number;
  /** Group beds taken: riders staying with the group and their pillions. */
  hubGroupBeds: number;
  charityRiding: number;
  charityPillions: number;
  charityGuests: number;
  charityHelping: number;
  charityPeople: number;
}

export interface CharitySignup {
  rideId: string;
  memberId: string;
  riding: boolean;
  pillion: boolean;
  /** Friends coming along who aren't in the app. */
  guests: number;
  /** Empty when none. */
  guestNames: string;
  /** The helper job picked, or null. */
  job: string | null;
  /** Empty when none. */
  notes: string;
  signedAt: string;
  withdrawnAt: string | null;
}

// The National Auditor (constitution v4, 11.8) ---------------------------------------------------

/** The records 11.8 names. */
export type AuditArea = 'policy' | 'membership' | 'attendance' | 'event_funds' | 'bank' | 'transactions' | 'controls';

/** "May request relevant information" or "issue written correction requests" (11.8). */
export type AuditRequestKind = 'information' | 'correction';

/** The Auditor's written request to one chapter's board, or to the NEC (chapterId null). */
export interface AuditRequest {
  id: string;
  chapterId: string | null;
  kind: AuditRequestKind;
  area: AuditArea;
  title: string;
  details: string;
  dueOn: string | null;
  /** The line of the books it's about, if any. */
  ledgerEntryId: string | null;
  raisedBy: string | null;
  raisedAt: string;
  /** The board's (or the NEC's) written answer; it can be updated until the request is closed. */
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeNote: string | null;
}

/** A findings report: a draft only the Auditor sees, then issued to the NEC and every board. */
export interface AuditReport {
  id: string;
  title: string;
  fromOn: string;
  toOn: string;
  findings: string;
  recommendations: string | null;
  writtenBy: string | null;
  savedAt: string;
  issuedAt: string | null;
}

export interface AuditData {
  auditRequests?: AuditRequest[];
  auditReports?: AuditReport[];
}

// ---------------------------------------------------------------------------
// Rusty Bus extras: keys, odometer and running costs
// ---------------------------------------------------------------------------

/** What a running cost was for. */
export type BusCostKind = 'fuel' | 'service' | 'repairs' | 'tyres' | 'rego' | 'insurance' | 'tolls' | 'cleaning' | 'other';

/** The bus keys passing to someone. The newest names who has them now. */
export interface BusKeyHandover {
  id: string;
  /** Null once they've left the club. */
  toId: string | null;
  /** Empty when none. */
  note: string;
  loggedBy: string | null;
  loggedAt: string;
}

/** An odometer reading in whole km on a day. A struck-out one stays, and counts for nothing. */
export interface BusKm {
  id: string;
  km: number;
  readOn: string;
  bookingId: string | null;
  /** Empty when none. */
  note: string;
  loggedBy: string | null;
  loggedAt: string;
  struckBy: string | null;
  struckAt: string | null;
}

/** Money spent on the bus on a day. A struck-out one stays, and counts for nothing. */
export interface BusCost {
  id: string;
  spentOn: string;
  kind: BusCostKind;
  amountCents: number;
  /** Fuel only, to two decimals, or null. */
  litres: number | null;
  bookingId: string | null;
  /** Empty when none. */
  note: string;
  loggedBy: string | null;
  loggedAt: string;
  struckBy: string | null;
  struckAt: string | null;
}
