// Demo build: made-up members held in memory. Every action checks the same rules the
// database enforces, so the demo behaves like the real thing.

import React, { useMemo, useState } from 'react';
import { accessLevel, canApprove, canAssignRole, canManageMember } from '../domain/access';
import { todayIso } from '../domain/dates';
import { isChapterless } from '../domain/labels';
import type { Bike, ClubData, EmergencyContact, Member, MemberPrivate } from '../domain/types';
import {
  checkAppoint,
  ClubContext,
  NotAllowedError,
  validateBike,
  validateContact,
  type ClubContextValue,
} from './clubContext';
import { DEMO_DATA } from './demoData';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export function DemoClubProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ClubData>(DEMO_DATA);
  const [meId, setMeId] = useState<string | null>(null);
  const today = todayIso();

  const me = useMemo(() => data.members.find((m) => m.id === meId) ?? null, [data.members, meId]);
  const level = accessLevel(me, data.positions);

  const requireMe = (): Member => {
    if (!me) throw new NotAllowedError('Sign in first.');
    return me;
  };
  const findMember = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    if (!m) throw new Error('That member no longer exists.');
    return m;
  };
  const patchMember = (id: string, patch: Partial<Member>) =>
    setData((d) => ({ ...d, members: d.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  const value: ClubContextValue = {
    mode: 'demo',
    isDemo: true,
    loading: false,
    data,
    me,
    level,
    today,
    authEmail: null,
    needsApplication: false,

    signInAs: (memberId) => setMeId(memberId),
    sendCode: async () => {
      throw new Error('No emails go out in the demo. Pick someone below instead.');
    },
    verifyCode: async () => {
      throw new Error('No emails go out in the demo. Pick someone below instead.');
    },
    signOut: async () => setMeId(null),
    refresh: async () => {},

    submitApplication: async (input) => {
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
        onHiatus: false,
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

    approveMember: async (memberId, status) => {
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

    declineMember: async (memberId) => {
      const target = findMember(memberId);
      if (!canApprove(me, target, data.positions)) {
        throw new NotAllowedError('Only that chapter’s board can decline this applicant.');
      }
      patchMember(memberId, { approval: 'declined' });
    },

    setMemberStatus: async (memberId, status) => {
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

    updateProfile: async (input) => {
      const self = requireMe();
      if (!input.fullName.trim()) throw new Error('Your name can’t be blank.');
      patchMember(self.id, {
        fullName: input.fullName.trim(),
        roadName: input.roadName?.trim() || null,
        bio: input.bio?.trim() || null,
        sharePhone: input.sharePhone,
      });
    },

    updatePrivate: async (input) => {
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

    saveBike: async (bike, reg) => {
      const self = requireMe();
      const invalid = validateBike(bike);
      if (invalid) throw new Error(invalid);
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

    removeBike: async (bikeId) => {
      const self = requireMe();
      const bike = data.bikes.find((b) => b.id === bikeId);
      if (!bike || bike.memberId !== self.id) throw new NotAllowedError('You can only remove your own bikes.');
      setData((d) => ({
        ...d,
        bikes: d.bikes.filter((b) => b.id !== bikeId),
        registrations: d.registrations.filter((r) => r.bikeId !== bikeId),
      }));
    },

    saveContact: async (contact) => {
      const self = requireMe();
      const invalid = validateContact(contact);
      if (invalid) throw new Error(invalid);
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

    removeContact: async (contactId) => {
      const self = requireMe();
      const c = data.emergencyContacts.find((x) => x.id === contactId);
      if (!c || c.memberId !== self.id) throw new NotAllowedError('You can only remove your own contacts.');
      setData((d) => ({ ...d, emergencyContacts: d.emergencyContacts.filter((x) => x.id !== contactId) }));
    },

    appoint: async (memberId, chapterId, role) => {
      const target = findMember(memberId);
      const problem = checkAppoint(me, target, chapterId, role, data);
      if (problem) throw new Error(problem);
      const seatChapter = isChapterless(role) ? null : chapterId;
      setData((d) => ({
        ...d,
        positions: [
          ...d.positions,
          { id: newId('p'), memberId, chapterId: seatChapter, role, startedOn: today, endedOn: null },
        ],
      }));
    },

    endPosition: async (positionId) => {
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
