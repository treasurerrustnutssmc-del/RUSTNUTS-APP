// Family view: what the database hands an approved Family person, so the demo shows exactly what
// the live build can. See docs/superpowers/specs/2026-10-29-family-view-design.md and
// docs/superpowers/specs/2026-11-03-family-chat-design.md.

import type { ClubData, Member, MemberStatus } from '../domain/types';
import { EMPTY_DATA } from './clubContext';

/** Someone in the Family chat as Family see them: names, chapter and status, nothing else. Mirrors
 *  public.family_chat_people. */
export function chatPerson(p: { id: string; chapterId: string; roadName: string | null; firstName: string; status: MemberStatus }): Member {
  return {
    id: p.id, chapterId: p.chapterId, fullName: p.firstName, roadName: p.roadName, status: p.status, approval: 'approved',
    joinedOn: null, patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false,
  };
}

/** The chapters, the ride calendar (no answers), their own records and the names in the Family chat.
 *  Everything else stays empty. */
export function forFamily(data: ClubData, me: Member): ClubData {
  const bikes = data.bikes.filter((b) => b.memberId === me.id);
  return {
    ...EMPTY_DATA,
    chapters: data.chapters,
    members: data.members.filter((m) => m.id === me.id),
    privates: data.privates.filter((p) => p.memberId === me.id),
    bikes,
    registrations: data.registrations.filter((r) => bikes.some((b) => b.id === r.bikeId)),
    emergencyContacts: data.emergencyContacts.filter((c) => c.memberId === me.id),
    rides: data.rides,
    ridesSyncedAt: data.ridesSyncedAt,
    // Live: family_chat_people. Demo: anyone approved could have posted there.
    chatPeople:
      data.chatPeople ??
      data.members
        .filter((m) => m.approval === 'approved' && m.id !== me.id)
        .map((m) => chatPerson({ id: m.id, chapterId: m.chapterId, roadName: m.roadName, firstName: m.fullName.split(' ')[0], status: m.status })),
  };
}
