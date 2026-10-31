// Live build: the club's Supabase database. Row-level security and the database's own
// actions decide what each person can see and do; the app shows whatever comes back and
// checks the same rules first only so members get a clear message without a round trip.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accessLevel, appointProblem, endTermProblem, renewAuditorProblem } from '../domain/access';
import { readBriefingProblem, saveBriefingProblem } from '../domain/briefings';
import { bookProblem, cancelProblem, changeProblem, decideProblem } from '../domain/bus';
// Rusty Bus extras
import { handKeysProblem, logCostProblem, logKmProblem, roundLitres, strikeCostProblem, strikeKmProblem } from '../domain/busLog';
import { changeBusArgs, handBusKeysArgs, logBusCostArgs, logBusKmArgs, strikeArgs } from './busExtrasLive';
// Ride planning extras
import { rangeProblem } from '../domain/fuel';
import { registerProblem, saveHubProblem, withdrawHubProblem } from '../domain/hubs';
import { saveCharityProblem, signupProblem, withdrawCharityProblem } from '../domain/charity'; // Charity ride sign-ups
import { saveCharityArgs, signUpCharityArgs } from './charityLive'; // Charity ride sign-ups
import { rateProblem } from '../domain/ratings';
import { callProblem } from '../domain/rideCalls';
import { isPlanConflict, savePlanProblem } from '../domain/ridePlan';
import { answerSwapProblem, askSwapProblem, withdrawSwapProblem } from '../domain/swaps';
import {
  askSwapArgs, callRideArgs, rateRouteArgs, registerHubArgs, saveHubArgs, saveRidePlanArgs, setBikeRangeArgs,
} from './planningLive';
import { goingProblem, isRoadRulesVersionRefusal, publishProblem, signProblem } from '../domain/roadRules';
import {
  actionItemProblem,
  approveMinutesProblem,
  cancelMeetingProblem,
  saveMeetingProblem,
  saveMinutesProblem,
  shareMinutesProblem,
  setDoneProblem,
} from '../domain/meetings';
import { crewProblem, leaveProblem } from '../domain/crew';
import { melbourneDate, rsvpProblem } from '../domain/rides';
import { NO_TRACK, readGpx, type GpxSummary } from '../domain/gpx';
import { archiveRouteProblem, NO_ROUTE, rideRouteProblem, saveRouteProblem } from '../domain/routes';
import { castProblem, closeProblem as closeVoteProblem, openVoteProblem } from '../domain/votes';
import type { ClubData, NotificationPrefs } from '../domain/types'; // NotificationPrefs: Lane E
import {
  ClubContext,
  EMPTY_DATA,
  NotAllowedError,
  validateApplicationBike,
  validateBike,
  validateContact,
  type ClubContextValue,
} from './clubContext';
import {
  bookBusArgs,
  cancelBusArgs,
  decideBusArgs,
  loadClub,
  publishRoadRulesArgs,
  readBriefingArgs,
  reloadOnNewerVersion,
  saveBriefingArgs,
  signRoadRulesArgs,
} from './liveData';
// Stage 4
import { canCheckIn, closeProblem, exemptionProblem, markProblem, openCheckinProblem } from '../domain/attendance';
import { big4CrewProblem, big4GoingProblem, big4WaiverProblem, seesBig4Records, designateBig4Problem, undesignateBig4Problem } from '../domain/big4';
import { closeNoticeProblem, giveNoticeProblem, respondProblem } from '../domain/notices';
import {
  claimProblem,
  decidePaymentProblem,
  feeRateProblem,
  paymentDetailsProblem,
  raiseChargeProblem,
  raiseFeesProblem,
  recordPaymentProblem,
  waiveProblem,
} from '../domain/fees';
import { decideApplicationProblem, fngReviewProblem } from '../domain/joining';
import { agmDateProblem, recordAgmProblem } from '../domain/clubYear';
import { forFamily } from './familyData'; // Family view
import { refreshError, sessionView } from './session';
import { friendlyError, supabase } from './supabase';
import { isReviewerCode, isReviewerEmail } from '../domain/reviewer'; // Store review demo
import { appMode } from './reviewMode';
// Lane E: offline
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SUPABASE_URL } from './config';
import { authStorageKeys, createClubCache, isConnectionError, startupUser } from './offlineCache';
// Lane E: notifications
import { completePrefs } from '../domain/notifications'; // Lane E: notifications
import { loadNotificationPrefs, saveNotificationPrefs } from './notificationsApi';
import { forgetThisDevice } from './pushDevice';
import {
  addFeeProblem, approveBudgetProblem, approveProblem, budgetProblem, creditProblem, debitProblem, floatProblem, openingProblem,
  payProblem, presentProblem, reopenBudgetProblem, voidProblem,
} from '../domain/ledger'; // Stage 5B
import { deleteMeetingProblem, meetingProblem, presentMeetingProblem } from '../domain/meetingReport';
import {
  cleanDocumentInput, cleanVersionInput, createDocumentProblem, markReviewedProblem, publishVersionProblem, recordApprovalProblem,
  signDocumentProblem,
} from '../domain/documents'; // Stage 5C
import { loadedBodies } from './documentsLive'; // Stage 5C
// Stage 5D: board and admin
import * as conduct from '../domain/conduct';
import * as merch from '../domain/merch';
import * as national from '../domain/national';
import * as audit from '../domain/audit'; // National Auditor

const clubCache = createClubCache(AsyncStorage);

const deny = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

const ok = <T extends { error: { message?: string; code?: string } | null }>(r: T): T => {
  if (r.error) throw friendlyError(r.error);
  return r;
};

export function LiveClubProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ClubData>(EMPTY_DATA);
  const [userId, setUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  // Whose data is loaded right now ('' = loaded while signed out), and why the last load failed.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const latest = useRef(0);
  const today = melbourneDate(new Date().toISOString()); // the club's day, wherever the phone is
  // Lane E: offline. When the data on screen is the copy saved on the phone, when it was saved.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** Whose data is on screen, the signed-in person, and whether it's the saved copy (read in callbacks). */
  const showing = useRef<string | null>(null);
  const currentUser = useRef<string | null>(null);
  const onSavedCopy = useRef(false);
  const knownPrefs = useRef<NotificationPrefs | null | undefined>(undefined); // Lane E: notifications
  const showSaved = useCallback((uid: string, saved: { data: ClubData; savedAt: string }) => {
    // Lane E: notifications. A copy saved by an older app lacks newer settings (the Harley rev).
    const prefs = completePrefs(saved.data.notificationPrefs);
    knownPrefs.current = prefs;
    setData({ ...saved.data, notificationPrefs: prefs });
    setLoadedFor(uid);
    showing.current = uid;
    onSavedCopy.current = true;
    setSavedAt(saved.savedAt);
  }, []);
  /** Signed out: nothing of theirs stays on the phone or on screen, and no load still running can save it back. */
  const forget = useCallback(() => {
    latest.current++;
    knownPrefs.current = undefined; // Lane E: notifications
    clubCache.clear();
    setData(EMPTY_DATA);
    setLoadedFor(null);
    setSavedAt(null);
    showing.current = null;
    onSavedCopy.current = false;
  }, []);

  /** Loads what this person may see. Only the newest request wins, so a slow old load can't overwrite a newer one. */
  const reload = useCallback(async (uid: string | null) => {
    const ticket = ++latest.current;
    try {
      // Lane E: offline. Opened offline on a login that had run out: renew it before loading, so the
      // load is never made signed out (which would look like someone who hasn't joined).
      if (uid) {
        const { data: s, error } = await supabase().auth.getSession();
        if (s.session?.user.id !== uid) throw error ?? new Error('Sign in first.');
      }
      const fresh = await loadClub(supabase(), !!uid);
      // Lane E: notifications. If the settings can't be read, keep the last known ones (never the
      // defaults, which could turn reminders back on); undefined means not known.
      if (uid) fresh.notificationPrefs = await loadNotificationPrefs(supabase()).catch(() => knownPrefs.current);
      if (uid) knownPrefs.current = fresh.notificationPrefs;
      if (ticket !== latest.current) return;
      // Lane E: offline. Signed out during the load: don't show a signed-out load as theirs.
      if (uid && currentUser.current !== uid) return;
      // Stage 5C: a text loaded while this refresh was in flight must not be dropped by it.
      fresh.documentVersions = (fresh.documentVersions ?? []).map((v) =>
        v.body === null && loadedBodies[v.id] !== undefined ? { ...v, body: loadedBodies[v.id] } : v,
      );
      setData(fresh);
      setLoadedFor(uid ?? '');
      setLoadError(null);
      showing.current = uid ?? '';
      onSavedCopy.current = false;
      setSavedAt(null);
      if (uid && currentUser.current === uid) clubCache.save(uid, fresh, new Date().toISOString());
    } catch (e) {
      if (ticket !== latest.current) return;
      // No signal and nothing of theirs on screen yet: show the copy saved on the phone.
      if (uid && showing.current !== uid && isConnectionError(e as { message?: string })) {
        const saved = await clubCache.load(uid);
        if (ticket !== latest.current) return;
        if (saved) showSaved(uid, saved);
      }
      setLoadError(friendlyError(e as { message?: string }).message);
    }
  }, [showSaved]);

  // Follow the sign-in state, and load whatever this person is allowed to see.
  useEffect(() => {
    const db = supabase();
    let cancelled = false;
    db.auth.getSession().then(async ({ data: s, error }) => {
      if (cancelled) return;
      // Lane E: offline. With no signal and a login that has run out, open as the person whose copy
      // is on the phone, on that copy, until signal comes back.
      const uid = startupUser(s.session?.user.id ?? null, error, await clubCache.lastUser());
      if (cancelled) return;
      setUserId(uid);
      currentUser.current = uid;
      setAuthEmail(s.session?.user.email ?? null);
      // Open on the copy saved on the phone while the fresh load comes in.
      const saved = uid ? await clubCache.load(uid) : null;
      if (cancelled) return;
      if (uid && saved && currentUser.current === uid && showing.current === null) {
        showSaved(uid, saved);
        setStarted(true);
      }
      await reload(uid);
      if (!cancelled) setStarted(true);
    });
    const { data: sub } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      // Lane E: offline. A renewed login matters only when signal is back after opening on the saved copy.
      if (event === 'TOKEN_REFRESHED' && !onSavedCopy.current) return;
      const uid = session?.user.id ?? null;
      if (uid !== currentUser.current) setSavedAt(null);
      currentUser.current = uid;
      setUserId(uid);
      setAuthEmail(session?.user.email ?? null);
      if (!uid) setJustApplied(false);
      if (!uid) forget(); // Lane E: offline
      // Run outside the auth callback, as Supabase recommends.
      setTimeout(() => {
        reload(uid);
      }, 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [reload, showSaved, forget]);

  const me = useMemo(() => data.members.find((m) => m.id === userId) ?? null, [data.members, userId]);
  const loadedForUser = loadedFor === '' ? null : loadedFor;
  const view = sessionView({ userId, loadedFor: loadedForUser, loadError, hasMe: !!me, justApplied });
  // Until this person's own data arrives, treat them as signed out-but-waiting rather than
  // giving them someone else's (or nobody's) access level.
  const visibleMe = view === 'ready' ? me : null;
  const level = accessLevel(visibleMe, data.positions);
  // Family view: the database already trims what Family get; this keeps the app to the same.
  const shown = useMemo(() => (level === 'family' && visibleMe ? forFamily(data, visibleMe) : data), [level, visibleMe, data]);

  const refresh = useCallback(() => reload(userId), [reload, userId]);

  const requireUser = () => {
    if (!userId) throw new NotAllowedError('Sign in first.');
    return userId;
  };
  const after = async () => reload(userId);

  const value: ClubContextValue = {
    mode: 'live',
    isDemo: false,
    loading: !started || view === 'loading',
    data: shown,
    me: visibleMe,
    level,
    today,
    authEmail,
    needsApplication: view === 'needs-application',
    loadError: view === 'error' ? loadError : null,
    refreshError: refreshError(view, loadError),
    savedAt: loadError && isConnectionError({ message: loadError }) ? savedAt : null, // Lane E: offline

    signInAs: () => {},

    sendCode: async (email) => {
      // Store review demo: nothing goes out; the reviewers have the code in their notes.
      if (isReviewerEmail(email)) return;
      const { error } = await supabase().auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) throw friendlyError(error);
    },

    verifyCode: async (email, code) => {
      if (isReviewerEmail(email)) {
        if (!isReviewerCode(code)) throw new Error('That code isn’t right. Check the review notes for it.');
        await appMode.startReview(); // the app swaps over to the demo club by itself
        return;
      }
      const { error } = await supabase().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.replace(/\s/g, ''),
        type: 'email',
      });
      if (error) throw friendlyError(error);
    },

    signOut: async () => {
      await forgetThisDevice(); // Lane E: notifications. While still signed in, so the club allows it.
      forget(); // Lane E: offline
      currentUser.current = null;
      setUserId(null); // Lane E: offline
      setJustApplied(false);
      const { error } = await supabase().auth.signOut();
      // Lane E: offline. With no signal on a login that had run out, Supabase can't sign out and keeps
      // the login, which would sign them back in next time: remove it here.
      if (error) {
        const keys = authStorageKeys(SUPABASE_URL);
        if (Platform.OS === 'web') keys.forEach((k) => globalThis.localStorage?.removeItem(k));
        else await AsyncStorage.multiRemove(keys).catch(() => {});
      }
      reload(null);
      await clubCache.clear(); // Lane E: offline. Again, after anything that finished meanwhile.
    },

    refresh,

    submitApplication: async (input) => {
      requireUser();
      const bikeProblem = validateApplicationBike(input.bike ?? null, today);
      if (bikeProblem) throw new Error(bikeProblem);
      const bike = input.bike && input.bike.make.trim() ? input.bike : null;
      const result = await supabase().rpc('apply_to_join', {
        p_chapter: input.chapterId,
        p_full_name: input.fullName.trim(),
        p_road_name: input.roadName.trim() || undefined,
        p_phone: input.phone.trim() || undefined,
        p_introduced_by: input.introducedBy.trim() || undefined,
        p_note: input.note.trim() || undefined,
        p_status: input.status,
        p_bike_make: bike?.make.trim() || undefined,
        p_bike_model: bike?.model.trim() || undefined,
        p_bike_year: bike?.year ?? undefined,
      });
      // "Already applied" means an earlier try went through but its answer got lost on the way back.
      if (result.error && !/already applied/i.test(result.error.message ?? '')) throw friendlyError(result.error);
      setJustApplied(true);
      await after();
    },

    approveMember: async (memberId, status) => {
      ok(await supabase().rpc('approve_member', { p_member: memberId, p_status: status }));
      await after();
    },

    declineMember: async (memberId) => {
      ok(await supabase().rpc('decline_member', { p_member: memberId }));
      await after();
    },

    setMemberStatus: async (memberId, status, byRequest) => {
      ok(await supabase().rpc('set_member_status', { p_member: memberId, p_status: status, p_by_request: byRequest ?? false }));
      await after();
    },

    saveProfile: async (profile, priv) => {
      requireUser();
      if (!profile.fullName.trim()) throw new Error('Your name can’t be blank.');
      ok(
        await supabase().rpc('save_profile', {
          p_full_name: profile.fullName.trim(),
          p_road_name: profile.roadName?.trim() || null,
          p_bio: profile.bio?.trim() || null,
          p_share_phone: profile.sharePhone,
          p_with_private: !!priv,
          p_email: priv?.email?.trim() || null,
          p_phone: priv?.phone?.trim() || null,
          p_licence_class: priv?.licenceClass ?? null,
          p_licence_expiry: priv?.licenceExpiry ?? null,
          p_first_aid_expiry: priv?.firstAidExpiry ?? null,
        }),
      );
      await after();
    },

    saveBike: async (bike, reg) => {
      requireUser();
      const invalid = validateBike(bike, today);
      if (invalid) throw new Error(invalid);
      ok(
        await supabase().rpc('save_bike', {
          p_bike: bike.id,
          p_make: bike.make.trim(),
          p_model: bike.model.trim(),
          p_year: bike.year,
          p_nickname: bike.nickname?.trim() || null,
          p_is_project: bike.isProject,
          p_rego: reg.rego?.trim() || null,
          p_rego_expiry: reg.regoExpiry,
        }),
      );
      await after();
    },

    removeBike: async (bikeId) => {
      ok(await supabase().rpc('remove_bike', { p_bike: bikeId }));
      await after();
    },

    saveContact: async (contact) => {
      requireUser();
      const invalid = validateContact(contact);
      if (invalid) throw new Error(invalid);
      ok(
        await supabase().rpc('save_contact', {
          p_contact: contact.id,
          p_name: contact.name.trim(),
          p_relationship: contact.relationship.trim(),
          p_phone: contact.phone.trim(),
        }),
      );
      await after();
    },

    removeContact: async (contactId) => {
      ok(await supabase().rpc('remove_contact', { p_contact: contactId }));
      await after();
    },

    appoint: async (memberId, chapterId, role) => {
      const target = data.members.find((m) => m.id === memberId);
      if (!target) throw new Error('That member no longer exists.');
      const problem = appointProblem(visibleMe, target, chapterId, role, data, today);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('appoint_position', { p_member: memberId, p_chapter: chapterId, p_role: role }));
      await after();
    },

    endPosition: async (positionId) => {
      const position = data.positions.find((p) => p.id === positionId);
      if (!position) throw new Error('That position no longer exists.');
      const problem = endTermProblem(visibleMe, position, data, today);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('end_position', { p_position: positionId }));
      await after();
    },

    setRsvp: async (rideId, answer) => {
      const problem =
        rsvpProblem(visibleMe, data.rides.find((r) => r.id === rideId), new Date().toISOString()) ??
        goingProblem(visibleMe, answer, data, today) ??
        big4GoingProblem(visibleMe, rideId, answer, data, today);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('set_rsvp', { p_ride: rideId, p_answer: answer }));
      await after();
    },

    // Stage 5: meetings and votes
    saveMeeting: async (input) => {
      const existing = input.id === null ? null : (data.meetings ?? []).find((x) => x.id === input.id);
      const problem = saveMeetingProblem(visibleMe, input, existing, data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      const r = ok(
        await supabase().rpc('save_meeting', {
          p_id: input.id,
          p_chapter: input.chapterId,
          p_kind: input.kind,
          p_title: input.title,
          p_starts_at: input.startsAt,
          p_location: input.location,
          p_agenda: input.agenda,
        }),
      );
      await after();
      return r.data as string;
    },
    cancelMeeting: async (id) => {
      const problem = cancelMeetingProblem(visibleMe, (data.meetings ?? []).find((x) => x.id === id), data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('cancel_meeting', { p_id: id }));
      await after();
    },
    saveMinutes: async (id, text) => {
      const problem = saveMinutesProblem(visibleMe, (data.meetings ?? []).find((x) => x.id === id), data);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('save_minutes', { p_id: id, p_text: text }));
      await after();
    },
    shareMinutes: async (id) => {
      // As with confirming, the saved text may be newer than what's loaded, so the database decides on blank minutes.
      const problem = shareMinutesProblem(visibleMe, (data.meetings ?? []).find((x) => x.id === id), data, new Date().toISOString());
      if (problem && problem !== 'Write the minutes first.') throw new NotAllowedError(problem);
      ok(await supabase().rpc('share_minutes', { p_id: id }));
      await after();
    },
    approveMinutes: async (id) => {
      // The draft on screen may be newer than the saved one, so the database has the final say on blank minutes.
      const problem = approveMinutesProblem(visibleMe, (data.meetings ?? []).find((x) => x.id === id), data, new Date().toISOString());
      if (problem && problem !== 'Write the minutes first.') throw new NotAllowedError(problem);
      ok(await supabase().rpc('approve_minutes', { p_id: id }));
      await after();
    },
    saveActionItem: async (input) => {
      const problem = actionItemProblem(visibleMe, input, data);
      if (problem) throw new NotAllowedError(problem);
      ok(
        await supabase().rpc('save_action_item', {
          p_id: input.id,
          p_chapter: input.chapterId,
          p_meeting: input.meetingId,
          p_title: input.title,
          p_owner: input.ownerId,
          p_due: input.dueOn,
        }),
      );
      await after();
    },
    setActionDone: async (id, done) => {
      const problem = setDoneProblem(visibleMe, (data.actionItems ?? []).find((a) => a.id === id), data);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('set_action_done', { p_id: id, p_done: done }));
      await after();
    },
    openVote: async (input) => {
      const problem = openVoteProblem(visibleMe, input, data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      const r = ok(
        await supabase().rpc('open_vote', {
          p_chapter: input.chapterId,
          p_meeting: input.meetingId,
          p_subject: input.subjectMemberId,
          // The seat a vote about a Full Member is for; left out otherwise, so older databases still take the call.
          ...(input.subjectRole ? { p_role: input.subjectRole } : {}),
          p_question: input.question,
          p_details: input.details,
          p_electorate: input.electorate,
          p_threshold: input.threshold,
          p_secret: input.secret,
          p_quorum: input.quorum,
          p_closes_at: input.closesAt,
        }),
      );
      await after();
      return r.data as string;
    },
    castBallot: async (voteId, choice) => {
      const problem = castProblem(visibleMe, (data.votes ?? []).find((v) => v.id === voteId), new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('cast_ballot', { p_vote: voteId, p_choice: choice }));
      await after();
    },
    closeVote: async (voteId, casting) => {
      // The count stays in the database until the vote closes, so it decides on a tie.
      const problem = closeVoteProblem(visibleMe, (data.votes ?? []).find((v) => v.id === voteId), null, casting, data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('close_vote', { p_vote: voteId, p_casting: casting }));
      await after();
    },

    // Stage 4: each checks the same rule first (for a quick, clear answer), then asks the database.
    openCheckin: async (input) => {
      deny(openCheckinProblem(visibleMe, input, data, today));
      const r = ok(
        await supabase().rpc('open_checkin', {
          p_kind: input.kind,
          p_ride: input.rideId,
          p_chapter: input.chapterId,
          p_title: input.title.trim() || null,
          p_held_on: input.kind === 'meeting' ? input.heldOn : null,
          // Anything but an ordinary meeting goes to the six-argument version, which opens and
          // classifies it in one go (5.2, 5.4). Ordinary keeps the original call.
          ...(input.kind === 'meeting' && input.meetingType && input.meetingType !== 'ordinary' ? { p_meeting_type: input.meetingType } : {}),
        }),
      );
      await after();
      return r.data as string;
    },
    checkinCode: async (sessionId) => (ok(await supabase().rpc('checkin_code', { p_session: sessionId })).data as string) ?? '',
    checkIn: async (code) => {
      if (!visibleMe) throw new NotAllowedError('Sign in first.');
      if (!canCheckIn(visibleMe)) throw new NotAllowedError('Only members and applicants can check in.');
      const r = ok(await supabase().rpc('check_in', { p_code: code }));
      await after();
      return r.data as string;
    },
    markAttendance: async (sessionId, memberId, present) => {
      const session = (data.checkinSessions ?? []).find((s) => s.id === sessionId);
      if (session) deny(markProblem(visibleMe, session, data.members.find((m) => m.id === memberId), data, today));
      ok(await supabase().rpc('mark_attendance', { p_session: sessionId, p_member: memberId, p_present: present }));
      await after();
    },
    closeCheckin: async (sessionId) => {
      const session = (data.checkinSessions ?? []).find((s) => s.id === sessionId);
      if (session) deny(closeProblem(visibleMe, session, data));
      ok(await supabase().rpc('close_checkin', { p_session: sessionId }));
      await after();
    },
    // Attendance rules and Big 4 rides
    designateBig4: async (rideId, chapterId) => {
      deny(designateBig4Problem(visibleMe, rideId, chapterId, data, today));
      ok(await supabase().rpc('designate_big4', { p_ride: rideId, p_chapter: chapterId }));
      await after();
    },
    undesignateBig4: async (rideId) => {
      deny(undesignateBig4Problem(visibleMe, rideId, data, today));
      ok(await supabase().rpc('undesignate_big4', { p_ride: rideId }));
      await after();
    },
    setExemption: async (sessionId, memberId, reason) => {
      deny(exemptionProblem(visibleMe, sessionId, memberId, reason, data));
      ok(await supabase().rpc('set_exemption', { p_session: sessionId, p_member: memberId, p_reason: reason?.trim() || null }));
      await after();
    },
    // Big 4 RSVP rules and the 5.5 notice
    setBig4Waiver: async (rideId, memberId, ground) => {
      deny(big4WaiverProblem(visibleMe, rideId, memberId, ground, data, new Date().toISOString()));
      ok(await supabase().rpc('set_big4_waiver', { p_ride: rideId, p_member: memberId, p_ground: ground }));
      await after();
    },
    giveStatusNotice: async (memberId, input) => {
      deny(giveNoticeProblem(visibleMe, memberId, input, data, today));
      const r = ok(
        await supabase().rpc('give_status_notice', {
          p_member: memberId, p_about: input.about, p_record: input.record.trim(), p_proposal: input.proposal.trim(), p_respond_by: input.respondBy,
        }),
      );
      await after();
      return r.data as string;
    },
    respondToNotice: async (noticeId, response) => {
      deny(respondProblem(visibleMe, noticeId, response, data));
      ok(await supabase().rpc('respond_to_notice', { p_notice: noticeId, p_response: response.trim() }));
      await after();
    },
    closeStatusNotice: async (noticeId, outcome, note) => {
      deny(closeNoticeProblem(visibleMe, noticeId, outcome, note, data, today));
      ok(await supabase().rpc('close_status_notice', { p_notice: noticeId, p_outcome: outcome, p_note: note.trim() }));
      await after();
    },
    decideApplication: async (memberId, status, votes, note) => {
      const target = data.members.find((m) => m.id === memberId);
      if (!target) throw new Error('No such applicant.');
      deny(decideApplicationProblem(visibleMe, target, status, votes, data));
      ok(
        await supabase().rpc('decide_application', {
          p_member: memberId, p_status: status, p_for: votes.for, p_against: votes.against, p_abstained: votes.abstained,
          p_note: note.trim() || null,
        }),
      );
      await after();
    },
    recordFngReview: async (memberId, atMonths, outcome, votes, note) => {
      const target = data.members.find((m) => m.id === memberId);
      if (!target) throw new Error('That member no longer exists.');
      deny(fngReviewProblem(visibleMe, target, atMonths, outcome, votes, data, today));
      ok(
        await supabase().rpc('record_fng_review', {
          p_member: memberId, p_at_months: atMonths, p_outcome: outcome, p_for: votes.for, p_against: votes.against,
          p_abstained: votes.abstained, p_note: note.trim() || null,
        }),
      );
      await after();
    },
    setFeeRate: async (chapterId, fy, status, amountCents, dueOn) => {
      deny(feeRateProblem(visibleMe, chapterId, status, amountCents, data));
      ok(await supabase().rpc('set_fee_rate', { p_chapter: chapterId, p_fy: fy, p_status: status, p_amount_cents: amountCents, p_due_on: dueOn }));
      await after();
    },
    setPaymentDetails: async (d) => {
      deny(paymentDetailsProblem(visibleMe, d.chapterId, data));
      ok(
        await supabase().rpc('set_payment_details', {
          p_chapter: d.chapterId, p_payid: d.payid, p_payid_name: d.payidName, p_bsb: d.bsb, p_account_no: d.accountNo,
        }),
      );
      await after();
    },
    raiseFees: async (chapterId, fy) => {
      deny(raiseFeesProblem(visibleMe, chapterId, fy, data));
      const r = ok(await supabase().rpc('raise_fees', { p_chapter: chapterId, p_fy: fy }));
      await after();
      return (r.data as number) ?? 0;
    },
    recordAgm: async (heldOn) => {
      deny(recordAgmProblem(visibleMe, data.positions) ?? agmDateProblem(heldOn));
      ok(await supabase().rpc('record_agm', { p_held_on: heldOn }));
      await after();
    },
    raiseCharge: async (memberId, description, amountCents, dueOn) => {
      const target = data.members.find((m) => m.id === memberId);
      if (!target) throw new Error('That member no longer exists.');
      deny(raiseChargeProblem(visibleMe, target, description, amountCents, data));
      ok(await supabase().rpc('raise_charge', { p_member: memberId, p_description: description.trim(), p_amount_cents: amountCents, p_due_on: dueOn }));
      await after();
    },
    waiveCharge: async (chargeId) => {
      const charge = (data.charges ?? []).find((c) => c.id === chargeId);
      if (charge) deny(waiveProblem(visibleMe, charge, data));
      ok(await supabase().rpc('waive_charge', { p_charge: chargeId }));
      await after();
    },
    claimPayment: async (chargeId, amountCents, paidOn, method, reference) => {
      const charge = (data.charges ?? []).find((c) => c.id === chargeId);
      if (charge) deny(claimProblem(visibleMe, charge, amountCents, paidOn, method, data, today));
      ok(
        await supabase().rpc('claim_payment', {
          p_charge: chargeId, p_amount_cents: amountCents, p_paid_on: paidOn, p_method: method, p_reference: reference.trim() || null,
        }),
      );
      await after();
    },
    recordPayment: async (chargeId, amountCents, paidOn, method, reference) => {
      const charge = (data.charges ?? []).find((c) => c.id === chargeId);
      if (charge) deny(recordPaymentProblem(visibleMe, charge, amountCents, paidOn, method, data, today));
      ok(
        await supabase().rpc('record_payment', {
          p_charge: chargeId, p_amount_cents: amountCents, p_paid_on: paidOn, p_method: method, p_reference: reference.trim() || null,
        }),
      );
      await after();
    },
    confirmPayment: async (paymentId) => {
      const payment = (data.payments ?? []).find((p) => p.id === paymentId);
      if (payment) deny(decidePaymentProblem(visibleMe, payment, 'confirm', data));
      ok(await supabase().rpc('confirm_payment', { p_payment: paymentId }));
      await after();
    },
    rejectPayment: async (paymentId) => {
      const payment = (data.payments ?? []).find((p) => p.id === paymentId);
      if (payment) deny(decidePaymentProblem(visibleMe, payment, 'reject', data));
      ok(await supabase().rpc('reject_payment', { p_payment: paymentId }));
      await after();
    },

    setCrew: async (rideId, memberId, role) => {
      const target = data.members.find((m) => m.id === memberId);
      const problem = crewProblem(visibleMe, data.rides.find((r) => r.id === rideId), target, role, data, new Date().toISOString());
      // A manager who isn't the target's board can't see their meetings or excuses, so the Big 4
      // check would only guess: set_crew decides that one.
      const big4Guess = !!target && !seesBig4Records(visibleMe, target, data.positions) && problem === big4CrewProblem(target, rideId, data, today);
      if (problem && !big4Guess) throw new NotAllowedError(problem);
      ok(await supabase().rpc('set_crew', { p_ride: rideId, p_member: memberId, p_role: role }));
      await after();
    },

    leaveCrew: async (rideId, memberId) => {
      const problem = leaveProblem(visibleMe, data.rides.find((r) => r.id === rideId), memberId, data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('leave_crew', { p_ride: rideId, p_member: memberId }));
      await after();
    },

    saveRoute: async (input) => {
      requireUser();
      // The rule checks first, then the file, the same order as save_route.
      const existing = input.id === null ? undefined : data.routes?.find((r) => r.id === input.id);
      const problem = saveRouteProblem(visibleMe, existing, input, data);
      if (problem) throw new NotAllowedError(problem);
      let summary: GpxSummary | null = null;
      if (input.gpx !== null) {
        const read = readGpx(input.gpx);
        if (typeof read === 'string') throw new Error(read);
        summary = read;
      } else if (input.id === null) throw new Error(NO_TRACK);
      const result = ok(
        await supabase().rpc('save_route', {
          p_id: input.id,
          p_name: input.name.trim(),
          p_chapter: input.chapterId,
          p_notes: input.notes.trim() || null,
          p_gpx: input.gpx,
          p_distance_m: summary?.distanceM ?? null,
          p_climb_m: summary?.climbM ?? null,
          p_line: summary?.line ?? null,
          p_stops: summary?.stops ?? null,
          p_bounds: summary?.bounds ?? null,
        }),
      );
      await after();
      return result.data ?? input.id ?? '';
    },

    archiveRoute: async (routeId) => {
      const problem = archiveRouteProblem(visibleMe, data.routes?.find((r) => r.id === routeId), data);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('archive_route', { p_id: routeId }));
      await after();
    },

    setRideRoute: async (rideId, routeId) => {
      const route = routeId === null ? null : data.routes?.find((r) => r.id === routeId);
      const problem = rideRouteProblem(visibleMe, data.rides.find((r) => r.id === rideId), route, data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('set_ride_route', { p_ride: rideId, p_route: routeId }));
      await after();
    },

    routeGpx: async (routeId) => {
      const result = ok(await supabase().rpc('route_gpx', { p_route: routeId }));
      if (typeof result.data !== 'string') throw new Error(NO_ROUTE);
      return result.data;
    },

    saveBriefing: (rideId, input, seen) =>
      reloadOnNewerVersion(async () => {
        const problem = saveBriefingProblem(visibleMe, data.rides.find((r) => r.id === rideId), input, data, new Date().toISOString(), seen);
        if (problem) throw new NotAllowedError(problem);
        ok(await supabase().rpc('save_briefing', saveBriefingArgs(rideId, input, seen)));
        await after();
      }, after),

    readBriefing: (rideId, seen) =>
      reloadOnNewerVersion(async () => {
        const problem = readBriefingProblem(visibleMe, data.rides.find((r) => r.id === rideId), data, seen);
        if (problem) throw new NotAllowedError(problem);
        ok(await supabase().rpc('read_briefing', readBriefingArgs(rideId, seen)));
        await after();
      }, after),

    // After a newer-version refusal (the app's or the database's), reload so the screen shows the
    // newer version, then the refusal goes on to the screen.
    publishRoadRules: (input, seen) =>
      reloadOnNewerVersion(async () => {
        const problem = publishProblem(visibleMe, input, seen, data);
        if (problem) throw new NotAllowedError(problem);
        ok(await supabase().rpc('publish_road_rules', publishRoadRulesArgs(input, seen, data)));
        await after();
      }, after, isRoadRulesVersionRefusal),

    signRoadRules: (version) =>
      reloadOnNewerVersion(async () => {
        const problem = signProblem(visibleMe, version, data);
        if (problem) throw new NotAllowedError(problem);
        ok(await supabase().rpc('sign_road_rules', signRoadRulesArgs(version)));
        await after();
      }, after, isRoadRulesVersionRefusal),

    // The Rusty Bus: the app's rules first, then the database's action, then a reload.
    bookBus: async (input) => {
      const problem = bookProblem(visibleMe, input, data, today);
      if (problem) throw new NotAllowedError(problem);
      const result = ok(await supabase().rpc('book_bus', bookBusArgs(input)));
      await after();
      return result.data ?? '';
    },

    decideBus: async (bookingId, yes, reason) => {
      const booking = (data.busBookings ?? []).find((b) => b.id === bookingId);
      const problem = decideProblem(visibleMe, booking, yes, reason, data, today);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('decide_bus', decideBusArgs(bookingId, yes, reason)));
      await after();
    },

    cancelBus: async (bookingId) => {
      const booking = (data.busBookings ?? []).find((b) => b.id === bookingId);
      const problem = cancelProblem(visibleMe, booking, data, today);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('cancel_bus', cancelBusArgs(bookingId)));
      await after();
    },

    // Rusty Bus extras: the app's rules first, then the database's action, then a reload.
    changeBus: async (bookingId, input) => {
      deny(changeProblem(visibleMe, (data.busBookings ?? []).find((b) => b.id === bookingId), input, data, today));
      ok(await supabase().rpc('change_bus', changeBusArgs(bookingId, input)));
      await after();
    },
    handBusKeys: async (toId, note) => {
      deny(handKeysProblem(visibleMe, toId, note, data));
      ok(await supabase().rpc('hand_bus_keys', handBusKeysArgs(toId, note)));
      await after();
    },
    logBusKm: async (input) => {
      deny(logKmProblem(visibleMe, input, data, today));
      ok(await supabase().rpc('log_bus_km', logBusKmArgs(input)));
      await after();
    },
    logBusCost: async (input) => {
      deny(logCostProblem(visibleMe, { ...input, litres: roundLitres(input.litres) }, data, today));
      ok(await supabase().rpc('log_bus_cost', logBusCostArgs(input)));
      await after();
    },
    strikeBusKm: async (id) => {
      deny(strikeKmProblem(visibleMe, (data.busKm ?? []).find((r) => r.id === id), data));
      ok(await supabase().rpc('strike_bus_km', strikeArgs(id)));
      await after();
    },
    strikeBusCost: async (id) => {
      deny(strikeCostProblem(visibleMe, (data.busCosts ?? []).find((c) => c.id === id), data));
      ok(await supabase().rpc('strike_bus_cost', strikeArgs(id)));
      await after();
    },

    // Ride planning extras: the app's rules first, then the database's action, then a reload.
    setBikeRange: async (bikeId, rangeKm) => {
      deny(rangeProblem(visibleMe, data.bikes.find((b) => b.id === bikeId), rangeKm));
      ok(await supabase().rpc('set_bike_range', setBikeRangeArgs(bikeId, rangeKm)));
      await after();
    },
    saveRidePlan: (rideId, stops, seen) =>
      reloadOnNewerVersion(async () => {
        deny(savePlanProblem(visibleMe, data.rides.find((r) => r.id === rideId), stops, seen, data, new Date().toISOString()));
        ok(await supabase().rpc('save_ride_plan', saveRidePlanArgs(rideId, stops, seen)));
        await after();
      }, after, isPlanConflict),
    rateRoute: async (routeId, stars, comment) => {
      deny(rateProblem(visibleMe, (data.routes ?? []).find((r) => r.id === routeId), stars, comment));
      ok(await supabase().rpc('rate_route', rateRouteArgs(routeId, stars, comment)));
      await after();
    },
    callRide: async (rideId, state, reason, newDay) => {
      deny(callProblem(visibleMe, data.rides.find((r) => r.id === rideId), state, reason, newDay, data, new Date().toISOString()));
      ok(await supabase().rpc('call_ride', callRideArgs(rideId, state, reason, newDay)));
      await after();
    },
    saveHub: async (rideId, input) => {
      deny(saveHubProblem(visibleMe, data.rides.find((r) => r.id === rideId), input, data, new Date().toISOString()));
      ok(await supabase().rpc('save_hub', saveHubArgs(rideId, input)));
      await after();
    },
    registerHub: async (rideId, input) => {
      deny(registerProblem(visibleMe, data.rides.find((r) => r.id === rideId), input, data, new Date().toISOString(), today));
      ok(await supabase().rpc('register_hub', registerHubArgs(rideId, input)));
      await after();
    },
    withdrawHub: async (rideId) => {
      deny(withdrawHubProblem(visibleMe, data.rides.find((r) => r.id === rideId), data, new Date().toISOString()));
      ok(await supabase().rpc('withdraw_hub', { p_ride: rideId }));
      await after();
    },
    // Charity ride sign-ups
    saveCharity: async (rideId, input) => {
      deny(saveCharityProblem(visibleMe, data.rides.find((r) => r.id === rideId), input, data, new Date().toISOString()));
      ok(await supabase().rpc('save_charity', saveCharityArgs(rideId, input)));
      await after();
    },
    signUpCharity: async (rideId, input) => {
      deny(signupProblem(visibleMe, data.rides.find((r) => r.id === rideId), input, data, new Date().toISOString(), today));
      ok(await supabase().rpc('sign_up_charity', signUpCharityArgs(rideId, input)));
      await after();
    },
    withdrawCharity: async (rideId) => {
      deny(withdrawCharityProblem(visibleMe, data.rides.find((r) => r.id === rideId), data, new Date().toISOString()));
      ok(await supabase().rpc('withdraw_charity', { p_ride: rideId }));
      await after();
    },
    askSwap: async (rideId, toId, note) => {
      deny(askSwapProblem(visibleMe, data.rides.find((r) => r.id === rideId), toId, note, data, new Date().toISOString()));
      const result = ok(await supabase().rpc('ask_swap', askSwapArgs(rideId, toId, note)));
      await after();
      return result.data ?? '';
    },
    answerSwap: async (swapId, yes) => {
      const swap = (data.crewSwaps ?? []).find((s) => s.id === swapId);
      deny(answerSwapProblem(visibleMe, swap, yes, data, new Date().toISOString()));
      ok(await supabase().rpc('answer_swap', { p_swap: swapId, p_yes: yes }));
      await after();
    },
    withdrawSwap: async (swapId) => {
      deny(withdrawSwapProblem(visibleMe, (data.crewSwaps ?? []).find((s) => s.id === swapId)));
      ok(await supabase().rpc('withdraw_swap', { p_swap: swapId }));
      await after();
    },

    // Stage 5B: treasurer. Each checks the same rule first (for a quick, clear answer), then asks the database.
    recordCredit: async (input) => {
      deny(creditProblem(visibleMe, input, data, today));
      const r = ok(
        await supabase().rpc('record_credit', {
          p_chapter: input.chapterId, p_code: input.code, p_description: input.description.trim(), p_amount_cents: input.amountCents,
          p_received_on: input.receivedOn, p_entry_on: input.entryOn,
        }),
      );
      await after();
      return r.data as string;
    },
    recordDebit: async (input) => {
      deny(debitProblem(visibleMe, input, data, today));
      const r = ok(
        await supabase().rpc('record_debit', {
          p_chapter: input.chapterId, p_code: input.code, p_description: input.description.trim(), p_amount_cents: input.amountCents,
          p_payee_member: input.payeeMemberId, p_payee_name: input.payeeName?.trim() || null, p_paid_on: input.paidOn,
        }),
      );
      await after();
      return r.data as string;
    },
    approveDebit: async (id) => {
      deny(approveProblem(visibleMe, id, data));
      ok(await supabase().rpc('approve_debit', { p_id: id }));
      await after();
    },
    payDebit: async (id, paidOn) => {
      deny(payProblem(visibleMe, id, paidOn, data, today));
      ok(await supabase().rpc('pay_debit', { p_id: id, p_paid_on: paidOn }));
      await after();
    },
    voidEntry: async (id, reason) => {
      deny(voidProblem(visibleMe, id, reason, data));
      ok(await supabase().rpc('void_entry', { p_id: id, p_reason: reason.trim() }));
      await after();
    },
    addFeePayment: async (paymentId) => {
      deny(addFeeProblem(visibleMe, paymentId, data));
      ok(await supabase().rpc('add_fee_payment', { p_payment: paymentId }));
      await after();
    },
    setOpening: async (chapterId, fy, amountCents) => {
      deny(openingProblem(visibleMe, chapterId, fy, amountCents, data));
      ok(await supabase().rpc('set_opening', { p_chapter: chapterId, p_fy: fy, p_amount_cents: amountCents }));
      await after();
    },
    setCashFloat: async (fy, amountCents) => {
      deny(floatProblem(visibleMe, fy, amountCents, data));
      ok(await supabase().rpc('set_cash_float', { p_fy: fy, p_amount_cents: amountCents }));
      await after();
    },
    saveBudget: async (chapterId, fy, lines) => {
      deny(budgetProblem(visibleMe, chapterId, fy, lines, data));
      ok(await supabase().rpc('save_budget', { p_chapter: chapterId, p_fy: fy, p_lines: lines }));
      await after();
    },
    approveBudget: async (chapterId, fy, voteId) => {
      deny(approveBudgetProblem(visibleMe, chapterId, fy, voteId, data));
      ok(await supabase().rpc('approve_budget', { p_chapter: chapterId, p_fy: fy, p_vote: voteId }));
      await after();
    },
    reopenBudget: async (chapterId, fy) => {
      deny(reopenBudgetProblem(visibleMe, chapterId, fy, data));
      ok(await supabase().rpc('reopen_budget', { p_chapter: chapterId, p_fy: fy }));
      await after();
    },
    presentReport: async (month) => {
      deny(presentProblem(visibleMe, month, data, today));
      ok(await supabase().rpc('present_report', { p_month: month }));
      await after();
    },
    saveMeetingReport: async (id, input) => {
      deny(meetingProblem(visibleMe, id, input, data, today));
      const r = ok(await supabase().rpc('save_meeting_report', { p_id: id, p_from: input.fromOn, p_to: input.toOn, p_notes: input.notes }));
      await after();
      return r.data as string;
    },
    presentMeetingReport: async (id) => {
      deny(presentMeetingProblem(visibleMe, id, data));
      ok(await supabase().rpc('present_meeting_report', { p_id: id }));
      await after();
    },
    deleteMeetingReport: async (id) => {
      deny(deleteMeetingProblem(visibleMe, id, data));
      ok(await supabase().rpc('delete_meeting_report', { p_id: id }));
      await after();
    },

    // Stage 5C: document library. The same rule first, then the database.
    createDocument: async (raw) => {
      deny(createDocumentProblem(visibleMe, raw, data));
      const input = cleanDocumentInput(raw);
      const r = ok(
        await supabase().rpc('create_document', {
          p_chapter: input.chapterId, p_kind: input.kind, p_title: input.title, p_asks_sign_off: input.asksSignOff,
          p_review_months: input.reviewMonths,
        }),
      );
      await after();
      return r.data as string;
    },
    publishDocumentVersion: async (documentId, expected, raw) => {
      deny(publishVersionProblem(visibleMe, documentId, expected, raw, data, today));
      const input = cleanVersionInput(raw);
      const r = ok(
        await supabase().rpc('publish_document_version', {
          p_document: documentId, p_expected: expected, p_label: input.label, p_body: input.body, p_what_changed: input.whatChanged,
          p_fresh_sign_off: input.freshSignOff, p_approving_body: input.approval.approvingBody, p_approved_on: input.approval.approvedOn,
          p_commences_on: input.approval.commencesOn,
        }),
      );
      // The text just sent is the version's text, so it needn't be loaded again.
      loadedBodies[r.data as string] = input.body;
      await after();
      return r.data as string;
    },
    recordDocumentApproval: async (versionId, approval) => {
      deny(recordApprovalProblem(visibleMe, versionId, approval, data, today));
      ok(
        await supabase().rpc('record_document_approval', {
          p_version: versionId, p_approving_body: approval.approvingBody, p_approved_on: approval.approvedOn,
          p_commences_on: approval.commencesOn,
        }),
      );
      await after();
    },
    markDocumentReviewed: async (documentId) => {
      deny(markReviewedProblem(visibleMe, documentId, data, today));
      ok(await supabase().rpc('mark_document_reviewed', { p_document: documentId }));
      await after();
    },
    signDocument: async (versionId) => {
      deny(signDocumentProblem(visibleMe, versionId, data, today));
      ok(await supabase().rpc('sign_document', { p_version: versionId }));
      await after();
    },
    loadDocumentBody: async (versionId) => {
      const known = loadedBodies[versionId];
      if (known !== undefined) return known;
      const r = ok(await supabase().rpc('document_body', { p_version: versionId }));
      const body = r.data as string | null;
      // No text back means it can't be read yet: say so, and don't remember it as blank.
      if (body === null) throw new Error('That version’s text couldn’t be loaded.');
      loadedBodies[versionId] = body;
      setData((d) => ({
        ...d,
        documentVersions: (d.documentVersions ?? []).map((v) => (v.id === versionId ? { ...v, body } : v)),
      }));
      return body;
    },

    // Stage 5D: board and admin. Each checks the same rule first, then asks the database.
    recordConduct: async (input) => {
      deny(conduct.recordConductProblem(visibleMe, input, data, today));
      const r = ok(
        await supabase().rpc('record_conduct', {
          p_member: input.memberId, p_kind: input.kind, p_summary: input.summary.trim(), p_rule: input.rule.trim(),
          p_decided: input.decidedOn || null, p_notice: input.noticeOn || null, p_suspended: input.suspendedUntil || null,
        }),
      );
      await after();
      return r.data as string;
    },
    holdConduct: async (id, until, reason) => {
      deny(conduct.holdProblem(visibleMe, id, until, reason, data, today));
      ok(await supabase().rpc('hold_conduct', { p_record: id, p_until: until, p_reason: reason.trim() }));
      await after();
    },
    removeConduct: async (id) => {
      deny(conduct.removeConductProblem(visibleMe, id, data, today));
      ok(await supabase().rpc('remove_conduct', { p_record: id }));
      await after();
    },
    lodgeAppeal: async (id, grounds) => {
      deny(conduct.lodgeProblem(visibleMe, id, grounds, data, today));
      ok(await supabase().rpc('lodge_conduct_appeal', { p_record: id, p_grounds: grounds.trim() }));
      await after();
    },
    setHearing: async (id, panelIds, hearingOn) => {
      deny(conduct.hearingProblem(visibleMe, id, panelIds, hearingOn, data, today));
      ok(await supabase().rpc('set_conduct_hearing', { p_record: id, p_panel: panelIds, p_hearing: hearingOn || null }));
      await after();
    },
    decideAppeal: async (id, outcome, note) => {
      deny(conduct.outcomeProblem(visibleMe, id, outcome, note, data, today));
      ok(await supabase().rpc('decide_conduct_appeal', { p_record: id, p_outcome: outcome, p_note: note.trim() }));
      await after();
    },
    withdrawAppeal: async (id) => {
      deny(conduct.withdrawProblem(visibleMe, id, data, today));
      ok(await supabase().rpc('withdraw_conduct_appeal', { p_record: id }));
      await after();
    },
    proposeMerch: async (input) => {
      deny(merch.proposeMerchProblem(visibleMe, input, data));
      const r = ok(
        await supabase().rpc('propose_merch', {
          p_chapter: input.chapterId, p_name: input.name.trim(), p_details: input.details.trim(), p_sizes: merch.cleanSizes(input.sizes),
          p_price_cents: input.priceCents, p_patched_only: input.patchedOnly,
        }),
      );
      await after();
      return r.data as string;
    },
    decideMerch: async (id, yes, reason) => {
      deny(merch.decideMerchProblem(visibleMe, id, yes, reason, data));
      ok(await supabase().rpc('decide_merch', { p_item: id, p_yes: yes, p_reason: reason.trim() }));
      await after();
    },
    closeMerch: async (id) => {
      deny(merch.closeMerchProblem(visibleMe, id, data));
      ok(await supabase().rpc('close_merch', { p_item: id }));
      await after();
    },
    orderMerch: async (input) => {
      deny(merch.orderProblem(visibleMe, input, data));
      const r = ok(
        await supabase().rpc('order_merch', { p_item: input.itemId, p_size: input.size, p_qty: input.qty, p_note: input.note.trim() }),
      );
      await after();
      return r.data as string;
    },
    decideOrder: async (id, yes, reason) => {
      deny(merch.decideOrderProblem(visibleMe, id, yes, reason, data));
      ok(await supabase().rpc('decide_merch_order', { p_order: id, p_yes: yes, p_reason: reason.trim() }));
      await after();
    },
    payOrder: async (id, paidOn) => {
      deny(merch.payOrderProblem(visibleMe, id, paidOn, data, today));
      const r = ok(await supabase().rpc('pay_merch_order', { p_order: id, p_paid_on: paidOn }));
      await after();
      return r.data as string;
    },
    handOver: async (id) => {
      deny(merch.handOverProblem(visibleMe, id, data));
      ok(await supabase().rpc('hand_over_merch_order', { p_order: id }));
      await after();
    },
    cancelOrder: async (id) => {
      deny(merch.cancelOrderProblem(visibleMe, id, data));
      ok(await supabase().rpc('cancel_merch_order', { p_order: id }));
      await after();
    },
    proposeContribution: async (input) => {
      deny(national.proposeContributionProblem(visibleMe, input, data));
      const r = ok(
        await supabase().rpc('propose_contribution', {
          p_title: input.title.trim(), p_purpose: input.purpose.trim(), p_total_cents: input.totalCents,
        }),
      );
      await after();
      return r.data as string;
    },
    decideContribution: async (id, chapterId, voteId) => {
      deny(national.decideContributionProblem(visibleMe, id, chapterId, voteId, data));
      ok(await supabase().rpc('decide_contribution', { p_id: id, p_chapter: chapterId, p_vote: voteId }));
      await after();
    },
    withdrawContribution: async (id) => {
      deny(national.withdrawContributionProblem(visibleMe, id, data));
      ok(await supabase().rpc('withdraw_contribution', { p_id: id }));
      await after();
    },
    proposeChapter: async (input) => {
      deny(national.proposeChapterProblem(visibleMe, input, data));
      const r = ok(
        await supabase().rpc('propose_chapter', {
          p_name: input.name.trim(), p_area: input.area.trim(), p_state: input.state, p_location: input.plan.location.trim(),
          p_membership: input.plan.membership.trim(), p_leadership: input.plan.leadership.trim(), p_budget: input.plan.budget.trim(),
          p_operations: input.plan.operations.trim(), p_founders: input.founderIds, p_president: input.presidentId, p_saa: input.saaId,
        }),
      );
      await after();
      return r.data as string;
    },
    settleChapter: async (id, voteId) => {
      deny(national.settleChapterProblem(visibleMe, id, voteId, data));
      const r = ok(await supabase().rpc('settle_chapter_proposal', { p_id: id, p_vote: voteId }));
      await after();
      return (r.data as string | null) ?? null;
    },
    withdrawChapter: async (id) => {
      deny(national.withdrawChapterProblem(visibleMe, id, data));
      ok(await supabase().rpc('withdraw_chapter_proposal', { p_id: id }));
      await after();
    },
    // The National Auditor (11.8). Each checks the same rule first, then asks the database.
    raiseAuditRequest: async (input) => {
      deny(audit.raiseRequestProblem(visibleMe, input, data, today));
      const r = ok(
        await supabase().rpc('raise_audit_request', {
          p_chapter: input.chapterId, p_kind: input.kind, p_area: input.area, p_title: input.title.trim(),
          p_details: input.details.trim(), p_due: input.dueOn, p_ledger_entry: input.ledgerEntryId,
        }),
      );
      await after();
      return r.data as string;
    },
    answerAuditRequest: async (id, answer) => {
      deny(audit.answerRequestProblem(visibleMe, id, answer, data));
      ok(await supabase().rpc('answer_audit_request', { p_id: id, p_answer: answer.trim() }));
      await after();
    },
    closeAuditRequest: async (id, note) => {
      deny(audit.closeRequestProblem(visibleMe, id, note, data));
      ok(await supabase().rpc('close_audit_request', { p_id: id, p_note: note.trim() }));
      await after();
    },
    saveAuditReport: async (input) => {
      deny(audit.saveReportProblem(visibleMe, input, data, today));
      const r = ok(
        await supabase().rpc('save_audit_report', {
          p_id: input.id, p_title: input.title.trim(), p_from: input.fromOn, p_to: input.toOn,
          p_findings: input.findings.trim(), p_recommendations: input.recommendations?.trim() || null,
        }),
      );
      await after();
      return r.data as string;
    },
    issueAuditReport: async (id) => {
      deny(audit.issueReportProblem(visibleMe, id, data));
      ok(await supabase().rpc('issue_audit_report', { p_id: id }));
      await after();
    },
    deleteAuditReport: async (id) => {
      deny(audit.deleteReportProblem(visibleMe, id, data));
      ok(await supabase().rpc('delete_audit_report', { p_id: id }));
      await after();
    },
    renewAuditor: async () => {
      deny(renewAuditorProblem(visibleMe, data, today));
      ok(await supabase().rpc('renew_auditor'));
      await after();
    },
    // Lane E: notifications
    saveNotificationPrefs: async (prefs) => {
      const uid = requireUser();
      await saveNotificationPrefs(supabase(), prefs);
      knownPrefs.current = prefs;
      setData((d) => ({ ...d, notificationPrefs: prefs }));
      // The copy on the phone too, so opening offline later plans reminders from the new settings.
      const saved = await clubCache.load(uid);
      if (saved) await clubCache.save(uid, { ...saved.data, notificationPrefs: prefs }, saved.savedAt);
    },
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
