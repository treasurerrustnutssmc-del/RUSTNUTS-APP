// Core club records. These mirror the Supabase tables in supabase/migrations.

export type MemberStatus =
  | 'introduced' // in the 3-month introduction phase (constitution 3.2)
  | 'fng' // trial member
  | 'full' // fully patched
  | 'nomad' // full member living away from an active chapter
  | 'supporter'
  | 'family';

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
  // National Executive Committee roles (constitution 13, 15.5)
  | 'nec_chair'
  | 'nec_secretary'
  | 'nec_auditor';

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

export interface ClubData {
  chapters: Chapter[];
  members: Member[];
  privates: MemberPrivate[];
  bikes: Bike[];
  registrations: BikeRegistration[];
  emergencyContacts: EmergencyContact[];
  positions: Position[];
}
