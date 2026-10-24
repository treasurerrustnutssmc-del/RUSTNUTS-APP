// What every screen can ask of the club data, whichever source is behind it:
// the demo members in memory, or the live Supabase database.

import { createContext, useContext } from 'react';
import type { AccessLevel } from '../domain/access';
import type {
  Bike,
  BikeRegistration,
  ClubData,
  CrewRole,
  EmergencyContact,
  LicenceClass,
  Member,
  MemberPrivate,
  MemberStatus,
  PositionRole,
  RsvpAnswer,
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
  /** The club data couldn't be loaded for whoever is signed in (live mode). Retry with refresh(). */
  loadError: string | null;
  /** A refresh failed while data is still on screen (live mode). */
  refreshError: string | null;

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
  /** Puts a member in a spot on a ride's crew (yourself, or anyone if you manage the ride). They are then going. */
  setCrew: (rideId: string, memberId: string, role: CrewRole) => Promise<void>;
  /** Takes a member off a ride's crew (yourself, or anyone if you manage the ride). */
  leaveCrew: (rideId: string, memberId: string) => Promise<void>;
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
  crew: [],
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
