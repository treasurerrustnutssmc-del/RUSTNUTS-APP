// Demo build: made-up members held in memory. Every action goes through demoActions, which
// applies the same rules the database enforces (checked by src/data/parity.test.ts).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accessLevel } from '../domain/access';
import { melbourneDate } from '../domain/rides';
import type { ClubData } from '../domain/types';
import { ClubContext, type ClubContextValue } from './clubContext';
import * as business from './businessActions';
import * as planning from './planningActions'; // Ride planning extras
import * as charity from './charityActions'; // Charity ride sign-ups
import * as busExtras from './busExtrasActions'; // Rusty Bus extras
import * as act from './demoActions';
import { DEMO_DATA, DEMO_ROUTE_GPX, demoTodayRide } from './demoData';
import { bindDemoLive } from './liveRideSource';
import * as s4 from './demoStage4';
import * as attendanceRules from './demoAttendance';
import * as ledger from './ledgerActions';
import * as admin from './adminActions'; // Stage 5D
import * as docs from './documentActions';
import { forFamily } from './familyData'; // Family view
import * as audit from './auditActions'; // National Auditor

export function DemoClubProvider({ children }: { children: React.ReactNode }) {
  // Lane E: live ride. The demo gains a ride that's on right now, so live mode can be tried.
  const [data, setData] = useState<ClubData>(() => ({ ...DEMO_DATA, rides: [...DEMO_DATA.rides, demoTodayRide()] }));
  const [meId, setMeId] = useState<string | null>(null);
  // The routes' GPX files, by route id, apart from the club data as the database keeps them.
  const routeFiles = useRef(new Map(Object.entries(DEMO_ROUTE_GPX)));
  const today = melbourneDate(new Date().toISOString()); // the club's day, wherever the phone is

  const me = useMemo(() => data.members.find((m) => m.id === meId) ?? null, [data.members, meId]);
  const level = accessLevel(me, data.positions);
  // Family view: Family see only what the database would hand them.
  const shown = useMemo(() => (level === 'family' && me ? forFamily(data, me) : data), [level, me, data]);
  useEffect(() => bindDemoLive(() => ({ data, me })), [data, me]);
  const ctx: act.DemoCtx = { data, me, today };
  // Saving the minutes and then sharing or confirming them happens in one press, so the second
  // step has to build on the first, not on what was rendered.
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  const fresh = (): act.DemoCtx => ({ ...ctx, data: latest.current });
  const keep = (next: ClubData) => {
    latest.current = next;
    setData(next);
  };
  const refresh = useCallback(async () => {}, []);

  const value: ClubContextValue = {
    mode: 'demo',
    isDemo: true,
    loading: false,
    data: shown,
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
    // Ends the way signing out does, so store review mode (which signs out to the real sign-in) works the same.
    deleteMyAccount: async () => {
      setData(act.deleteMyAccount(ctx));
      await value.signOut();
    },
    refresh,

    submitApplication: async (input) => {
      const result = act.apply(ctx, input);
      setData(result.data);
      setMeId(result.id);
    },
    approveMember: async (memberId, status) => setData(act.approve(ctx, memberId, status)),
    declineMember: async (memberId) => setData(act.decline(ctx, memberId)),
    setMemberStatus: async (memberId, status, byRequest) => setData(act.setStatus(ctx, memberId, status, byRequest ?? false)),
    saveProfile: async (profile, priv) => setData(act.saveProfile(ctx, profile, priv)),
    saveBike: async (bike, reg) => keep(act.saveBike(fresh(), bike, reg).data),
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
    saveMinutes: async (id, text) => keep(business.saveMinutes(fresh(), id, text)),
    shareMinutes: async (id) => keep(business.shareMinutes(fresh(), id)),
    approveMinutes: async (id) => keep(business.approveMinutes(fresh(), id)),
    saveActionItem: async (input) => setData(business.saveActionItem(ctx, input).data),
    setActionDone: async (id, done) => setData(business.setActionDone(ctx, id, done)),
    openVote: async (input) => {
      const result = business.openVote(ctx, input);
      setData(result.data);
      return result.id;
    },
    castBallot: async (voteId, choice) => setData(business.castBallot(ctx, voteId, choice)),
    closeVote: async (voteId, casting) => setData(business.closeVote(ctx, voteId, casting)),
    // Stage 4
    openCheckin: async (input) => {
      const result = s4.openCheckin(ctx, input);
      setData(result.data);
      return result.id;
    },
    checkinCode: async (sessionId) => s4.checkinCode(ctx, sessionId),
    checkIn: async (code) => {
      const result = s4.checkIn(ctx, code);
      setData(result.data);
      return result.id;
    },
    markAttendance: async (sessionId, memberId, present) => setData(s4.markAttendance(ctx, sessionId, memberId, present)),
    closeCheckin: async (sessionId) => setData(s4.closeCheckin(ctx, sessionId)),
    designateBig4: async (rideId, chapterId) => setData(attendanceRules.designateBig4(ctx, rideId, chapterId)),
    undesignateBig4: async (rideId) => setData(attendanceRules.undesignateBig4(ctx, rideId)),
    setExemption: async (sessionId, memberId, reason) => setData(attendanceRules.setExemption(ctx, sessionId, memberId, reason)),
    // Big 4 RSVP rules and the 5.5 notice
    setBig4Waiver: async (rideId, memberId, ground) => setData(attendanceRules.setBig4Waiver(ctx, rideId, memberId, ground)),
    giveStatusNotice: async (memberId, input) => {
      const result = attendanceRules.giveStatusNotice(ctx, memberId, input);
      setData(result.data);
      return result.id;
    },
    respondToNotice: async (noticeId, response) => setData(attendanceRules.respondToNotice(ctx, noticeId, response)),
    closeStatusNotice: async (noticeId, outcome, note) => setData(attendanceRules.closeStatusNotice(ctx, noticeId, outcome, note)),
    decideApplication: async (memberId, status, votes, note) => setData(s4.decideApplication(ctx, memberId, status, votes, note)),
    recordFngReview: async (memberId, atMonths, outcome, votes, note) =>
      setData(s4.recordFngReview(ctx, memberId, atMonths, outcome, votes, note)),
    setFeeRate: async (chapterId, fy, status, amountCents, dueOn) => setData(s4.setFeeRate(ctx, chapterId, fy, status, amountCents, dueOn)),
    setPaymentDetails: async (details) => setData(s4.setPaymentDetails(ctx, details)),
    raiseFees: async (chapterId, fy) => {
      const result = s4.raiseFees(ctx, chapterId, fy);
      setData(result.data);
      return result.count;
    },
    recordAgm: async (heldOn) => setData(s4.recordAgm(ctx, heldOn)),
    raiseCharge: async (memberId, description, amountCents, dueOn) => setData(s4.raiseCharge(ctx, memberId, description, amountCents, dueOn)),
    waiveCharge: async (chargeId) => setData(s4.waiveCharge(ctx, chargeId)),
    claimPayment: async (chargeId, amountCents, paidOn, method, reference) =>
      setData(s4.claimPayment(ctx, chargeId, amountCents, paidOn, method, reference)),
    recordPayment: async (chargeId, amountCents, paidOn, method, reference) =>
      setData(s4.recordPayment(ctx, chargeId, amountCents, paidOn, method, reference)),
    confirmPayment: async (paymentId) => setData(s4.confirmPayment(ctx, paymentId)),
    rejectPayment: async (paymentId) => setData(s4.rejectPayment(ctx, paymentId)),
    setCrew: async (rideId, memberId, role) => setData(act.setCrew(ctx, rideId, memberId, role)),
    leaveCrew: async (rideId, memberId) => setData(act.leaveCrew(ctx, rideId, memberId)),
    saveRoute: async (input) => {
      const result = act.saveRoute(ctx, input);
      if (input.gpx !== null) routeFiles.current.set(result.id, act.storedGpx(input.gpx));
      setData(result.data);
      return result.id;
    },
    archiveRoute: async (routeId) => setData(act.archiveRoute(ctx, routeId)),
    setRideRoute: async (rideId, routeId) => setData(act.setRideRoute(ctx, rideId, routeId)),
    routeGpx: async (routeId) => act.routeGpx(ctx, routeFiles.current, routeId),
    saveBriefing: async (rideId, input, seen) => setData(act.saveBriefing(ctx, rideId, input, seen)),
    readBriefing: async (rideId, seen) => setData(act.readBriefing(ctx, rideId, seen)),
    publishRoadRules: async (input, seen) => setData(act.publishRoadRules(ctx, input, seen)),
    signRoadRules: async (version) => setData(act.signRoadRules(ctx, version)),
    bookBus: async (input) => {
      const result = act.bookBus(ctx, input);
      setData(result.data);
      return result.id;
    },
    decideBus: async (bookingId, yes, reason) => setData(act.decideBus(ctx, bookingId, yes, reason)),
    cancelBus: async (bookingId) => setData(act.cancelBus(ctx, bookingId)),
    // Rusty Bus extras
    changeBus: async (bookingId, input) => keep(busExtras.changeBus(fresh(), bookingId, input)),
    handBusKeys: async (toId, note) => keep(busExtras.handBusKeys(fresh(), toId, note).data),
    logBusKm: async (input) => keep(busExtras.logBusKm(fresh(), input).data),
    logBusCost: async (input) => keep(busExtras.logBusCost(fresh(), input).data),
    strikeBusKm: async (id) => keep(busExtras.strikeBusKm(fresh(), id)),
    strikeBusCost: async (id) => keep(busExtras.strikeBusCost(fresh(), id)),
    // Ride planning extras
    setBikeRange: async (bikeId, rangeKm) => keep(planning.setBikeRange(fresh(), bikeId, rangeKm)),
    saveRidePlan: async (rideId, stops, seen) => keep(planning.saveRidePlan(fresh(), rideId, stops, seen)),
    rateRoute: async (routeId, stars, comment) => keep(planning.rateRoute(fresh(), routeId, stars, comment)),
    callRide: async (rideId, state, reason, newDay) => keep(planning.callRide(fresh(), rideId, state, reason, newDay)),
    saveHub: async (rideId, input) => keep(planning.saveHub(fresh(), rideId, input)),
    registerHub: async (rideId, input) => keep(planning.registerHub(fresh(), rideId, input)),
    withdrawHub: async (rideId) => keep(planning.withdrawHub(fresh(), rideId)),
    // Charity ride sign-ups
    saveCharity: async (rideId, input) => keep(charity.saveCharity(fresh(), rideId, input)),
    signUpCharity: async (rideId, input) => keep(charity.signUpCharity(fresh(), rideId, input)),
    withdrawCharity: async (rideId) => keep(charity.withdrawCharity(fresh(), rideId)),
    askSwap: async (rideId, toId, note) => {
      const result = planning.askSwap(fresh(), rideId, toId, note);
      keep(result.data);
      return result.id;
    },
    answerSwap: async (swapId, yes) => keep(planning.answerSwap(fresh(), swapId, yes)),
    withdrawSwap: async (swapId) => keep(planning.withdrawSwap(fresh(), swapId)),
    // Lane E: notifications
    saveNotificationPrefs: async (prefs) => setData((d) => ({ ...d, notificationPrefs: prefs })),
    // Stage 5B: treasurer
    recordCredit: async (input) => {
      const result = ledger.recordCredit(ctx, input);
      setData(result.data);
      return result.id;
    },
    recordDebit: async (input) => {
      const result = ledger.recordDebit(ctx, input);
      setData(result.data);
      return result.id;
    },
    approveDebit: async (id) => setData(ledger.approveDebit(ctx, id)),
    payDebit: async (id, paidOn) => setData(ledger.payDebit(ctx, id, paidOn)),
    voidEntry: async (id, reason) => setData(ledger.voidEntry(ctx, id, reason)),
    addFeePayment: async (paymentId) => setData(ledger.addFeePayment(ctx, paymentId).data),
    setOpening: async (chapterId, fy, amountCents) => setData(ledger.setOpening(ctx, chapterId, fy, amountCents)),
    setCashFloat: async (fy, amountCents) => setData(ledger.setCashFloat(ctx, fy, amountCents)),
    saveBudget: async (chapterId, fy, lines) => setData(ledger.saveBudget(ctx, chapterId, fy, lines)),
    approveBudget: async (chapterId, fy, voteId) => setData(ledger.approveBudget(ctx, chapterId, fy, voteId)),
    reopenBudget: async (chapterId, fy) => setData(ledger.reopenBudget(ctx, chapterId, fy)),
    presentReport: async (month) => setData(ledger.presentReport(ctx, month)),
    saveMeetingReport: async (id, input) => {
      const result = ledger.saveMeetingReport(ctx, id, input);
      setData(result.data);
      return result.id;
    },
    presentMeetingReport: async (id) => setData(ledger.presentMeetingReport(ctx, id)),
    deleteMeetingReport: async (id) => setData(ledger.deleteMeetingReport(ctx, id)),
    // Stage 5D: board and admin
    recordConduct: async (input) => {
      const result = admin.recordConduct(ctx, input);
      setData(result.data);
      return result.id;
    },
    holdConduct: async (id, until, reason) => setData(admin.holdConduct(ctx, id, until, reason)),
    removeConduct: async (id) => setData(admin.removeConduct(ctx, id)),
    lodgeAppeal: async (id, grounds) => setData(admin.lodgeAppeal(ctx, id, grounds)),
    setHearing: async (id, panelIds, hearingOn) => setData(admin.setHearing(ctx, id, panelIds, hearingOn)),
    decideAppeal: async (id, outcome, note) => setData(admin.decideAppeal(ctx, id, outcome, note)),
    withdrawAppeal: async (id) => setData(admin.withdrawAppeal(ctx, id)),
    proposeMerch: async (input) => {
      const result = admin.proposeMerch(ctx, input);
      setData(result.data);
      return result.id;
    },
    decideMerch: async (id, yes, reason) => setData(admin.decideMerch(ctx, id, yes, reason)),
    closeMerch: async (id) => setData(admin.closeMerch(ctx, id)),
    orderMerch: async (input) => {
      const result = admin.orderMerch(ctx, input);
      setData(result.data);
      return result.id;
    },
    decideOrder: async (id, yes, reason) => setData(admin.decideOrder(ctx, id, yes, reason)),
    payOrder: async (id, paidOn) => {
      const result = admin.payOrder(ctx, id, paidOn);
      setData(result.data);
      return result.id;
    },
    handOver: async (id) => setData(admin.handOver(ctx, id)),
    cancelOrder: async (id) => setData(admin.cancelOrder(ctx, id)),
    proposeContribution: async (input) => {
      const result = admin.proposeContribution(ctx, input);
      setData(result.data);
      return result.id;
    },
    decideContribution: async (id, chapterId, voteId) => setData(admin.decideContribution(ctx, id, chapterId, voteId)),
    withdrawContribution: async (id) => setData(admin.withdrawContribution(ctx, id)),
    proposeChapter: async (input) => {
      const result = admin.proposeChapter(ctx, input);
      setData(result.data);
      return result.id;
    },
    settleChapter: async (id, voteId) => {
      const result = admin.settleChapter(ctx, id, voteId);
      setData(result.data);
      return result.chapterId;
    },
    withdrawChapter: async (id) => setData(admin.withdrawChapter(ctx, id)),
    // The National Auditor (saving a report then issuing it happens in one press, so build on the latest)
    raiseAuditRequest: async (input) => {
      const r = audit.raiseAuditRequest(fresh(), input);
      keep(r.data);
      return r.id;
    },
    answerAuditRequest: async (id, answer) => keep(audit.answerAuditRequest(fresh(), id, answer)),
    closeAuditRequest: async (id, note) => keep(audit.closeAuditRequest(fresh(), id, note)),
    saveAuditReport: async (input) => {
      const r = audit.saveAuditReport(fresh(), input);
      keep(r.data);
      return r.id;
    },
    issueAuditReport: async (id) => keep(audit.issueAuditReport(fresh(), id)),
    deleteAuditReport: async (id) => keep(audit.deleteAuditReport(fresh(), id)),
    renewAuditor: async () => keep(audit.renewAuditor(fresh())),
    // Stage 5C: document library
    createDocument: async (input) => {
      const result = docs.createDocument(ctx, input);
      setData(result.data);
      return result.id;
    },
    publishDocumentVersion: async (documentId, expected, input) => {
      const result = docs.publishDocumentVersion(ctx, documentId, expected, input);
      setData(result.data);
      return result.id;
    },
    recordDocumentApproval: async (versionId, approval) => setData(docs.recordDocumentApproval(ctx, versionId, approval)),
    markDocumentReviewed: async (documentId) => setData(docs.markDocumentReviewed(ctx, documentId)),
    signDocument: async (versionId) => setData(docs.signDocument(ctx, versionId)),
    loadDocumentBody: async (versionId) => (ctx.data.documentVersions ?? []).find((v) => v.id === versionId)?.body ?? '',
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
