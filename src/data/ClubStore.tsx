// The app's data and actions. Right now it runs on made-up demo data held in memory.
// Every action checks the same rules the database enforces, so swapping in the live
// Supabase connection later doesn't change what anyone is allowed to do.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  accessLevel,
  canApprove,
  canAssignRole,
  canManageMember,
  type AccessLevel,
} from '../domain/access';
import { todayIso } from '../domain/dates';
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
import { BOARD_ROLES, NATIONAL_ROLES, ROLE_LABEL } from '../domain/labels';
import { DEMO_DATA } from './demoData';

export class NotAllowedError extends Error {}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

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

interface ClubContextValue {
  data: ClubData;
  me: Member | null;
  level: AccessLevel;
  today: string;
  isDemo: boolean;
  signInAs: (memberId: string | null) => void;
  signOut: () => void;
  submitApplication: (input: ApplicationInput) => void;
  approveMember: (memberId: string, status: MemberStatus) => void;
  declineMember: (memberId: string) => void;
  setMemberStatus: (memberId: string, status: MemberStatus) => void;
  updateProfile: (input: ProfileInput) => void;
  updatePrivate: (input: PrivateInput) => void;
  saveBike: (bike: Omit<Bike, 'memberId' | 'id'> & { id: string | null }, reg: Omit<BikeRegistration, 'bikeId'>) => void;
  removeBike: (bikeId: string) => void;
  saveContact: (contact: Omit<EmergencyContact, 'memberId' | 'id'> & { id: string | null }) => void;
  removeContact: (contactId: string) => void;
  appoint: (memberId: string, chapterId: string | null, role: PositionRole) => void;
  endPosition: (positionId: string) => void;
}

const ClubContext = createContext<ClubContextValue | null>(null);

export function ClubProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ClubData>(DEMO_DATA);
  const [meId, setMeId] = useState<string | null>(null);
  const today = todayIso();

  const me = useMemo(() => data.members.find((m) => m.id === meId) ?? null, [data.members, meId]);
  const level = accessLevel(me, data.positions);

  const requireMe = useCallback((): Member => {
    if (!me) throw new NotAllowedError('Sign in first.');
    return me;
  }, [me]);

  const findMember = useCallback(
    (id: string) => {
      const m = data.members.find((x) => x.id === id);
      if (!m) throw new Error('That member no longer exists.');
      return m;
    },
    [data.members],
  );

  const patchMember = (id: string, patch: Partial<Member>) =>
    setData((d) => ({ ...d, members: d.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  const value: ClubContextValue = {
    data,
    me,
    level,
    today,
    isDemo: true,

    signInAs: (memberId) => setMeId(memberId),
    signOut: () => setMeId(null),

    submitApplication: (input) => {
      const id = newId('m');
      const member: Member = {
        id,
        chapterId: input.chapterId,
        fullName: input.fullName.trim(),
        roadName: input.roadName.trim() || null,
        status: input.status,
        approval: 'pending',
        joinedOn: null,
        patchedOn: null,
        fngStartedOn: null,
        bio: null,
        sharePhone: false,
        appliedOn: today,
      };
      const priv: MemberPrivate = {
        memberId: id,
        email: input.email.trim() || null,
        phone: input.phone.trim() || null,
        licenceClass: null,
        licenceExpiry: null,
        firstAidExpiry: null,
        introducedBy: input.introducedBy.trim() || null,
        applicationNote: input.note.trim() || null,
      };
      setData((d) => {
        const bikes = [...d.bikes];
        if (input.bike && input.bike.make.trim() && input.bike.model.trim()) {
          bikes.push({
            id: newId('b'),
            memberId: id,
            make: input.bike.make.trim(),
            model: input.bike.model.trim(),
            year: input.bike.year,
            nickname: null,
            isProject: false,
          });
        }
        return { ...d, members: [...d.members, member], privates: [...d.privates, priv], bikes };
      });
      setMeId(id);
    },

    approveMember: (memberId, status) => {
      const target = findMember(memberId);
      if (!canApprove(me, target, data.positions)) {
        throw new NotAllowedError('Only that chapter’s board can approve this applicant.');
      }
      patchMember(memberId, {
        approval: 'approved',
        status,
        joinedOn: target.joinedOn ?? today,
        fngStartedOn: status === 'fng' ? target.fngStartedOn ?? today : target.fngStartedOn,
        patchedOn: status === 'full' || status === 'nomad' ? target.patchedOn ?? today : target.patchedOn,
      });
    },

    declineMember: (memberId) => {
      const target = findMember(memberId);
      if (!canApprove(me, target, data.positions)) {
        throw new NotAllowedError('Only that chapter’s board can decline this applicant.');
      }
      patchMember(memberId, { approval: 'declined' });
    },

    setMemberStatus: (memberId, status) => {
      const target = findMember(memberId);
      if (!canManageMember(me, target, data.positions)) {
        throw new NotAllowedError('Only that chapter’s board can change this, and never for themselves.');
      }
      patchMember(memberId, {
        status,
        fngStartedOn: status === 'fng' ? target.fngStartedOn ?? today : target.fngStartedOn,
        patchedOn: status === 'full' || status === 'nomad' ? target.patchedOn ?? today : target.patchedOn,
      });
    },

    updateProfile: (input) => {
      const self = requireMe();
      if (!input.fullName.trim()) throw new Error('Your name can’t be blank.');
      patchMember(self.id, {
        fullName: input.fullName.trim(),
        roadName: input.roadName?.trim() || null,
        bio: input.bio?.trim() || null,
        sharePhone: input.sharePhone,
      });
    },

    updatePrivate: (input) => {
      const self = requireMe();
      setData((d) => ({
        ...d,
        privates: d.privates.map((p) =>
          p.memberId === self.id
            ? {
                ...p,
                email: input.email?.trim() || null,
                phone: input.phone?.trim() || null,
                licenceClass: input.licenceClass,
                licenceExpiry: input.licenceExpiry,
                firstAidExpiry: input.firstAidExpiry,
              }
            : p,
        ),
      }));
    },

    saveBike: (bike, reg) => {
      const self = requireMe();
      if (!bike.make.trim() || !bike.model.trim()) throw new Error('Add the make and model.');
      if (bike.id) {
        const existing = data.bikes.find((b) => b.id === bike.id);
        if (!existing || existing.memberId !== self.id) throw new NotAllowedError('You can only edit your own bikes.');
      }
      setData((d) => {
        const id = bike.id ?? newId('b');
        const record: Bike = { ...bike, id, memberId: self.id, make: bike.make.trim(), model: bike.model.trim() };
        const bikes = bike.id ? d.bikes.map((b) => (b.id === id ? record : b)) : [...d.bikes, record];
        const registrations = [
          ...d.registrations.filter((r) => r.bikeId !== id),
          { bikeId: id, rego: reg.rego?.trim().toUpperCase() || null, regoExpiry: reg.regoExpiry },
        ];
        return { ...d, bikes, registrations };
      });
    },

    removeBike: (bikeId) => {
      const self = requireMe();
      const bike = data.bikes.find((b) => b.id === bikeId);
      if (!bike || bike.memberId !== self.id) throw new NotAllowedError('You can only remove your own bikes.');
      setData((d) => {
        return {
          ...d,
          bikes: d.bikes.filter((b) => b.id !== bikeId),
          registrations: d.registrations.filter((r) => r.bikeId !== bikeId),
        };
      });
    },

    saveContact: (contact) => {
      const self = requireMe();
      if (!contact.name.trim() || !contact.phone.trim()) throw new Error('Add their name and number.');
      if (contact.id) {
        const existing = data.emergencyContacts.find((c) => c.id === contact.id);
        if (!existing || existing.memberId !== self.id) throw new NotAllowedError('You can only edit your own contacts.');
      }
      setData((d) => {
        const id = contact.id ?? newId('e');
        const record: EmergencyContact = {
          id,
          memberId: self.id,
          name: contact.name.trim(),
          relationship: contact.relationship.trim(),
          phone: contact.phone.trim(),
        };
        const emergencyContacts = contact.id
          ? d.emergencyContacts.map((c) => (c.id === id ? record : c))
          : [...d.emergencyContacts, record];
        return { ...d, emergencyContacts };
      });
    },

    removeContact: (contactId) => {
      const self = requireMe();
      const c = data.emergencyContacts.find((x) => x.id === contactId);
      if (!c || c.memberId !== self.id) throw new NotAllowedError('You can only remove your own contacts.');
      setData((d) => ({ ...d, emergencyContacts: d.emergencyContacts.filter((x) => x.id !== contactId) }));
    },

    appoint: (memberId, chapterId, role) => {
      const target = findMember(memberId);
      const national = NATIONAL_ROLES.includes(role);
      const seatChapter = national ? null : chapterId;
      if (target.approval !== 'approved') throw new Error('Approve them first.');
      if (!canAssignRole(me, seatChapter, data.positions)) {
        throw new NotAllowedError(
          national ? 'Only the NEC hands out national roles.' : 'Only that chapter’s board can appoint here.',
        );
      }
      const seatTaken =
        (BOARD_ROLES.includes(role) || national) &&
        data.positions.some((p) => p.endedOn === null && p.role === role && p.chapterId === seatChapter);
      if (seatTaken) throw new Error(`There’s already a sitting ${ROLE_LABEL[role]}. End their term first.`);
      setData((d) => ({
        ...d,
        positions: [
          ...d.positions,
          { id: newId('p'), memberId, chapterId: seatChapter, role, startedOn: today, endedOn: null },
        ],
      }));
    },

    endPosition: (positionId) => {
      const pos = data.positions.find((p) => p.id === positionId);
      if (!pos) return;
      if (!canAssignRole(me, pos.chapterId, data.positions)) {
        throw new NotAllowedError('You can’t end this position.');
      }
      setData((d) => ({
        ...d,
        positions: d.positions.map((p) => (p.id === positionId ? { ...p, endedOn: today } : p)),
      }));
    },
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}

export function useClub(): ClubContextValue {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error('useClub must be used inside ClubProvider');
  return ctx;
}
