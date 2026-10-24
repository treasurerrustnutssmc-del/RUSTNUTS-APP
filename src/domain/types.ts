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
  // Stage 5: meetings and votes
  meetings?: Meeting[];
  actionItems?: ActionItem[];
  votes?: Vote[];
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
