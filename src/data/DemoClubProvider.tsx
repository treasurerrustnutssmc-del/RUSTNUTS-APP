// Demo build: made-up members held in memory. Every action goes through demoActions, which
// applies the same rules the database enforces (checked by src/data/parity.test.ts).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { accessLevel } from '../domain/access';
import { todayIso } from '../domain/dates';
import type { ClubData } from '../domain/types';
import { ClubContext, type ClubContextValue } from './clubContext';
import * as business from './businessActions';
import * as act from './demoActions';
import { DEMO_DATA, demoTodayRide } from './demoData';
import { bindDemoLive } from './liveRideSource';

export function DemoClubProvider({ children }: { children: React.ReactNode }) {
  // Lane E: live ride. The demo gains a ride that's on right now, so live mode can be tried.
  const [data, setData] = useState<ClubData>(() => ({ ...DEMO_DATA, rides: [...DEMO_DATA.rides, demoTodayRide()] }));
  const [meId, setMeId] = useState<string | null>(null);
  const today = todayIso();

  const me = useMemo(() => data.members.find((m) => m.id === meId) ?? null, [data.members, meId]);
  const level = accessLevel(me, data.positions);
  useEffect(() => bindDemoLive(() => ({ data, me })), [data, me]);
  const ctx: act.DemoCtx = { data, me, today };
  const refresh = useCallback(async () => {}, []);

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
    loadError: null,
    refreshError: null,

    signInAs: (memberId) => setMeId(memberId),
    sendCode: async () => {
      throw new Error('No emails go out in the demo. Pick someone below instead.');
    },
    verifyCode: async () => {
      throw new Error('No emails go out in the demo. Pick someone below instead.');
    },
    signOut: async () => setMeId(null),
    refresh,

    submitApplication: async (input) => {
      const result = act.apply(ctx, input);
      setData(result.data);
      setMeId(result.id);
    },
    approveMember: async (memberId, status) => setData(act.approve(ctx, memberId, status)),
    declineMember: async (memberId) => setData(act.decline(ctx, memberId)),
    setMemberStatus: async (memberId, status) => setData(act.setStatus(ctx, memberId, status)),
    saveProfile: async (profile, priv) => setData(act.saveProfile(ctx, profile, priv)),
    saveBike: async (bike, reg) => setData(act.saveBike(ctx, bike, reg).data),
    removeBike: async (bikeId) => setData(act.removeBike(ctx, bikeId)),
    saveContact: async (contact) => setData(act.saveContact(ctx, contact)),
    removeContact: async (contactId) => setData(act.removeContact(ctx, contactId)),
    appoint: async (memberId, chapterId, role) => setData(act.appoint(ctx, memberId, chapterId, role)),
    endPosition: async (positionId) => setData(act.endTerm(ctx, positionId)),
    setRsvp: async (rideId, answer) => setData(act.setRsvp(ctx, rideId, answer)),

    // Stage 5: meetings and votes
    saveMeeting: async (input) => {
      const result = business.saveMeeting(ctx, input);
      setData(result.data);
      return result.id;
    },
    cancelMeeting: async (id) => setData(business.cancelMeeting(ctx, id)),
    saveMinutes: async (id, text) => setData(business.saveMinutes(ctx, id, text)),
    approveMinutes: async (id) => setData(business.approveMinutes(ctx, id)),
    saveActionItem: async (input) => setData(business.saveActionItem(ctx, input).data),
    setActionDone: async (id, done) => setData(business.setActionDone(ctx, id, done)),
    openVote: async (input) => {
      const result = business.openVote(ctx, input);
      setData(result.data);
      return result.id;
    },
    castBallot: async (voteId, choice) => setData(business.castBallot(ctx, voteId, choice)),
    closeVote: async (voteId, casting) => setData(business.closeVote(ctx, voteId, casting)),
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
