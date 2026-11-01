// Test-only (not part of the app build). A small club for the Stage 4 rule tests: West and North,
// a West board, a treasurer, the NEC, members, an applicant and an FNG.

import type { CheckinSession, ClubData, Member, Position, Ride } from './types';

export const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'west', fullName: `${id} Rider`, roadName: null, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: '2024-01-01',
  onHiatus: false, ...over,
});

const seat = (id: string, memberId: string, chapterId: string | null, role: Position['role']): Position => ({
  id, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});

export const ride = (id: string, over: Partial<Ride> = {}): Ride => ({
  id, title: 'Coffee run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: null, allDay: false, location: null,
  notes: null, category: 'west', cancelledAt: null, source: 'feed', website: true, ...over,
});

export const session = (id: string, over: Partial<CheckinSession> = {}): CheckinSession => ({
  id, kind: 'meeting', chapterId: 'west', rideId: null, title: 'Club meeting', heldOn: '2026-10-24',
  openedBy: 'sec', closedAt: null, code: 'RN2026', ...over,
});

export function club(over: Partial<ClubData> = {}): ClubData {
  return {
    chapters: [
      { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
      { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
    ],
    members: [
      member('sec'), // West Secretary (board)
      member('tre'), // West Treasurer (board)
      member('rider'),
      member('northsec', { chapterId: 'north' }),
      member('chair', { chapterId: 'north' }),
      member('auditor', { chapterId: 'north' }),
      member('applicant', { status: 'introduced', approval: 'pending', joinedOn: null, appliedOn: '2026-07-01' }),
      member('supporterapp', { status: 'supporter', approval: 'pending', joinedOn: null, appliedOn: '2026-10-01' }),
      member('fng', { status: 'fng', fngStartedOn: '2026-04-24' }),
      member('legacy', { status: 'legacy' }),
    ],
    privates: [],
    bikes: [],
    registrations: [],
    emergencyContacts: [],
    positions: [
      seat('p-sec', 'sec', 'west', 'secretary'),
      seat('p-tre', 'tre', 'west', 'treasurer'),
      seat('p-northsec', 'northsec', 'north', 'secretary'),
      seat('p-chair', 'chair', null, 'nec_chair'),
      seat('p-auditor', 'auditor', null, 'nec_auditor'),
    ],
    rides: [ride('r-west'), ride('r-club', { category: 'club' }), ride('r-off', { cancelledAt: '2026-11-01T00:00:00.000Z' })],
    rsvps: [],
    checkinSessions: [],
    attendance: [],
    decisions: [],
    feeRates: [],
    charges: [],
    payments: [],
    paymentDetails: [],
    ...over,
  };
}

export const who = (data: ClubData, id: string): Member => data.members.find((m) => m.id === id)!;
