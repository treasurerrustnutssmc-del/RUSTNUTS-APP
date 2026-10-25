// What each action does to the made-up demo club. Plain functions: they take the club as it
// is and hand back the club as it should be, or throw when the person isn't allowed. The
// demo screens use them, and src/data/parity.test.ts checks them against the database's rules.

import { appointProblem, endTermProblem, isBoardOf } from '../domain/access';
import { cleanBriefing, readBriefingProblem, saveBriefingProblem, type BriefingInput } from '../domain/briefings';
import { crewProblem, leaveProblem } from '../domain/crew';
import { cleanRoadRules, currentRoadRules, publishProblem, signProblem, type RoadRulesInput } from '../domain/roadRules';
import { NO_TRACK, readGpx } from '../domain/gpx';
import { archiveRouteProblem, NO_ROUTE, rideRouteProblem, saveRouteProblem, signedInProblem } from '../domain/routes';
import { rsvpProblem } from '../domain/rides';
import { APPROVE_AS, NATIONAL_ROLES, TITLE_ROLES } from '../domain/labels';
import type {
  BallotChoice,
  ClubData,
  CrewRole,
  Electorate,
  MeetingKind,
  Member,
  MemberStatus,
  PositionRole,
  Route,
  RsvpAnswer,
  Threshold,
} from '../domain/types';
import * as business from './businessActions';
import {
  NotAllowedError,
  validateApplicationBike,
  validateBike,
  validateContact,
  type ApplicationInput,
  type BikeInput,
  type ContactInput,
  type PrivateInput,
  type ProfileInput,
  type RegoInput,
  type RouteInput,
} from './clubContext';

export interface DemoCtx {
  data: ClubData;
  me: Member | null;
  today: string;
  /** The current instant (ISO). Defaults to the clock. */
  now?: string;
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

function requireMe(ctx: DemoCtx): Member {
  if (!ctx.me) throw new NotAllowedError('Sign in first.');
  return ctx.me;
}

function findMember(data: ClubData, id: string): Member {
  const m = data.members.find((x) => x.id === id);
  if (!m) throw new Error('That member no longer exists.');
  return m;
}

function patchMember(data: ClubData, id: string, patch: Partial<Member>): ClubData {
  return { ...data, members: data.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

function statusDates(target: Member, status: MemberStatus, today: string): Partial<Member> {
  return {
    fngStartedOn: status === 'fng' ? target.fngStartedOn ?? today : target.fngStartedOn,
    patchedOn: status === 'full' || status === 'nomad' ? target.patchedOn ?? today : target.patchedOn,
  };
}

export function apply(ctx: DemoCtx, input: ApplicationInput): { data: ClubData; id: string } {
  if (ctx.me) throw new NotAllowedError('You have already applied.');
  if (!input.fullName.trim()) throw new Error('Add your name.');
  const bikeProblem = validateApplicationBike(input.bike ?? null, ctx.today);
  if (bikeProblem) throw new Error(bikeProblem);
  const id = newId('m');
  const bikes = [...ctx.data.bikes];
  if (input.bike && input.bike.make.trim()) {
    bikes.push({
      id: newId('b'),
      memberId: id,
      make: input.bike.make.trim(),
      model: input.bike.model.trim(),
      year: input.bike.year,
      nickname: null,
      isProject: false,
    });
  }
  const data: ClubData = {
    ...ctx.data,
    members: [
      ...ctx.data.members,
      {
        id,
        chapterId: input.chapterId,
        fullName: input.fullName.trim(),
        roadName: input.roadName.trim() || null,
        status: input.status,
        approval: 'pending',
        joinedOn: null,
        patchedOn: null,
        fngStartedOn: null,
        bio: null,
        sharePhone: false,
        appliedOn: ctx.today,
        onHiatus: false,
      },
    ],
    privates: [
      ...ctx.data.privates,
      {
        memberId: id,
        email: input.email.trim() || null,
        phone: input.phone.trim() || null,
        licenceClass: null,
        licenceExpiry: null,
        firstAidExpiry: null,
        introducedBy: input.introducedBy.trim() || null,
        applicationNote: input.note.trim() || null,
      },
    ],
    bikes,
  };
  return { data, id };
}

// Same checks, in the same order and with the same words, as the database actions.
function chapterName(data: ClubData, chapterId: string): string {
  return data.chapters.find((c) => c.id === chapterId)?.name ?? 'that chapter’s';
}

export function approve(ctx: DemoCtx, memberId: string, status: MemberStatus): ClubData {
  const target = findMember(ctx.data, memberId);
  if (!isBoardOf(ctx.me, target.chapterId, ctx.data.positions)) {
    throw new NotAllowedError(`Only the ${chapterName(ctx.data, target.chapterId)} board can approve this applicant.`);
  }
  if (target.approval !== 'pending') throw new NotAllowedError('This person isn’t waiting for approval.');
  if (!APPROVE_AS.includes(status)) throw new NotAllowedError('Let them in as Introduced, FNG, Supporter or Family.');
  return patchMember(ctx.data, memberId, {
    approval: 'approved',
    status,
    joinedOn: target.joinedOn ?? ctx.today,
    ...statusDates(target, status, ctx.today),
  });
}

export function decline(ctx: DemoCtx, memberId: string): ClubData {
  const target = findMember(ctx.data, memberId);
  if (!isBoardOf(ctx.me, target.chapterId, ctx.data.positions)) {
    throw new NotAllowedError('Only that chapter’s board can decline this applicant.');
  }
  if (target.approval !== 'pending') throw new NotAllowedError('This person isn’t waiting for approval.');
  return patchMember(ctx.data, memberId, { approval: 'declined' });
}

export function setStatus(ctx: DemoCtx, memberId: string, status: MemberStatus): ClubData {
  if (ctx.me?.id === memberId) throw new NotAllowedError('You can’t change your own status.');
  const target = findMember(ctx.data, memberId);
  if (!isBoardOf(ctx.me, target.chapterId, ctx.data.positions)) {
    throw new NotAllowedError('Only that chapter’s board can change this member’s status.');
  }
  if (target.approval !== 'approved') throw new NotAllowedError('Approve them first.');
  if (status === 'legacy') {
    const holds = ctx.data.positions.some(
      (p) => p.memberId === memberId && p.endedOn === null && !TITLE_ROLES.includes(p.role),
    );
    if (holds) throw new NotAllowedError('End their positions first.');
    return patchMember(ctx.data, memberId, { status, onHiatus: false, ...statusDates(target, status, ctx.today) });
  }
  return patchMember(ctx.data, memberId, { status, ...statusDates(target, status, ctx.today) });
}

export function saveProfile(ctx: DemoCtx, profile: ProfileInput, priv: PrivateInput | null): ClubData {
  const self = requireMe(ctx);
  if (!profile.fullName.trim()) throw new Error('Your name can’t be blank.');
  let data = patchMember(ctx.data, self.id, {
    fullName: profile.fullName.trim(),
    roadName: profile.roadName?.trim() || null,
    bio: profile.bio?.trim() || null,
    sharePhone: profile.sharePhone,
  });
  if (priv) {
    data = {
      ...data,
      privates: data.privates.map((p) =>
        p.memberId === self.id
          ? {
              ...p,
              email: priv.email?.trim() || null,
              phone: priv.phone?.trim() || null,
              licenceClass: priv.licenceClass,
              licenceExpiry: priv.licenceExpiry,
              firstAidExpiry: priv.firstAidExpiry,
            }
          : p,
      ),
    };
  }
  return data;
}

export function saveBike(ctx: DemoCtx, bike: BikeInput, reg: RegoInput): { data: ClubData; id: string } {
  const self = requireMe(ctx);
  const invalid = validateBike(bike, ctx.today);
  if (invalid) throw new Error(invalid);
  if (bike.id) {
    const existing = ctx.data.bikes.find((b) => b.id === bike.id);
    if (!existing || existing.memberId !== self.id) throw new NotAllowedError('You can only edit your own bikes.');
  }
  const id = bike.id ?? newId('b');
  const record = {
    ...bike,
    id,
    memberId: self.id,
    make: bike.make.trim(),
    model: bike.model.trim(),
    nickname: bike.nickname?.trim() || null,
  };
  const bikes = bike.id ? ctx.data.bikes.map((b) => (b.id === id ? record : b)) : [...ctx.data.bikes, record];
  const registrations = [
    ...ctx.data.registrations.filter((r) => r.bikeId !== id),
    { bikeId: id, rego: reg.rego?.trim().toUpperCase() || null, regoExpiry: reg.regoExpiry },
  ];
  return { data: { ...ctx.data, bikes, registrations }, id };
}

export function removeBike(ctx: DemoCtx, bikeId: string): ClubData {
  const self = requireMe(ctx);
  const bike = ctx.data.bikes.find((b) => b.id === bikeId);
  if (!bike || bike.memberId !== self.id) throw new NotAllowedError('You can only remove your own bikes.');
  return {
    ...ctx.data,
    bikes: ctx.data.bikes.filter((b) => b.id !== bikeId),
    registrations: ctx.data.registrations.filter((r) => r.bikeId !== bikeId),
  };
}

export function saveContact(ctx: DemoCtx, contact: ContactInput): ClubData {
  const self = requireMe(ctx);
  const invalid = validateContact(contact);
  if (invalid) throw new Error(invalid);
  if (contact.id) {
    const existing = ctx.data.emergencyContacts.find((c) => c.id === contact.id);
    if (!existing || existing.memberId !== self.id) throw new NotAllowedError('You can only edit your own contacts.');
  }
  const id = contact.id ?? newId('e');
  const record = {
    id,
    memberId: self.id,
    name: contact.name.trim(),
    relationship: contact.relationship.trim(),
    phone: contact.phone.trim(),
  };
  const emergencyContacts = contact.id
    ? ctx.data.emergencyContacts.map((c) => (c.id === id ? record : c))
    : [...ctx.data.emergencyContacts, record];
  return { ...ctx.data, emergencyContacts };
}

export function removeContact(ctx: DemoCtx, contactId: string): ClubData {
  const self = requireMe(ctx);
  const c = ctx.data.emergencyContacts.find((x) => x.id === contactId);
  if (!c || c.memberId !== self.id) throw new NotAllowedError('You can only remove your own contacts.');
  return { ...ctx.data, emergencyContacts: ctx.data.emergencyContacts.filter((x) => x.id !== contactId) };
}

export function appoint(ctx: DemoCtx, memberId: string, chapterId: string | null, role: PositionRole): ClubData {
  const target = findMember(ctx.data, memberId);
  const problem = appointProblem(ctx.me, target, chapterId, role, ctx.data);
  if (problem) throw new NotAllowedError(problem);
  const seatChapter = NATIONAL_ROLES.includes(role) ? null : chapterId;
  return {
    ...ctx.data,
    positions: [
      ...ctx.data.positions,
      { id: newId('p'), memberId, chapterId: seatChapter, role, startedOn: ctx.today, endedOn: null },
    ],
  };
}

export function endTerm(ctx: DemoCtx, positionId: string): ClubData {
  const position = ctx.data.positions.find((p) => p.id === positionId);
  if (!position) throw new Error('That position no longer exists.');
  const problem = endTermProblem(ctx.me, position, ctx.data);
  if (problem) throw new NotAllowedError(problem);
  return {
    ...ctx.data,
    positions: ctx.data.positions.map((p) => (p.id === positionId ? { ...p, endedOn: ctx.today } : p)),
  };
}

export function setRsvp(ctx: DemoCtx, rideId: string, answer: RsvpAnswer): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const problem = rsvpProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), now);
  if (problem) throw new NotAllowedError(problem);
  const memberId = ctx.me!.id;
  const others = ctx.data.rsvps.filter((r) => !(r.rideId === rideId && r.memberId === memberId));
  const next: ClubData = { ...ctx.data, rsvps: [...others, { rideId, memberId, answer, updatedAt: now }] };
  // Anything but Going takes you off the ride's crew.
  if (answer === 'going' || !ctx.data.crew) return next;
  return { ...next, crew: ctx.data.crew.filter((s) => !(s.rideId === rideId && s.memberId === memberId)) };
}

/** Puts `memberId` in a crew spot. A manager's pick replaces whoever held a single spot, a move replaces your old spot, and the target is then going. */
export function setCrew(ctx: DemoCtx, rideId: string, memberId: string, role: CrewRole): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const ride = ctx.data.rides.find((r) => r.id === rideId);
  const target = ctx.data.members.find((m) => m.id === memberId);
  const problem = crewProblem(ctx.me, ride, target, role, ctx.data, now);
  if (problem) throw new NotAllowedError(problem);
  const kept = (ctx.data.crew ?? []).filter(
    (s) => !(s.rideId === rideId && (s.memberId === memberId || (role !== 'officer' && s.role === role))),
  );
  const rsvps = ctx.data.rsvps.filter((r) => !(r.rideId === rideId && r.memberId === memberId));
  return {
    ...ctx.data,
    crew: [...kept, { rideId, memberId, role, assignedBy: ctx.me!.id, assignedAt: now }],
    rsvps: [...rsvps, { rideId, memberId, answer: 'going', updatedAt: now }],
  };
}

/** Takes `memberId` off the ride's crew. */
export function leaveCrew(ctx: DemoCtx, rideId: string, memberId: string): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const problem = leaveProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), memberId, ctx.data, now);
  if (problem) throw new NotAllowedError(problem);
  return { ...ctx.data, crew: (ctx.data.crew ?? []).filter((s) => !(s.rideId === rideId && s.memberId === memberId)) };
}

/** The text a saved GPX file is kept as: a leading byte order mark is cut off, as the database does. */
export const storedGpx = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Adds a route (id null) or changes one. The rule checks come first, then the file, the same
 * order as public.save_route. A null `gpx` keeps the route's file and its summary. The demo
 * keeps the files themselves apart from the club data (see DemoClubProvider), so the caller
 * stores `storedGpx(input.gpx)` under the returned id.
 */
export function saveRoute(ctx: DemoCtx, input: RouteInput): { data: ClubData; id: string } {
  const now = ctx.now ?? new Date().toISOString();
  const routes = ctx.data.routes ?? [];
  const existing = input.id === null ? undefined : routes.find((r) => r.id === input.id);
  const problem = saveRouteProblem(ctx.me, existing, input, ctx.data);
  if (problem) throw new NotAllowedError(problem);
  let summary: Pick<Route, 'distanceM' | 'climbM' | 'line' | 'stops' | 'bounds'>;
  if (input.gpx === null) {
    if (!existing) throw new Error(NO_TRACK);
    summary = existing;
  } else {
    const read = readGpx(input.gpx);
    if (typeof read === 'string') throw new Error(read);
    summary = read;
  }
  const id = existing?.id ?? newId('rt');
  const record: Route = {
    id,
    name: input.name.trim(),
    chapterId: input.chapterId,
    notes: input.notes.trim(),
    distanceM: summary.distanceM,
    climbM: summary.climbM,
    line: summary.line,
    stops: summary.stops,
    bounds: summary.bounds,
    archivedAt: existing?.archivedAt ?? null,
    updatedAt: now,
  };
  return {
    data: { ...ctx.data, routes: existing ? routes.map((r) => (r.id === id ? record : r)) : [...routes, record] },
    id,
  };
}

/** Archives a route. Archiving an archived route changes nothing. */
export function archiveRoute(ctx: DemoCtx, routeId: string): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const routes = ctx.data.routes ?? [];
  const route = routes.find((r) => r.id === routeId);
  const problem = archiveRouteProblem(ctx.me, route, ctx.data);
  if (problem) throw new NotAllowedError(problem);
  if (route!.archivedAt) return ctx.data;
  return { ...ctx.data, routes: routes.map((r) => (r.id === routeId ? { ...r, archivedAt: now, updatedAt: now } : r)) };
}

/** Chooses a ride's route, or clears it (null). */
export function setRideRoute(ctx: DemoCtx, rideId: string, routeId: string | null): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const ride = ctx.data.rides.find((r) => r.id === rideId);
  const route = routeId === null ? null : (ctx.data.routes ?? []).find((r) => r.id === routeId);
  const problem = rideRouteProblem(ctx.me, ride, route, ctx.data, now);
  if (problem) throw new NotAllowedError(problem);
  const others = (ctx.data.rideRoutes ?? []).filter((r) => r.rideId !== rideId);
  return { ...ctx.data, rideRoutes: routeId === null ? others : [...others, { rideId, routeId }] };
}

/** One route's GPX file from the demo's files. Mirrors public.route_gpx. */
export function routeGpx(ctx: DemoCtx, files: ReadonlyMap<string, string>, routeId: string): string {
  const problem = signedInProblem(ctx.me);
  if (problem) throw new NotAllowedError(problem);
  const file = (ctx.data.routes ?? []).some((r) => r.id === routeId) ? files.get(routeId) : undefined;
  if (file === undefined) throw new Error(NO_ROUTE);
  return file;
}

/**
 * Writes a ride's briefing, or replaces it: cleaned, and stamped with who and when, on top of the
 * version the editor opened on (`seen`). The writer's own read moves to the same time, so their
 * update never shows them as unread. Mirrors public.save_briefing.
 */
export function saveBriefing(ctx: DemoCtx, rideId: string, input: BriefingInput, seen: string | null): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const ride = ctx.data.rides.find((r) => r.id === rideId);
  const problem = saveBriefingProblem(ctx.me, ride, input, ctx.data, now, seen);
  if (problem) throw new NotAllowedError(problem);
  const memberId = ctx.me!.id;
  const others = (ctx.data.briefings ?? []).filter((b) => b.rideId !== rideId);
  return {
    ...ctx.data,
    briefings: [...others, { rideId, ...cleanBriefing(input), updatedAt: now, updatedBy: memberId }],
    briefingReads: withRead(ctx.data, rideId, memberId, now),
  };
}

/** The reads with this member's read of this ride set to `at`. */
function withRead(data: ClubData, rideId: string, memberId: string, at: string) {
  const others = (data.briefingReads ?? []).filter((r) => !(r.rideId === rideId && r.memberId === memberId));
  return [...others, { rideId, memberId, readAt: at }];
}

/**
 * Got it: your read of the ride's briefing, now, for the version on screen (`seen`). Reading
 * again moves it. Mirrors public.read_briefing.
 */
export function readBriefing(ctx: DemoCtx, rideId: string, seen: string | null): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const problem = readBriefingProblem(ctx.me, ctx.data.rides.find((r) => r.id === rideId), ctx.data, seen);
  if (problem) throw new NotAllowedError(problem);
  return { ...ctx.data, briefingReads: withRead(ctx.data, rideId, ctx.me!.id, now) };
}

/**
 * Publishes the next version of the Road Rules: cleaned (fresh forced on for version 1), and
 * stamped with who and when. `seen` is the current number the editor opened on (0 when there
 * were none). Mirrors public.publish_road_rules.
 */
export function publishRoadRules(ctx: DemoCtx, input: RoadRulesInput, seen: number): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const problem = publishProblem(ctx.me, input, seen, ctx.data);
  if (problem) throw new NotAllowedError(problem);
  const number = (currentRoadRules(ctx.data)?.number ?? 0) + 1;
  return {
    ...ctx.data,
    roadRules: [
      ...(ctx.data.roadRules ?? []),
      { number, ...cleanRoadRules(input, ctx.data), publishedAt: now, publishedBy: ctx.me!.id },
    ],
  };
}

/**
 * Signs the current version of the Road Rules, now: your one sign-off row is replaced. `version`
 * is the number on screen. Mirrors public.sign_road_rules.
 */
export function signRoadRules(ctx: DemoCtx, version: number): ClubData {
  const now = ctx.now ?? new Date().toISOString();
  const problem = signProblem(ctx.me, version, ctx.data);
  if (problem) throw new NotAllowedError(problem);
  const memberId = ctx.me!.id;
  const others = (ctx.data.roadRulesSignoffs ?? []).filter((s) => s.memberId !== memberId);
  return { ...ctx.data, roadRulesSignoffs: [...others, { memberId, version, signedAt: now }] };
}

/** The actions the shared parity cases use, by name. */
export type DemoAction =
  | { action: 'appoint'; member: string; chapter: string | null; role: PositionRole }
  | { action: 'endTerm'; position: string }
  | { action: 'approve'; member: string; status: MemberStatus }
  | { action: 'decline'; member: string }
  | { action: 'setStatus'; member: string; status: MemberStatus }
  | { action: 'removeBike'; bike: string }
  | { action: 'removeContact'; contact: string }
  | { action: 'saveBike'; bike: string | null; make: string; model: string; year: number | null }
  | { action: 'saveContact'; contact: string | null; contactName: string; relationship: string; phone: string }
  | { action: 'apply'; chapter: string; fullName: string; make: string; model: string; year: number | null }
  | { action: 'rsvp'; ride: string; answer: RsvpAnswer }
  // Stage 5: meetings and votes
  | { action: 'saveMeeting'; chapter: string | null; kind: MeetingKind; title: string; startsAt: string }
  | { action: 'approveMinutes'; meeting: string }
  | { action: 'saveActionItem'; chapter: string | null; meeting: string | null; title: string; owner: string }
  | {
      action: 'openVote'; chapter: string | null; subject: string | null; electorate: Electorate; threshold: Threshold;
      secret?: boolean; quorum: number; days: number;
    }
  | { action: 'castBallot'; vote: string; choice: BallotChoice }
  | { action: 'closeVote'; vote: string; casting: 'yes' | 'no' | null }
  | { action: 'crew'; ride: string; member: string; role: CrewRole }
  | { action: 'leaveCrew'; ride: string; member: string }
  | { action: 'saveRoute'; route: string | null; routeName: string; chapter: string | null; notes?: string; gpx: string | null }
  | { action: 'archiveRoute'; route: string }
  | { action: 'setRideRoute'; ride: string; route: string | null }
  // `repeat` writes the changes and the notes out that many times, for the length limits. `seen`
  // is the briefing's version the action was made on (null: none).
  | { action: 'saveBriefing'; ride: string; hazards: string[]; changes: string; notes: string; repeat?: number; seen: string | null }
  | { action: 'readBriefing'; ride: string; seen: string | null }
  // `repeat` writes the text and what changed out that many times, for the length limits. `seen`
  // is the current version number the editor opened on (0: none).
  | { action: 'publishRoadRules'; body: string; changes: string; fresh: boolean; seen: number; repeat?: number }
  | { action: 'signRoadRules'; version: number };

export function runDemoAction(ctx: DemoCtx, a: DemoAction): ClubData {
  switch (a.action) {
    case 'appoint':
      return appoint(ctx, a.member, a.chapter, a.role);
    case 'endTerm':
      return endTerm(ctx, a.position);
    case 'approve':
      return approve(ctx, a.member, a.status);
    case 'decline':
      return decline(ctx, a.member);
    case 'setStatus':
      return setStatus(ctx, a.member, a.status);
    case 'removeBike':
      return removeBike(ctx, a.bike);
    case 'rsvp':
      return setRsvp(ctx, a.ride, a.answer);
    case 'crew':
      return setCrew(ctx, a.ride, a.member, a.role);
    case 'leaveCrew':
      return leaveCrew(ctx, a.ride, a.member);
    case 'saveRoute':
      return saveRoute(ctx, { id: a.route, name: a.routeName, chapterId: a.chapter, notes: a.notes ?? '', gpx: a.gpx }).data;
    case 'archiveRoute':
      return archiveRoute(ctx, a.route);
    case 'setRideRoute':
      return setRideRoute(ctx, a.ride, a.route);
    case 'saveBriefing':
      return saveBriefing(ctx, a.ride, {
        hazards: a.hazards,
        changes: a.changes.repeat(a.repeat ?? 1),
        notes: a.notes.repeat(a.repeat ?? 1),
      }, a.seen);
    case 'readBriefing':
      return readBriefing(ctx, a.ride, a.seen);
    case 'publishRoadRules':
      return publishRoadRules(ctx, {
        body: a.body.repeat(a.repeat ?? 1),
        changes: a.changes.repeat(a.repeat ?? 1),
        fresh: a.fresh,
      }, a.seen);
    case 'signRoadRules':
      return signRoadRules(ctx, a.version);
    case 'removeContact':
      return removeContact(ctx, a.contact);
    case 'saveBike':
      return saveBike(
        ctx,
        { id: a.bike, make: a.make, model: a.model, year: a.year, nickname: null, isProject: false },
        { rego: null, regoExpiry: null },
      ).data;
    case 'saveContact':
      return saveContact(ctx, { id: a.contact, name: a.contactName, relationship: a.relationship, phone: a.phone });
    case 'apply':
      return apply(ctx, {
        chapterId: a.chapter,
        fullName: a.fullName,
        roadName: '',
        email: '',
        phone: '',
        introducedBy: '',
        note: '',
        status: 'introduced',
        bike: { make: a.make, model: a.model, year: a.year },
      }).data;
    // Stage 5: meetings and votes
    case 'saveMeeting':
      return business.saveMeeting(ctx, {
        id: null, chapterId: a.chapter, kind: a.kind, title: a.title, startsAt: new Date(a.startsAt).toISOString(), location: null, agenda: [],
      }).data;
    case 'approveMinutes':
      return business.approveMinutes(ctx, a.meeting);
    case 'saveActionItem':
      return business.saveActionItem(ctx, {
        id: null, chapterId: a.chapter, meetingId: a.meeting, title: a.title, ownerId: a.owner, dueOn: null,
      }).data;
    case 'openVote':
      return business.openVote(ctx, {
        chapterId: a.chapter, meetingId: null, subjectMemberId: a.subject, question: 'Shall we?', details: null,
        electorate: a.electorate, threshold: a.threshold, secret: a.secret ?? false, quorum: a.quorum,
        closesAt: new Date(Date.now() + a.days * 86_400_000).toISOString(),
      }).data;
    case 'castBallot':
      return business.castBallot(ctx, a.vote, a.choice);
    case 'closeVote':
      return business.closeVote(ctx, a.vote, a.casting);
  }
}
