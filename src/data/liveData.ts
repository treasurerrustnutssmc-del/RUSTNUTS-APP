// Reads everything the signed-in person is allowed to see, in one go, and turns the
// database rows (snake_case) into the app's records (camelCase).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClubData, MemberPrivate } from '../domain/types';
import { EMPTY_DATA } from './clubContext';
import type { Database } from './database.types';

function toError(error: { message?: string }): Error {
  return new Error(error.message ?? 'Couldn’t load the club data.');
}

export async function loadClub(db: SupabaseClient<Database>, signedIn: boolean): Promise<ClubData> {
  const chapters = await db.from('chapters').select('*').order('name');
  if (chapters.error) throw toError(chapters.error);
  const base: ClubData = {
    ...EMPTY_DATA,
    chapters: chapters.data.map((c) => ({ id: c.id, slug: c.slug, name: c.name, area: c.area, state: c.state })),
  };
  if (!signedIn) return base;

  // Someone on the club roster gets their own record the first time they sign in. The database
  // does nothing for anyone who already has a record, and a failure here never blocks loading.
  await db.rpc('claim_roster').then(
    () => undefined,
    () => undefined,
  );

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
    if (r.error) throw toError(r.error);
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
      onHiatus: m.on_hiatus,
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

