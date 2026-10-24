// Live build: the club's Supabase database. Row-level security and the database's own
// actions decide what each person can see and do; the app shows whatever comes back and
// checks the same rules first only so members get a clear message without a round trip.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accessLevel, appointProblem, endTermProblem } from '../domain/access';
import { todayIso } from '../domain/dates';
import { rsvpProblem } from '../domain/rides';
import type { ClubData } from '../domain/types';
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
import { refreshError, sessionView } from './session';
import { friendlyError, supabase } from './supabase';
// Lane E: offline
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClubCache } from './offlineCache';

const clubCache = createClubCache(AsyncStorage);

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
  const today = todayIso();
  // Lane E: offline. When the data on screen is the copy saved on the phone, when it was saved.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const showing = useRef<string | null>(null);

  /** Loads what this person may see. Only the newest request wins, so a slow old load can't overwrite a newer one. */
  const reload = useCallback(async (uid: string | null) => {
    const ticket = ++latest.current;
    try {
      const fresh = await loadClub(supabase(), !!uid);
      if (ticket !== latest.current) return;
      setData(fresh);
      setLoadedFor(uid ?? '');
      setLoadError(null);
      showing.current = uid ?? '';
      setSavedAt(null);
      if (uid) clubCache.save(uid, fresh, new Date().toISOString());
    } catch (e) {
      if (ticket !== latest.current) return;
      // No signal and nothing of theirs on screen yet: show the copy saved on the phone.
      if (uid && showing.current !== uid) {
        const saved = await clubCache.load(uid);
        if (ticket !== latest.current) return;
        if (saved) {
          setData(saved.data);
          setLoadedFor(uid);
          showing.current = uid;
          setSavedAt(saved.savedAt);
        }
      }
      setLoadError(friendlyError(e as { message?: string }).message);
    }
  }, []);

  // Follow the sign-in state, and load whatever this person is allowed to see.
  useEffect(() => {
    const db = supabase();
    let cancelled = false;
    db.auth.getSession().then(async ({ data: s }) => {
      if (cancelled) return;
      const uid = s.session?.user.id ?? null;
      setUserId(uid);
      setAuthEmail(s.session?.user.email ?? null);
      // Lane E: offline. Open on the copy saved on the phone while the fresh load comes in.
      const saved = uid ? await clubCache.load(uid) : null;
      if (cancelled) return;
      if (uid && saved && showing.current === null) {
        setData(saved.data);
        setLoadedFor(uid);
        showing.current = uid;
        setSavedAt(saved.savedAt);
        setStarted(true);
      }
      await reload(uid);
      if (!cancelled) setStarted(true);
    });
    const { data: sub } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      const uid = session?.user.id ?? null;
      setUserId(uid);
      setAuthEmail(session?.user.email ?? null);
      if (!uid) setJustApplied(false);
      if (!uid) clubCache.clear(); // Lane E: offline
      // Run outside the auth callback, as Supabase recommends.
      setTimeout(() => {
        reload(uid);
      }, 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [reload]);

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
    savedAt: loadError ? savedAt : null, // Lane E: offline

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
      await clubCache.clear(); // Lane E: offline
      await supabase().auth.signOut();
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
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
