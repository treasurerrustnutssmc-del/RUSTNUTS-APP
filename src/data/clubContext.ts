// What every screen can ask of the club data, whichever source is behind it:
// the demo members in memory, or the live Supabase database.

import { createContext, useContext } from 'react';
import { canAssignRole, type AccessLevel } from '../domain/access';
import { BOARD_ROLES, NATIONAL_ROLES, ROLE_LABEL } from '../domain/labels';
import type {
  Bike,
  BikeRegistration,
  ClubData,
  EmergencyContact,
  LicenceClass,
  Member,
  MemberPrivate,
  MemberStatus,
  PositionRole,
} from '../domain/types';

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
  updateProfile: (input: ProfileInput) => Promise<void>;
  updatePrivate: (input: PrivateInput) => Promise<void>;
  saveBike: (bike: BikeInput, reg: RegoInput) => Promise<void>;
  removeBike: (bikeId: string) => Promise<void>;
  saveContact: (contact: ContactInput) => Promise<void>;
  removeContact: (contactId: string) => Promise<void>;
  appoint: (memberId: string, chapterId: string | null, role: PositionRole) => Promise<void>;
  endPosition: (positionId: string) => Promise<void>;
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
};

/** Plain-English checks shared by both sources, so mistakes get a clear message before the server says no. */
export function checkAppoint(
  me: Member | null,
  target: Member,
  chapterId: string | null,
  role: PositionRole,
  data: ClubData,
): string | null {
  const national = NATIONAL_ROLES.includes(role);
  const seatChapter = national ? null : chapterId;
  if (target.approval !== 'approved') return 'Approve them first.';
  if (!canAssignRole(me, seatChapter, data.positions)) {
    return national ? 'Only the NEC hands out national roles.' : 'Only that chapter’s board can appoint here.';
  }
  const seatTaken =
    (BOARD_ROLES.includes(role) || national) &&
    data.positions.some((p) => p.endedOn === null && p.role === role && p.chapterId === seatChapter);
  if (seatTaken) return `There’s already a sitting ${ROLE_LABEL[role]}. End their term first.`;
  return null;
}

export function validateBike(bike: BikeInput): string | null {
  if (!bike.make.trim() || !bike.model.trim()) return 'Add the make and model.';
  return null;
}

export function validateContact(contact: ContactInput): string | null {
  if (!contact.name.trim() || !contact.phone.trim()) return 'Add their name and number.';
  return null;
}
