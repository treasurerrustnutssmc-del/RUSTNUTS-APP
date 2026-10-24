// Live build: the club's Supabase database. Row-level security and the database's own
// actions decide what each person can see and do; the app shows whatever comes back and
// checks the same rules first only so members get a clear message without a round trip.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accessLevel, appointProblem, endTermProblem } from '../domain/access';
import { crewProblem, leaveProblem } from '../domain/crew';
import { melbourneDate, rsvpProblem } from '../domain/rides';
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
import { loadClub } from './liveData';
// Stage 4
import { canCheckIn, closeProblem, markProblem, openCheckinProblem } from '../domain/attendance';
import {
  claimProblem,
  continuationFeeProblem,
  decidePaymentProblem,
  feeRateProblem,
  paymentDetailsProblem,
  raiseChargeProblem,
  raiseFeesProblem,
  recordPaymentProblem,
  waiveProblem,
} from '../domain/fees';
import { decideApplicationProblem, fngReviewProblem } from '../domain/joining';
import { refreshError, sessionView } from './session';
import { friendlyError, supabase } from './supabase';
// Lane E: offline
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SUPABASE_URL } from './config';
import { authStorageKeys, createClubCache, isConnectionError, startupUser } from './offlineCache';
// Lane E: notifications
import { loadNotificationPrefs, saveNotificationPrefs } from './notificationsApi';

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
    knownPrefs.current = saved.data.notificationPrefs; // Lane E: notifications
    setData(saved.data);
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
    data,
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
      const { error } = await supabase().auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) throw friendlyError(error);
    },

    verifyCode: async (email, code) => {
      const { error } = await supabase().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.replace(/\s/g, ''),
        type: 'email',
      });
      if (error) throw friendlyError(error);
    },

    signOut: async () => {
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

    setMemberStatus: async (memberId, status) => {
      ok(await supabase().rpc('set_member_status', { p_member: memberId, p_status: status }));
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
      const problem = appointProblem(visibleMe, target, chapterId, role, data);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('appoint_position', { p_member: memberId, p_chapter: chapterId, p_role: role }));
      await after();
    },

    endPosition: async (positionId) => {
      const position = data.positions.find((p) => p.id === positionId);
      if (!position) throw new Error('That position no longer exists.');
      const problem = endTermProblem(visibleMe, position, data);
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('end_position', { p_position: positionId }));
      await after();
    },

    setRsvp: async (rideId, answer) => {
      const problem = rsvpProblem(visibleMe, data.rides.find((r) => r.id === rideId), new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('set_rsvp', { p_ride: rideId, p_answer: answer }));
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
    setContinuationFee: async (chapterId, fy, amountCents) => {
      deny(continuationFeeProblem(visibleMe, chapterId, amountCents, data));
      ok(await supabase().rpc('set_continuation_fee', { p_chapter: chapterId, p_fy: fy, p_amount_cents: amountCents }));
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
      const problem = crewProblem(
        visibleMe,
        data.rides.find((r) => r.id === rideId),
        data.members.find((m) => m.id === memberId),
        role,
        data,
        new Date().toISOString(),
      );
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('set_crew', { p_ride: rideId, p_member: memberId, p_role: role }));
      await after();
    },

    leaveCrew: async (rideId, memberId) => {
      const problem = leaveProblem(visibleMe, data.rides.find((r) => r.id === rideId), memberId, data, new Date().toISOString());
      if (problem) throw new NotAllowedError(problem);
      ok(await supabase().rpc('leave_crew', { p_ride: rideId, p_member: memberId }));
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
