// Reads everything the signed-in person is allowed to see, in one go, and turns the
// database rows (snake_case) into the app's records (camelCase).

import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanBriefing, isVersionRefusal, type BriefingInput } from '../domain/briefings';
import { cleanRoadRules, type RoadRulesInput } from '../domain/roadRules';
import type { BusInput } from '../domain/bus';
import type { ClubData, MemberPrivate, Route } from '../domain/types';
import { toBusiness } from './businessLive';
import { toLedger } from './ledgerLive'; // Stage 5B
import { toAdmin } from './adminLive'; // Stage 5D
import { EMPTY_DATA } from './clubContext';
import type { Database, MembersMoneyRows } from './database.types';

/** Postgres timestamps ("2026-11-07T21:30:00+00:00") as the app's ISO instants. */
const instant = (ts: string) => new Date(ts).toISOString();

/** PostgREST's and Postgres's "no such function" codes. */
const MISSING_FUNCTION = ['PGRST202', '42883'];
/** PostgREST's and Postgres's "no such table" codes. */
const MISSING_TABLE = ['PGRST205', '42P01'];
/**
 * The library's columns: everything but the GPX file, which members can't select (it can be
 * 5 MB a route; one route's file comes through route_gpx). select('*') would be refused.
 */
export const ROUTE_COLUMNS = 'id, name, chapter_id, notes, distance_m, climb_m, line, stops, bounds, archived_at, updated_at';

/** A route's bounds, taken from its line when none were stored. */
function boundsOf(line: [number, number][]): Route['bounds'] {
  if (line.length === 0) return { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 };
  const lats = line.map((p) => p[0]);
  const lngs = line.map((p) => p[1]);
  return { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) };
}

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

  const [
    members, privates, phones, bikes, regos, contacts, positions, routes, calendar, money, rulesVersions, rulesSignoffs, bus,
  ] = await Promise.all([
    db.from('members').select('*'),
    db.from('member_private').select('*'),
    db.rpc('shared_phones'),
    db.from('bikes').select('*').order('created_at'),
    db.from('bike_registrations').select('*'),
    db.from('emergency_contacts').select('*').order('created_at'),
    db.from('positions').select('*'),
    db.from('routes').select(ROUTE_COLUMNS),
    // Rides from today on, their answers and the calendar's freshness, as one value so the API's
    // row limit can't cut the list short.
    db.rpc('ride_calendar'),
    // Stage 4: check-ins, decisions and fees in one value.
    db.rpc('members_money'),
    // The Road Rules: every version and everyone's latest sign-off. Only approved members get rows.
    db.from('road_rules_versions').select('*'),
    db.from('road_rules_signoffs').select('*'),
    // The Rusty Bus: every booking, in any status. Only approved members get rows.
    db.from('bus_bookings').select('*'),
  ]);
  // Until the database has Stage 4, the rest of the app still loads. Any other failure is an error,
  // so nobody is shown "you owe nothing" because a load went wrong.
  if (money.error && !MISSING_FUNCTION.includes(money.error.code ?? '')) throw toError(money.error);
  // The same for the Rusty Bus: until the database has its table, the club loads with no bookings.
  if (bus.error && !MISSING_TABLE.includes(bus.error.code ?? '')) throw toError(bus.error);
  for (const r of [members, privates, phones, bikes, regos, contacts, positions, routes, calendar, rulesVersions, rulesSignoffs]) {
    if (r.error) throw toError(r.error);
  }
  // Stage 5: meetings and votes. A failure here leaves the club business empty rather than
  // blocking the whole app (it also covers the moment before the live database has the tables).
  const business = toBusiness(
    await db.rpc('club_business').then(
      (r) => {
        if (r.error) console.warn('club_business:', r.error.message);
        return r.error ? null : r.data;
      },
      () => null,
    ),
  );

  // Stage 5B: the treasurer's books, the same way: empty rather than blocking the app.
  const ledger = toLedger(
    await db.rpc('club_ledger').then(
      (r) => {
        if (r.error) console.warn('club_ledger:', r.error.message);
        return r.error ? null : r.data;
      },
      () => null,
    ),
  );

  // Stage 5D: conduct records, merch, contributions and new chapters, the same way.
  const admin = toAdmin(
    await db.rpc('club_admin').then(
      (r) => {
        if (r.error) console.warn('club_admin:', r.error.message);
        return r.error ? null : r.data;
      },
      () => null,
    ),
  );

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
    routes: (routes.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      chapterId: r.chapter_id,
      notes: r.notes ?? '',
      distanceM: r.distance_m,
      climbM: r.climb_m,
      line: r.line ?? [],
      stops: r.stops ?? [],
      bounds: r.bounds ?? boundsOf(r.line ?? []),
      archivedAt: r.archived_at ? instant(r.archived_at) : null,
      updatedAt: instant(r.updated_at),
    })),
    // Missing for anyone who isn't an approved member.
    // A cleared route is stored as a row with no route; the calendar leaves those out, and so do we.
    rideRoutes: (calendar.data?.ride_routes ?? [])
      .filter((r) => r.route_id != null)
      .map((r) => ({ rideId: r.ride_id, routeId: r.route_id })),
    // Also missing for anyone who isn't an approved member. The database keeps empty texts as null.
    briefings: (calendar.data?.briefings ?? []).map((b) => ({
      rideId: b.ride_id,
      hazards: b.hazards ?? [],
      changes: b.changes ?? '',
      notes: b.notes ?? '',
      updatedAt: instant(b.updated_at),
      updatedBy: b.updated_by,
    })),
    briefingReads: (calendar.data?.briefing_reads ?? []).map((r) => ({
      rideId: r.ride_id,
      memberId: r.member_id,
      readAt: instant(r.read_at),
    })),
    // A blank What changed is stored as null.
    roadRules: (rulesVersions.data ?? []).map((v) => ({
      number: v.number,
      body: v.body,
      changes: v.changes ?? '',
      fresh: v.fresh,
      publishedAt: instant(v.published_at),
      publishedBy: v.published_by,
    })),
    roadRulesSignoffs: (rulesSignoffs.data ?? []).map((s) => ({
      memberId: s.member_id,
      version: s.version,
      signedAt: instant(s.signed_at),
    })),
    // Blank notes and reasons are stored as null.
    busBookings: (bus.error ? [] : bus.data ?? []).map((b) => ({
      id: b.id,
      firstDay: b.first_day,
      lastDay: b.last_day,
      purpose: b.purpose,
      rideId: b.ride_id,
      driverId: b.driver_id,
      notes: b.notes ?? '',
      status: b.status,
      bookedBy: b.booked_by,
      bookedAt: instant(b.booked_at),
      decidedBy: b.decided_by,
      decidedAt: b.decided_at ? instant(b.decided_at) : null,
      declineReason: b.decline_reason ?? '',
      cancelledBy: b.cancelled_by,
      cancelledAt: b.cancelled_at ? instant(b.cancelled_at) : null,
    })),
    ridesSyncedAt: calendar.data?.synced_at ? instant(calendar.data.synced_at) : null,
    // Stage 5: meetings and votes
    ...business,
    ...ledger,
    ...admin,
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
    agms: (m?.agms ?? []).map((a) => ({ year: a.year, heldOn: a.held_on })),
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


// ---------------------------------------------------------------------------
// Ride briefings
// ---------------------------------------------------------------------------

/** save_briefing's arguments: the briefing cleaned, and the version the editor opened on (null: none). */
export function saveBriefingArgs(rideId: string, input: BriefingInput, seen: string | null) {
  const cleaned = cleanBriefing(input);
  return { p_ride: rideId, p_hazards: cleaned.hazards, p_changes: cleaned.changes, p_notes: cleaned.notes, p_seen: seen };
}

/** read_briefing's arguments: the ride, and the version of its briefing on screen. */
export function readBriefingArgs(rideId: string, seen: string | null) {
  return { p_ride: rideId, p_seen: seen };
}

/**
 * Runs a briefing action. When it's refused because a newer briefing has been saved (by the app's
 * own check or by the database), the calendar reloads first so the screen shows the newer one,
 * then the refusal goes on to the screen. `isNewer` says which refusals those are: the briefing
 * ones unless told otherwise.
 */
export async function reloadOnNewerVersion(
  action: () => Promise<void>,
  reload: () => Promise<void>,
  isNewer: (e: unknown) => boolean = isVersionRefusal,
): Promise<void> {
  try {
    await action();
  } catch (e) {
    if (isNewer(e)) await reload();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Road Rules
// ---------------------------------------------------------------------------

/**
 * publish_road_rules's arguments: the texts cleaned (fresh on for version 1), and the current
 * version number the editor opened on (0 when there were none).
 */
export function publishRoadRulesArgs(input: RoadRulesInput, seen: number, data: ClubData) {
  const cleaned = cleanRoadRules(input, data);
  return { p_body: cleaned.body, p_changes: cleaned.changes, p_fresh: cleaned.fresh, p_seen: seen };
}

/** sign_road_rules's arguments: the version on screen. */
export function signRoadRulesArgs(version: number) {
  return { p_version: version };
}

// ---------------------------------------------------------------------------
// The Rusty Bus
// ---------------------------------------------------------------------------

/** book_bus's arguments: the days (missing as none), and the notes trimmed (blank as none). */
export function bookBusArgs(input: BusInput) {
  return {
    p_first: input.firstDay || null,
    p_last: input.lastDay || null,
    p_purpose: input.purpose,
    p_ride: input.rideId,
    p_driver: input.driverId,
    p_notes: input.notes.trim() || null,
  };
}

/** decide_bus's arguments: a no's reason trimmed (blank as none); a yes keeps no reason. */
export function decideBusArgs(bookingId: string, yes: boolean, reason: string) {
  return { p_booking: bookingId, p_yes: yes, p_reason: yes ? null : reason.trim() || null };
}

/** cancel_bus's arguments: the booking. */
export function cancelBusArgs(bookingId: string) {
  return { p_booking: bookingId };
}
