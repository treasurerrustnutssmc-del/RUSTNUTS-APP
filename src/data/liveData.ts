// Reads everything the signed-in person is allowed to see, in one go, and turns the
// database rows (snake_case) into the app's records (camelCase).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClubData, MemberPrivate } from '../domain/types';
import { EMPTY_DATA } from './clubContext';
import type { Database, MembersMoneyRows } from './database.types';

/** Postgres timestamps ("2026-11-07T21:30:00+00:00") as the app's ISO instants. */
const instant = (ts: string) => new Date(ts).toISOString();

/** PostgREST's and Postgres's "no such function" codes. */
const MISSING_FUNCTION = ['PGRST202', '42883'];

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

  const [members, privates, phones, bikes, regos, contacts, positions, calendar, money] = await Promise.all([
    db.from('members').select('*'),
    db.from('member_private').select('*'),
    db.rpc('shared_phones'),
    db.from('bikes').select('*').order('created_at'),
    db.from('bike_registrations').select('*'),
    db.from('emergency_contacts').select('*').order('created_at'),
    db.from('positions').select('*'),
    // Rides from today on, their answers and the calendar's freshness, as one value so the API's
    // row limit can't cut the list short.
    db.rpc('ride_calendar'),
    // Stage 4: check-ins, decisions and fees in one value.
    db.rpc('members_money'),
  ]);
  // Until the database has Stage 4, the rest of the app still loads. Any other failure is an error,
  // so nobody is shown "you owe nothing" because a load went wrong.
  if (money.error && !MISSING_FUNCTION.includes(money.error.code ?? '')) throw toError(money.error);
  for (const r of [members, privates, phones, bikes, regos, contacts, positions, calendar]) {
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
    rides: (calendar.data?.rides ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: instant(r.starts_at),
      endsAt: r.ends_at ? instant(r.ends_at) : null,
      allDay: r.all_day,
      location: r.location,
      notes: r.notes,
      category: r.category,
      cancelledAt: r.cancelled_at ? instant(r.cancelled_at) : null,
    })),
    rsvps: (calendar.data?.rsvps ?? []).map((r) => ({
      rideId: r.ride_id,
      memberId: r.member_id,
      answer: r.answer,
      updatedAt: instant(r.updated_at),
    })),
    crew: (calendar.data?.crew ?? []).map((k) => ({
      rideId: k.ride_id,
      memberId: k.member_id,
      role: k.role,
      assignedBy: k.assigned_by,
      assignedAt: instant(k.assigned_at),
    })),
    ridesSyncedAt: calendar.data?.synced_at ? instant(calendar.data.synced_at) : null,
    ...stage4(money.error ? null : (money.data as MembersMoneyRows | null)),
  };
}

// Stage 4
function stage4(m: MembersMoneyRows | null): Partial<ClubData> {
  return {
    checkinSessions: (m?.sessions ?? []).map((s) => ({
      id: s.id, kind: s.kind, chapterId: s.chapter_id, rideId: s.ride_id, title: s.title, heldOn: s.held_on,
      openedBy: s.opened_by, closedAt: s.closed_at ? instant(s.closed_at) : null,
    })),
    attendance: (m?.attendance ?? []).map((a) => ({
      sessionId: a.session_id, memberId: a.member_id, checkedInAt: instant(a.checked_in_at), markedBy: a.marked_by,
    })),
    decisions: (m?.decisions ?? []).map((d) => ({
      id: d.id, memberId: d.member_id, kind: d.kind, atMonths: d.at_months, outcome: d.outcome, status: d.status,
      votesFor: d.votes_for, votesAgainst: d.votes_against, votesAbstained: d.votes_abstained, note: d.note,
      decidedOn: d.decided_on, recordedBy: d.recorded_by,
    })),
    feeRates: (m?.rates ?? []).map((r) => ({ chapterId: r.chapter_id, fy: r.fy, status: r.status, amountCents: r.amount_cents, dueOn: r.due_on })),
    continuationFees: (m?.continuation ?? []).map((f) => ({ chapterId: f.chapter_id, fy: f.fy, amountCents: f.amount_cents })),
    charges: (m?.charges ?? []).map((c) => ({
      id: c.id, memberId: c.member_id, chapterId: c.chapter_id, fy: c.fy, kind: c.kind, description: c.description,
      amountCents: c.amount_cents, dueOn: c.due_on, createdAt: instant(c.created_at), waivedAt: c.waived_at ? instant(c.waived_at) : null,
    })),
    payments: (m?.payments ?? []).map((p) => ({
      id: p.id, chargeId: p.charge_id, amountCents: p.amount_cents, paidOn: p.paid_on, method: p.method, reference: p.reference,
      state: p.state, claimedBy: p.claimed_by, receiptNo: p.receipt_no, decidedAt: p.decided_at ? instant(p.decided_at) : null,
    })),
    paymentDetails: (m?.details ?? []).map((d) => ({
      chapterId: d.chapter_id, payid: d.payid, payidName: d.payid_name, bsb: d.bsb, accountNo: d.account_no,
    })),
  };
}

