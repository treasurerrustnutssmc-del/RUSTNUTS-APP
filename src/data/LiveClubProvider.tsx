// Live build: the club's Supabase database. Row-level security and the database's own
// actions decide what each person can see and do; the app shows whatever comes back and
// checks the same rules first only so members get a clear message without a round trip.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accessLevel, appointProblem, endTermProblem } from '../domain/access';
import { todayIso } from '../domain/dates';
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
  const latest = useRef(0);
  const today = todayIso();

  /** Loads what this person may see. Only the newest request wins, so a slow old load can't overwrite a newer one. */
  const reload = useCallback(async (uid: string | null) => {
    const ticket = ++latest.current;
    try {
      const fresh = await loadClub(supabase(), !!uid);
      if (ticket !== latest.current) return;
      setData(fresh);
      setLoadedFor(uid ?? '');
      setLoadError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
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
      await reload(uid);
      if (!cancelled) setStarted(true);
    });
    const { data: sub } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      const uid = session?.user.id ?? null;
      setUserId(uid);
      setAuthEmail(session?.user.email ?? null);
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
  const view = sessionView({ userId, loadedFor: loadedForUser, loadError, hasMe: !!me });
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
      await supabase().auth.signOut();
    },

    refresh,

    submitApplication: async (input) => {
      requireUser();
      const bikeProblem = validateApplicationBike(input.bike ?? null, today);
      if (bikeProblem) throw new Error(bikeProblem);
      const bike = input.bike && input.bike.make.trim() ? input.bike : null;
      ok(
        await supabase().rpc('apply_to_join', {
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
        }),
      );
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
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
