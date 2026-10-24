// Live build: the club's Supabase database. Row-level security on the server decides
// what each person receives; the app shows whatever comes back.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { accessLevel } from '../domain/access';
import { todayIso } from '../domain/dates';
import type { ClubData, MemberPrivate } from '../domain/types';
import {
  checkAppoint,
  ClubContext,
  EMPTY_DATA,
  NotAllowedError,
  validateBike,
  validateContact,
  type ClubContextValue,
} from './clubContext';
import { friendlyError, supabase } from './supabase';

/** Database rows (snake_case) into the app's records (camelCase). */
async function loadClub(signedIn: boolean): Promise<ClubData> {
  const db = supabase();
  const chapters = await db.from('chapters').select('*').order('name');
  if (chapters.error) throw friendlyError(chapters.error);
  const base: ClubData = {
    ...EMPTY_DATA,
    chapters: chapters.data.map((c) => ({ id: c.id, slug: c.slug, name: c.name, area: c.area, state: c.state })),
  };
  if (!signedIn) return base;

  const [members, privates, phones, bikes, regos, contacts, positions] = await Promise.all([
    db.from('members').select('*'),
    db.from('member_private').select('*'),
    db.rpc('shared_phones'),
    db.from('bikes').select('*').order('created_at'),
    db.from('bike_registrations').select('*'),
    db.from('emergency_contacts').select('*').order('created_at'),
    db.from('positions').select('*'),
  ]);
  for (const r of [members, privates, phones, bikes, regos, contacts, positions]) {
    if (r.error) throw friendlyError(r.error);
  }

  const privateRows: MemberPrivate[] = (privates.data ?? []).map((p) => ({
    memberId: p.member_id,
    email: p.email,
    phone: p.phone,
    licenceClass: p.licence_class,
    licenceExpiry: p.licence_expiry,
    firstAidExpiry: p.first_aid_expiry,
    introducedBy: p.introduced_by,
    applicationNote: p.application_note,
  }));
  // Members who share their number with the club: phone only, nothing else private.
  for (const ph of phones.data ?? []) {
    if (!privateRows.some((p) => p.memberId === ph.member_id)) {
      privateRows.push({
        memberId: ph.member_id,
        email: null,
        phone: ph.phone,
        licenceClass: null,
        licenceExpiry: null,
        firstAidExpiry: null,
        introducedBy: null,
        applicationNote: null,
      });
    }
  }

  return {
    chapters: base.chapters,
    members: (members.data ?? []).map((m) => ({
      id: m.id,
      chapterId: m.chapter_id,
      fullName: m.full_name,
      roadName: m.road_name,
      status: m.status,
      approval: m.approval,
      joinedOn: m.joined_on,
      patchedOn: m.patched_on,
      fngStartedOn: m.fng_started_on,
      bio: m.bio,
      sharePhone: m.share_phone,
      appliedOn: m.applied_on,
    })),
    privates: privateRows,
    bikes: (bikes.data ?? []).map((b) => ({
      id: b.id,
      memberId: b.member_id,
      make: b.make,
      model: b.model,
      year: b.year,
      nickname: b.nickname,
      isProject: b.is_project,
    })),
    registrations: (regos.data ?? []).map((r) => ({ bikeId: r.bike_id, rego: r.rego, regoExpiry: r.rego_expiry })),
    emergencyContacts: (contacts.data ?? []).map((c) => ({
      id: c.id,
      memberId: c.member_id,
      name: c.name,
      relationship: c.relationship,
      phone: c.phone,
    })),
    positions: (positions.data ?? []).map((p) => ({
      id: p.id,
      memberId: p.member_id,
      chapterId: p.chapter_id,
      role: p.role,
      startedOn: p.started_on,
      endedOn: p.ended_on,
    })),
  };
}

const ok = <T extends { error: { message?: string; code?: string } | null }>(r: T): T => {
  if (r.error) throw friendlyError(r.error);
  return r;
};

export function LiveClubProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ClubData>(EMPTY_DATA);
  const [userId, setUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const today = todayIso();

  const reload = useCallback(async (signedIn: boolean) => {
    const fresh = await loadClub(signedIn);
    setData(fresh);
  }, []);

  // Follow the sign-in state, and load whatever this person is allowed to see.
  useEffect(() => {
    const db = supabase();
    let cancelled = false;
    db.auth.getSession().then(async ({ data: s }) => {
      if (cancelled) return;
      setUserId(s.session?.user.id ?? null);
      setAuthEmail(s.session?.user.email ?? null);
      try {
        await reload(!!s.session);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    const { data: sub } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      setUserId(session?.user.id ?? null);
      setAuthEmail(session?.user.email ?? null);
      // Run outside the auth callback, as Supabase recommends.
      setTimeout(() => {
        reload(!!session).catch(() => {});
      }, 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [reload]);

  const me = useMemo(() => data.members.find((m) => m.id === userId) ?? null, [data.members, userId]);
  const level = accessLevel(me, data.positions);

  const requireUser = () => {
    if (!userId) throw new NotAllowedError('Sign in first.');
    return userId;
  };
  const after = async () => reload(true);

  const value: ClubContextValue = {
    mode: 'live',
    isDemo: false,
    loading,
    data,
    me,
    level,
    today,
    authEmail,
    needsApplication: !!userId && !loading && !me,

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

    refresh: async () => reload(!!userId),

    submitApplication: async (input) => {
      const uid = requireUser();
      const db = supabase();
      ok(
        await db.rpc('submit_application', {
          p_chapter: input.chapterId,
          p_full_name: input.fullName.trim(),
          p_road_name: input.roadName.trim() || undefined,
          p_phone: input.phone.trim() || undefined,
          p_introduced_by: input.introducedBy.trim() || undefined,
          p_note: input.note.trim() || undefined,
          p_status: input.status,
        }),
      );
      if (input.bike && input.bike.make.trim() && input.bike.model.trim()) {
        ok(
          await db.from('bikes').insert({
            member_id: uid,
            make: input.bike.make.trim(),
            model: input.bike.model.trim(),
            year: input.bike.year,
          }),
        );
      }
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

    updateProfile: async (input) => {
      const uid = requireUser();
      if (!input.fullName.trim()) throw new Error('Your name can’t be blank.');
      ok(
        await supabase()
          .from('members')
          .update({
            full_name: input.fullName.trim(),
            road_name: input.roadName?.trim() || null,
            bio: input.bio?.trim() || null,
            share_phone: input.sharePhone,
          })
          .eq('id', uid),
      );
      await after();
    },

    updatePrivate: async (input) => {
      const uid = requireUser();
      ok(
        await supabase()
          .from('member_private')
          .update({
            email: input.email?.trim() || null,
            phone: input.phone?.trim() || null,
            licence_class: input.licenceClass,
            licence_expiry: input.licenceExpiry,
            first_aid_expiry: input.firstAidExpiry,
          })
          .eq('member_id', uid),
      );
      await after();
    },

    saveBike: async (bike, reg) => {
      const uid = requireUser();
      const invalid = validateBike(bike);
      if (invalid) throw new Error(invalid);
      const db = supabase();
      const fields = {
        make: bike.make.trim(),
        model: bike.model.trim(),
        year: bike.year,
        nickname: bike.nickname?.trim() || null,
        is_project: bike.isProject,
      };
      let bikeId = bike.id;
      if (bikeId) {
        ok(await db.from('bikes').update(fields).eq('id', bikeId));
      } else {
        const inserted = ok(await db.from('bikes').insert({ ...fields, member_id: uid }).select('id').single());
        bikeId = inserted.data!.id;
      }
      ok(
        await db.from('bike_registrations').upsert({
          bike_id: bikeId,
          rego: reg.rego?.trim().toUpperCase() || null,
          rego_expiry: reg.regoExpiry,
        }),
      );
      await after();
    },

    removeBike: async (bikeId) => {
      ok(await supabase().from('bikes').delete().eq('id', bikeId));
      await after();
    },

    saveContact: async (contact) => {
      const uid = requireUser();
      const invalid = validateContact(contact);
      if (invalid) throw new Error(invalid);
      const fields = {
        name: contact.name.trim(),
        relationship: contact.relationship.trim(),
        phone: contact.phone.trim(),
      };
      const db = supabase();
      if (contact.id) ok(await db.from('emergency_contacts').update(fields).eq('id', contact.id));
      else ok(await db.from('emergency_contacts').insert({ ...fields, member_id: uid }));
      await after();
    },

    removeContact: async (contactId) => {
      ok(await supabase().from('emergency_contacts').delete().eq('id', contactId));
      await after();
    },

    appoint: async (memberId, chapterId, role) => {
      const target = data.members.find((m) => m.id === memberId);
      if (!target) throw new Error('That member no longer exists.');
      const problem = checkAppoint(me, target, chapterId, role, data);
      if (problem) throw new Error(problem);
      const seatChapter = role.startsWith('nec_') ? null : chapterId;
      ok(
        await supabase()
          .from('positions')
          .insert({ member_id: memberId, chapter_id: seatChapter, role, started_on: today }),
      );
      await after();
    },

    endPosition: async (positionId) => {
      ok(await supabase().from('positions').update({ ended_on: today }).eq('id', positionId));
      await after();
    },
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
