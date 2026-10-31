// What each social action does to the demo's social data. Plain functions, like ../demoActions:
// they take the data as it is and hand back the data as it should be, or throw with the same words
// the database uses. src/data/parity.test.ts checks them against the database's rules.

import { approvalProblem } from '../../domain/chat';
import {
  archiveProblem,
  cleanMechanic,
  mechanicProblem,
  skillsProblem,
  vouchProblem,
  type HelpSkill,
  type Mechanic,
  type MechanicInput,
  type MechanicVouch,
  type MemberSkills,
} from '../../domain/social/help';
import { birthdayProblem, type Birthday } from '../../domain/social/shoutouts';
import {
  cleanListing,
  listingProblem,
  soldProblem,
  takeDownProblem,
  type Listing,
  type ListingInput,
  type ListingKind,
  type ListingPhoto,
} from '../../domain/social/swap';
import { buildPostProblem, buildTakeDownProblem, cleanBuildPost, type BuildPost, type BuildUpdate } from '../../domain/social/builds';
import {
  archiveEntryProblem,
  archiveHonourProblem,
  cleanEntry,
  cleanHonour,
  historyProblem,
  honourProblem,
  type HistoryEntry,
  type HistoryInput,
  type HistoryPrecision,
  type Honour,
  type HonourInput,
} from '../../domain/social/history';
import {
  archiveAwardProblem,
  awardPhase,
  cleanAward,
  cleanNomination,
  nominationProblem,
  openAwardProblem,
  voteProblem,
  withdrawProblem,
  type Award,
  type AwardInput,
  type BragKind,
  type Nomination,
  type NominationInput,
  type Tally,
  type Vote,
} from '../../domain/social/brag';
import {
  answerProblem,
  archiveClubProblem,
  archiveInviteProblem,
  cleanAnswer,
  cleanClub,
  cleanInviteIn,
  clubProblem,
  inviteInProblem,
  inviteOutProblem,
  type AnswerInput,
  type ClubInvite,
  type InviteInInput,
  type InviteOutInput,
  type OtherClub,
  type OtherClubInput,
} from '../../domain/invites'; // Invites to and from other clubs
import { rideChapterId } from '../../domain/attendance';
import {
  canActOnContentReport, REPORT_KINDS, reportContentProblem, resolveContentReportProblem,
  type ContentReport, type OpenReportRef, type ReportKind, type ReportTarget,
} from '../../domain/reports'; // Member content rules
import type { ClubData, Member, Ride } from '../../domain/types';
import type { FeedItem } from '../chat/chatContext';
import { NotAllowedError } from '../clubContext';

export interface SocialData {
  /** Shared birthdays only: taking one off removes it here (the database keeps a "not shared" row). */
  birthdays: Birthday[];
  /** Photos from earlier years, for On this day (the demo's chats only go back a fortnight). */
  pastPhotos: FeedItem[];
  // Who can help
  skills: MemberSkills[];
  /** Every workshop, archived ones included. */
  mechanics: Mechanic[];
  vouches: MechanicVouch[];
  /** Every listing, taken-down ones included. */
  listings: Listing[];
  /** Every build update, taken-down ones included. */
  buildUpdates: BuildUpdate[];
  /** The club's timeline and honours, ones taken off included. */
  history: HistoryEntry[];
  honours: Honour[];
  /** Bragging rights: awards, nominations and every vote (the database shows each member only their own). */
  awards: Award[];
  nominations: Nomination[];
  bragVotes: Vote[];
  /** Invites to and from other clubs: the clubs and every invite, ones taken off included. */
  otherClubs: OtherClub[];
  invites: ClubInvite[];
  /** Reports on listings, build updates, nominations, workshops and profiles, dealt-with ones included. */
  contentReports: ContentReport[];
}

export interface SocialCtx {
  social: SocialData;
  club: ClubData;
  me: Member | null;
  /** The club's date (Melbourne), ISO. */
  today: string;
  /** The current instant (ISO), for stamps. */
  now?: string;
}

const refuse = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

/** Shares (or changes) my birthday; two nulls take it off. */
export function setBirthday(ctx: SocialCtx, month: number | null, day: number | null): SocialData {
  refuse(approvalProblem(ctx.me));
  refuse(birthdayProblem(month, day));
  const me = ctx.me as Member;
  const others = ctx.social.birthdays.filter((b) => b.memberId !== me.id);
  return {
    ...ctx.social,
    birthdays: month === null || day === null ? others : [...others, { memberId: me.id, month, day }],
  };
}

/** Sets my skills: each once, in the order given. */
export function setSkills(ctx: SocialCtx, skills: string[]): SocialData {
  refuse(skillsProblem(ctx.me, skills));
  const me = ctx.me as Member;
  const once = [...new Set(skills)] as HelpSkill[];
  return { ...ctx.social, skills: [...ctx.social.skills.filter((s) => s.memberId !== me.id), { memberId: me.id, skills: once }] };
}

/** Adds (input.id null) or changes a workshop; hands back its id. */
export function saveMechanic(ctx: SocialCtx, input: MechanicInput): { social: SocialData; id: string } {
  refuse(mechanicProblem(ctx.me, input, ctx.social.mechanics, ctx.club.positions));
  const me = ctx.me as Member;
  const clean = cleanMechanic(input);
  if (input.id === null) {
    const id = `mech-${ctx.social.mechanics.length + 1}-${Date.now().toString(36)}`;
    const added: Mechanic = { id, ...clean, addedBy: me.id, addedAt: ctx.now ?? new Date().toISOString(), archivedAt: null };
    return { social: { ...ctx.social, mechanics: [...ctx.social.mechanics, added] }, id };
  }
  return {
    social: { ...ctx.social, mechanics: ctx.social.mechanics.map((m) => (m.id === input.id ? { ...m, ...clean } : m)) },
    id: input.id,
  };
}

export function archiveMechanic(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveProblem(ctx.me, id, ctx.social.mechanics, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, mechanics: ctx.social.mechanics.map((m) => (m.id === id ? { ...m, archivedAt: at } : m)) };
}

export function vouchMechanic(ctx: SocialCtx, id: string, on: boolean): SocialData {
  refuse(vouchProblem(ctx.me, id, ctx.social.mechanics));
  const me = ctx.me as Member;
  const others = ctx.social.vouches.filter((v) => !(v.mechanicId === id && v.memberId === me.id));
  return { ...ctx.social, vouches: [...others, { mechanicId: id, memberId: me.id, vouched: on }] };
}

/** Lists something (input.id null) or changes my listing; hands back its id. */
export function saveListing(ctx: SocialCtx, input: ListingInput): { social: SocialData; id: string } {
  refuse(listingProblem(ctx.me, input, ctx.social.listings));
  const me = ctx.me as Member;
  const clean = cleanListing(input);
  const photos = clean.photos.map((p) => ({ path: p.path, width: Math.round(p.width), height: Math.round(p.height) }));
  if (input.id === null) {
    const id = `listing-${ctx.social.listings.length + 1}-${Date.now().toString(36)}`;
    const at = ctx.now ?? new Date().toISOString();
    const added: Listing = { id, sellerId: me.id, ...clean, photos, listedAt: at, soldAt: null, takenDownAt: null };
    return { social: { ...ctx.social, listings: [...ctx.social.listings, added] }, id };
  }
  return {
    social: { ...ctx.social, listings: ctx.social.listings.map((l) => (l.id === input.id ? { ...l, ...clean, photos } : l)) },
    id: input.id,
  };
}

export function markListingSold(ctx: SocialCtx, id: string, sold: boolean): SocialData {
  refuse(soldProblem(ctx.me, id, ctx.social.listings));
  const at = ctx.now ?? new Date().toISOString();
  return {
    ...ctx.social,
    listings: ctx.social.listings.map((l) => (l.id === id ? { ...l, soldAt: sold ? l.soldAt ?? at : null } : l)),
  };
}

export function takeDownListing(ctx: SocialCtx, id: string): SocialData {
  refuse(takeDownProblem(ctx.me, id, ctx.social.listings, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, listings: ctx.social.listings.map((l) => (l.id === id ? { ...l, takenDownAt: at } : l)) };
}

// Member content rules: reporting what members post outside the chats ---------------------------

/** The thing a report is about, as the rules see it, or undefined when there's no such thing. */
export function findReportTarget(kind: ReportKind, id: string, social: SocialData, club: ClubData): ReportTarget | undefined {
  const lines = (...parts: (string | null | undefined)[]) => parts.filter((p) => !!p).join('\n');
  if (kind === 'listing') {
    const l = social.listings.find((x) => x.id === id);
    return l && { kind, id, authorId: l.sellerId, gone: !!l.takenDownAt, snapshot: lines(l.title, l.details) };
  }
  if (kind === 'build_update') {
    const u = social.buildUpdates.find((x) => x.id === id);
    return u && { kind, id, authorId: u.authorId, gone: !!u.takenDownAt, snapshot: u.body ?? '' };
  }
  if (kind === 'nomination') {
    const n = social.nominations.find((x) => x.id === id);
    return n && { kind, id, authorId: n.nominatedBy, gone: !!n.withdrawnAt, snapshot: lines(n.title, n.story, n.reason ? `“${n.reason}”` : null) };
  }
  if (kind === 'mechanic') {
    const m = social.mechanics.find((x) => x.id === id);
    return m && { kind, id, authorId: m.addedBy ?? '', gone: !!m.archivedAt, snapshot: lines(m.name, m.speciality, m.notes) };
  }
  const m = club.members.find((x) => x.id === id);
  return m && { kind, id, authorId: m.id, gone: m.approval !== 'approved', snapshot: lines(m.fullName, m.roadName, m.bio) };
}

/** Reports something; hands back the report's id. Reporting again changes the reason of an open report. */
export function reportContent(ctx: SocialCtx, kind: string, targetId: string, reason: string): { social: SocialData; id: string } {
  const target = (REPORT_KINDS as readonly string[]).includes(kind) ? findReportTarget(kind as ReportKind, targetId, ctx.social, ctx.club) : undefined;
  refuse(reportContentProblem(ctx.me, kind, target, reason));
  const me = ctx.me!;
  const at = ctx.now ?? new Date().toISOString();
  const clean = reason.trim() || null;
  const open = ctx.social.contentReports.find((r) => r.kind === kind && r.targetId === targetId && r.reporterId === me.id && !r.resolvedAt);
  if (open) {
    const changed = { ...open, reason: clean, snapshot: target!.snapshot };
    return { social: { ...ctx.social, contentReports: ctx.social.contentReports.map((r) => (r.id === open.id ? changed : r)) }, id: open.id };
  }
  const report: ContentReport = {
    id: `cr-${ctx.social.contentReports.length + 1}-${Date.now().toString(36)}`, kind: kind as ReportKind, targetId, authorId: target!.authorId, reporterId: me.id, reason: clean,
    snapshot: target!.snapshot, createdAt: at, resolvedAt: null, resolvedBy: null, outcome: null,
  };
  return { social: { ...ctx.social, contentReports: [...ctx.social.contentReports, report] }, id: report.id };
}

/** Deals with a report: takes the thing down (as the board can) or dismisses it; every open report on it closes. */
export function resolveContentReport(ctx: SocialCtx, id: string, remove: boolean): { social: SocialData; club: ClubData } {
  const r = ctx.social.contentReports.find((x) => x.id === id);
  const author = r && ctx.club.members.find((m) => m.id === r.authorId);
  refuse(resolveContentReportProblem(ctx.me, r, author, ctx.club.positions));
  const report = r!;
  const me = ctx.me!;
  const at = ctx.now ?? new Date().toISOString();
  let social = ctx.social;
  let club = ctx.club;
  if (remove) {
    const t = report.targetId;
    if (report.kind === 'listing') social = { ...social, listings: social.listings.map((l) => (l.id === t && !l.takenDownAt ? { ...l, takenDownAt: at } : l)) };
    if (report.kind === 'build_update') social = { ...social, buildUpdates: social.buildUpdates.map((u) => (u.id === t && !u.takenDownAt ? { ...u, takenDownAt: at } : u)) };
    if (report.kind === 'nomination') social = { ...social, nominations: social.nominations.map((n) => (n.id === t && !n.withdrawnAt ? { ...n, withdrawnAt: at } : n)) };
    if (report.kind === 'mechanic') social = { ...social, mechanics: social.mechanics.map((m) => (m.id === t && !m.archivedAt ? { ...m, archivedAt: at } : m)) };
    if (report.kind === 'profile') club = { ...club, members: club.members.map((m) => (m.id === t ? { ...m, bio: null } : m)) };
  }
  const outcome = remove ? 'removed' : 'dismissed';
  return {
    social: {
      ...social,
      contentReports: social.contentReports.map((x) =>
        x.kind === report.kind && x.targetId === report.targetId && !x.resolvedAt ? { ...x, resolvedAt: at, resolvedBy: me.id, outcome } : x,
      ),
    },
    club,
  };
}

/** Open content reports the member can act on, newest first. */
export function contentReportsFor(me: Member | null, social: SocialData, club: ClubData): ContentReport[] {
  return social.contentReports
    .filter((r) => !r.resolvedAt && canActOnContentReport(me, r, club.members.find((m) => m.id === r.authorId), club.positions))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The member's own open content reports, as the things they hide. */
export function myOpenContentReports(meId: string | undefined, social: SocialData): OpenReportRef[] {
  if (!meId) return [];
  return social.contentReports.filter((r) => r.reporterId === meId && !r.resolvedAt).map((r) => ({ kind: r.kind, targetId: r.targetId }));
}

/** Posts an update on my project bike's build; hands back its id. */
export function postBuildUpdate(ctx: SocialCtx, post: BuildPost): { social: SocialData; id: string } {
  refuse(buildPostProblem(ctx.me, post, ctx.club.bikes, ctx.social.buildUpdates));
  const me = ctx.me as Member;
  const clean = cleanBuildPost(post);
  const id = `build-${ctx.social.buildUpdates.length + 1}-${Date.now().toString(36)}`;
  const added: BuildUpdate = {
    id, bikeId: clean.bikeId, authorId: me.id, body: clean.body,
    photos: clean.photos.map((p) => ({ path: p.path, width: Math.round(p.width), height: Math.round(p.height) })),
    postedAt: ctx.now ?? new Date().toISOString(), takenDownAt: null,
  };
  return { social: { ...ctx.social, buildUpdates: [...ctx.social.buildUpdates, added] }, id };
}

export function takeDownBuildUpdate(ctx: SocialCtx, id: string): SocialData {
  refuse(buildTakeDownProblem(ctx.me, id, ctx.social.buildUpdates, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, buildUpdates: ctx.social.buildUpdates.map((u) => (u.id === id ? { ...u, takenDownAt: at } : u)) };
}

/** Adds (input.id null) or changes a timeline entry; hands back its id. */
export function saveHistoryEntry(ctx: SocialCtx, input: HistoryInput): { social: SocialData; id: string } {
  refuse(historyProblem(ctx.me, input, ctx.social.history, ctx.club.positions, ctx.today));
  const me = ctx.me as Member;
  const clean = cleanEntry(input);
  if (input.id === null) {
    const id = `history-${ctx.social.history.length + 1}-${Date.now().toString(36)}`;
    const added: HistoryEntry = { id, ...clean, addedBy: me.id, archivedAt: null };
    return { social: { ...ctx.social, history: [...ctx.social.history, added] }, id };
  }
  return {
    social: { ...ctx.social, history: ctx.social.history.map((e) => (e.id === input.id ? { ...e, ...clean } : e)) },
    id: input.id,
  };
}

export function archiveHistoryEntry(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveEntryProblem(ctx.me, id, ctx.social.history, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, history: ctx.social.history.map((e) => (e.id === id ? { ...e, archivedAt: at } : e)) };
}

/** Adds (input.id null) or changes an honour; hands back its id. */
export function saveHonour(ctx: SocialCtx, input: HonourInput): { social: SocialData; id: string } {
  refuse(honourProblem(ctx.me, input, ctx.social.honours, ctx.club.members, ctx.club.positions, ctx.today));
  const me = ctx.me as Member;
  const clean = cleanHonour(input);
  if (input.id === null) {
    const id = `honour-${ctx.social.honours.length + 1}-${Date.now().toString(36)}`;
    const added: Honour = { id, ...clean, addedBy: me.id, archivedAt: null };
    return { social: { ...ctx.social, honours: [...ctx.social.honours, added] }, id };
  }
  return {
    social: { ...ctx.social, honours: ctx.social.honours.map((h) => (h.id === input.id ? { ...h, ...clean } : h)) },
    id: input.id,
  };
}

export function archiveHonour(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveHonourProblem(ctx.me, id, ctx.social.honours, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, honours: ctx.social.honours.map((h) => (h.id === id ? { ...h, archivedAt: at } : h)) };
}

/** Opens an award; hands back its id. */
export function openAward(ctx: SocialCtx, input: AwardInput): { social: SocialData; id: string } {
  refuse(openAwardProblem(ctx.me, input, ctx.club.positions, ctx.today));
  const me = ctx.me as Member;
  const id = `award-${ctx.social.awards.length + 1}-${Date.now().toString(36)}`;
  const added: Award = { id, ...cleanAward(input), openedBy: me.id, archivedAt: null };
  return { social: { ...ctx.social, awards: [...ctx.social.awards, added] }, id };
}

export function archiveAward(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveAwardProblem(ctx.me, id, ctx.social.awards, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, awards: ctx.social.awards.map((a) => (a.id === id ? { ...a, archivedAt: at } : a)) };
}

/** Nominates something for an award; hands back its id. */
export function nominate(ctx: SocialCtx, input: NominationInput): { social: SocialData; id: string } {
  refuse(nominationProblem(ctx.me, input, ctx.social.awards, ctx.social.nominations, ctx.club.rides, ctx.today));
  const me = ctx.me as Member;
  const kind = (ctx.social.awards.find((a) => a.id === input.awardId) as Award).kind;
  const clean = cleanNomination(input, kind);
  const photo = clean.photo ? { path: clean.photo.path, width: Math.round(clean.photo.width), height: Math.round(clean.photo.height) } : null;
  const id = `nom-${ctx.social.nominations.length + 1}-${Date.now().toString(36)}`;
  const added: Nomination = {
    id, awardId: input.awardId, nominatedBy: me.id, ...clean, photo, nominatedAt: ctx.now ?? new Date().toISOString(), withdrawnAt: null,
  };
  return { social: { ...ctx.social, nominations: [...ctx.social.nominations, added] }, id };
}

export function withdrawNomination(ctx: SocialCtx, id: string): SocialData {
  refuse(withdrawProblem(ctx.me, id, ctx.social.nominations, ctx.social.awards, ctx.club.positions, ctx.today));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, nominations: ctx.social.nominations.map((n) => (n.id === id ? { ...n, withdrawnAt: at } : n)) };
}

/** Casts (or changes) my vote in a nomination's award. */
export function castBragVote(ctx: SocialCtx, nominationId: string): SocialData {
  refuse(voteProblem(ctx.me, nominationId, ctx.social.nominations, ctx.social.awards, ctx.today));
  const me = ctx.me as Member;
  const awardId = (ctx.social.nominations.find((n) => n.id === nominationId) as Nomination).awardId;
  const others = ctx.social.bragVotes.filter((v) => !(v.awardId === awardId && v.memberId === me.id));
  return { ...ctx.social, bragVotes: [...others, { awardId, memberId: me.id, nominationId }] };
}

/** Like brag_tallies(): counts for awards that have closed, only. */
export function bragTallies(social: SocialData, today: string): Tally[] {
  const closed = new Set(social.awards.filter((a) => !a.archivedAt && awardPhase(a, today) === 'closed').map((a) => a.id));
  return social.nominations
    .filter((n) => closed.has(n.awardId) && !n.withdrawnAt)
    .map((n) => ({ nominationId: n.id, votes: social.bragVotes.filter((v) => v.nominationId === n.id).length }));
}

// Invites to and from other clubs ------------------------------------------------------------

const stamp = (ctx: SocialCtx) => ctx.now ?? new Date().toISOString();

/** Adds (input.id null) or changes a club on the list; hands back its id. */
export function saveOtherClub(ctx: SocialCtx, input: OtherClubInput): { social: SocialData; id: string } {
  refuse(clubProblem(ctx.me, input, ctx.social.otherClubs, ctx.club));
  const clean = cleanClub(input);
  if (input.id === null) {
    const id = `club-${ctx.social.otherClubs.length + 1}-${Date.now().toString(36)}`;
    const added: OtherClub = { id, ...clean, addedBy: (ctx.me as Member).id, addedAt: stamp(ctx), archivedAt: null };
    return { social: { ...ctx.social, otherClubs: [...ctx.social.otherClubs, added] }, id };
  }
  return {
    social: { ...ctx.social, otherClubs: ctx.social.otherClubs.map((c) => (c.id === input.id ? { ...c, ...clean } : c)) },
    id: input.id,
  };
}

export function archiveOtherClub(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveClubProblem(ctx.me, id, ctx.social.otherClubs, ctx.club));
  const at = stamp(ctx);
  return { ...ctx.social, otherClubs: ctx.social.otherClubs.map((c) => (c.id === id ? { ...c, archivedAt: at } : c)) };
}

/** Passes on (input.id null) or changes an incoming invite; hands back its id. */
export function saveInviteIn(ctx: SocialCtx, input: InviteInInput): { social: SocialData; id: string } {
  refuse(inviteInProblem(ctx.me, input, ctx.social.otherClubs, ctx.social.invites, ctx.club, ctx.today));
  const clean = cleanInviteIn(input);
  if (input.id === null) {
    const id = `invite-${ctx.social.invites.length + 1}-${Date.now().toString(36)}`;
    const added: ClubInvite = {
      id, direction: 'in', ...clean, answer: 'waiting', calendarLabel: null, bikes: null, note: null,
      addedBy: (ctx.me as Member).id, addedAt: stamp(ctx), answeredBy: null, answeredAt: null, archivedAt: null,
    };
    return { social: { ...ctx.social, invites: [...ctx.social.invites, added] }, id };
  }
  return {
    social: { ...ctx.social, invites: ctx.social.invites.map((i) => (i.id === input.id ? { ...i, ...clean } : i)) },
    id: input.id,
  };
}

/** Records an invitation to one of the club's rides; hands back its id. */
export function inviteClub(ctx: SocialCtx, input: InviteOutInput): { social: SocialData; id: string } {
  refuse(inviteOutProblem(ctx.me, input, ctx.social.otherClubs, ctx.social.invites, ctx.club, ctx.today));
  const ride = ctx.club.rides.find((r) => r.id === input.rideId) as Ride;
  const chapterId = rideChapterId(ride, ctx.club.chapters);
  const id = `invite-${ctx.social.invites.length + 1}-${Date.now().toString(36)}`;
  const added: ClubInvite = {
    id, direction: 'out', clubId: input.clubId, chapterId, rideId: input.rideId, title: null, eventOn: null, place: null,
    details: null, answer: 'waiting', calendarLabel: null, bikes: null, note: input.note.trim() === '' ? null : input.note.trim(),
    addedBy: (ctx.me as Member).id, addedAt: stamp(ctx), answeredBy: null, answeredAt: null, archivedAt: null,
  };
  return { social: { ...ctx.social, invites: [...ctx.social.invites, added] }, id };
}

export function answerInvite(ctx: SocialCtx, input: AnswerInput): SocialData {
  refuse(answerProblem(ctx.me, input, ctx.social.invites, ctx.club));
  const at = stamp(ctx);
  return {
    ...ctx.social,
    invites: ctx.social.invites.map((i) => {
      if (i.id !== input.id) return i;
      const clean = cleanAnswer(i, input);
      const waiting = clean.answer === 'waiting';
      return { ...i, ...clean, answeredBy: waiting ? null : (ctx.me as Member).id, answeredAt: waiting ? null : at };
    }),
  };
}

export function archiveInvite(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveInviteProblem(ctx.me, id, ctx.social.invites, ctx.club));
  const at = stamp(ctx);
  return { ...ctx.social, invites: ctx.social.invites.map((i) => (i.id === id ? { ...i, archivedAt: at } : i)) };
}

/** A parity.json case, as the social action it names. */
export type SocialAction =
  | { action: 'socialSetBirthday'; month: number | null; day: number | null }
  // Member content rules
  | { action: 'socialReportContent'; kind: string; target: string; reason: string; repeat?: number }
  | { action: 'socialResolveReport'; report: string; remove: boolean }
  | { action: 'socialSetSkills'; skills: string[] }
  // The workshop's name is `workshop`: a case's `name` is the case's own.
  | ({ action: 'socialSaveMechanic'; mechanic: string | null; workshop: string } & Omit<MechanicInput, 'id' | 'name'>)
  | { action: 'socialArchiveMechanic'; mechanic: string }
  | { action: 'socialVouchMechanic'; mechanic: string; on: boolean }
  // Photos are file names in the signed-in member's own folder, or `other:<name>` for someone else's.
  | { action: 'socialSaveListing'; listing: string | null; kind: ListingKind; title: string; price: number | null; details: string; photos: string[] }
  | { action: 'socialMarkListingSold'; listing: string; sold: boolean }
  | { action: 'socialTakeDownListing'; listing: string }
  | { action: 'socialPostBuildUpdate'; bike: string; body: string; photos: string[] }
  | { action: 'socialTakeDownBuildUpdate'; update: string }
  | { action: 'socialSaveHistoryEntry'; entry: string | null; happenedOn: string; precision: HistoryPrecision; title: string; story: string }
  | { action: 'socialArchiveHistoryEntry'; entry: string }
  // The honour's typed name is `who`: a case's `name` is the case's own.
  | { action: 'socialSaveHonour'; honour: string | null; member: string | null; who: string; title: string; year: number | null; note: string }
  | { action: 'socialArchiveHonour'; honour: string }
  // Award dates are days from today; the award's name is `title`.
  | { action: 'socialOpenAward'; kind: BragKind; title: string; year: number | null; nominationsClose: string; votingClose: string }
  | { action: 'socialArchiveAward'; award: string }
  // A photo is a file name in the nominator's own folder, or `other:<name>`.
  | { action: 'socialNominate'; award: string; ride: string | null; title: string; photo: string | null; story: string; reason: string }
  | { action: 'socialWithdrawNomination'; nomination: string }
  | { action: 'socialCastBragVote'; nomination: string }
  // Invites to and from other clubs. A club's typed name is `club`: a case's `name` is the case's own.
  | { action: 'socialSaveOtherClub'; otherClub: string | null; club: string; town: string; contact: string; note: string }
  | { action: 'socialArchiveOtherClub'; otherClub: string }
  | {
      action: 'socialSaveInviteIn'; invite: string | null; otherClub: string; chapter: string | null; title: string;
      eventOn: string; place: string; details: string; ride: string | null;
    }
  | { action: 'socialInviteClub'; ride: string; otherClub: string; note: string }
  | { action: 'socialAnswerInvite'; invite: string; answer: string; label: string | null; bikes: number | null; note: string }
  | { action: 'socialArchiveInvite'; invite: string };

/** A parity case's photo names as the photos the action is sent. */
export function parityPhotos(me: Member | null, names: string[], otherId: string): ListingPhoto[] {
  return names.map((n) => ({
    path: n.startsWith('other:') ? `${otherId}/${n.slice(6)}` : `${me?.id ?? 'nobody'}/${n}`,
    width: 800,
    height: 600,
  }));
}

export function runSocialAction(ctx: SocialCtx, a: SocialAction): SocialData {
  switch (a.action) {
    case 'socialSetBirthday':
      return setBirthday(ctx, a.month, a.day);
    case 'socialReportContent':
      return reportContent(ctx, a.kind, a.target, a.repeat ? a.reason.repeat(a.repeat) : a.reason).social;
    case 'socialResolveReport':
      return resolveContentReport(ctx, a.report, a.remove).social;
    case 'socialSetSkills':
      return setSkills(ctx, a.skills);
    case 'socialSaveMechanic':
      return saveMechanic(ctx, {
        id: a.mechanic, name: a.workshop, suburb: a.suburb, phone: a.phone, website: a.website, speciality: a.speciality, notes: a.notes,
      }).social;
    case 'socialArchiveMechanic':
      return archiveMechanic(ctx, a.mechanic);
    case 'socialVouchMechanic':
      return vouchMechanic(ctx, a.mechanic, a.on);
    case 'socialSaveListing':
      return saveListing(ctx, {
        id: a.listing, kind: a.kind, title: a.title, priceDollars: a.price, details: a.details,
        photos: parityPhotos(ctx.me, a.photos, 'someone-else'),
      }).social;
    case 'socialMarkListingSold':
      return markListingSold(ctx, a.listing, a.sold);
    case 'socialTakeDownListing':
      return takeDownListing(ctx, a.listing);
    case 'socialPostBuildUpdate':
      return postBuildUpdate(ctx, { bikeId: a.bike, body: a.body, photos: parityPhotos(ctx.me, a.photos, 'someone-else') }).social;
    case 'socialTakeDownBuildUpdate':
      return takeDownBuildUpdate(ctx, a.update);
    case 'socialSaveHistoryEntry':
      return saveHistoryEntry(ctx, { id: a.entry, happenedOn: a.happenedOn, precision: a.precision, title: a.title, story: a.story }).social;
    case 'socialArchiveHistoryEntry':
      return archiveHistoryEntry(ctx, a.entry);
    case 'socialSaveHonour':
      return saveHonour(ctx, {
        id: a.honour, memberId: a.member, name: a.who, honour: a.title, year: a.year ?? Number.NaN, note: a.note,
      }).social;
    case 'socialArchiveHonour':
      return archiveHonour(ctx, a.honour);
    case 'socialOpenAward':
      return openAward(ctx, {
        kind: a.kind, title: a.title, year: a.year ?? Number.NaN, nominationsClose: a.nominationsClose, votingClose: a.votingClose,
      }).social;
    case 'socialArchiveAward':
      return archiveAward(ctx, a.award);
    case 'socialNominate':
      return nominate(ctx, {
        awardId: a.award, rideId: a.ride, title: a.title, story: a.story, reason: a.reason,
        photo: a.photo === null ? null : parityPhotos(ctx.me, [a.photo], 'someone-else')[0],
      }).social;
    case 'socialWithdrawNomination':
      return withdrawNomination(ctx, a.nomination);
    case 'socialCastBragVote':
      return castBragVote(ctx, a.nomination);
    case 'socialSaveOtherClub':
      return saveOtherClub(ctx, { id: a.otherClub, name: a.club, town: a.town, contact: a.contact, note: a.note }).social;
    case 'socialArchiveOtherClub':
      return archiveOtherClub(ctx, a.otherClub);
    case 'socialSaveInviteIn':
      return saveInviteIn(ctx, {
        id: a.invite, clubId: a.otherClub, chapterId: a.chapter, title: a.title, eventOn: a.eventOn, place: a.place,
        details: a.details, rideId: a.ride,
      }).social;
    case 'socialInviteClub':
      return inviteClub(ctx, { rideId: a.ride, clubId: a.otherClub, note: a.note }).social;
    case 'socialAnswerInvite':
      return answerInvite(ctx, { id: a.invite, answer: a.answer, label: a.label, bikes: a.bikes, note: a.note });
    case 'socialArchiveInvite':
      return archiveInvite(ctx, a.invite);
  }
}
