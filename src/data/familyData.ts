// Family view: what the database hands an approved Family person, so the demo shows exactly what
// the live build can. See docs/superpowers/specs/2026-10-29-family-view-design.md.

import type { ClubData, Member } from '../domain/types';
import { EMPTY_DATA } from './clubContext';

/** The chapters, the ride calendar (no answers) and their own records. Everything else stays empty. */
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
  };
}
