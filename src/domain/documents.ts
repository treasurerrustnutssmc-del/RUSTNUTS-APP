// The document library (constitution v4 2.2, 15.3 to 15.7): the club's controlled documents in
// the order of authority, each version with its title, label, approving body, approval date and
// commencement date. These are the rules the database's document actions
// (supabase/migrations/20270101000300_documents.sql) apply, in the same order with the same words.

import { charCount } from './chat';
import { byName } from './crew';
import { expiryState, formatAuDate } from './dates';
import { runsScope, scopeRefusal, signedInProblem } from './meetings';
import { addMonths } from './profile';
import { rulesBlocks } from './roadRules';
import type { ApprovingBody, ClubData, ClubDocument, DocumentKind, DocumentVersion, Member, Position } from './types';

export const MAX_TITLE = 120;
export const MAX_LABEL = 20;
export const MAX_BODY = 200000;
export const MAX_CHANGES = 500;
export const MAX_REVIEW_MONTHS = 60;
/** The most matches the find box lists. */
export const MAX_FINDS = 50;

/** Refusals the screens and demo also show, in the database's words. */
export const CLUB_WIDE_ONLY = 'The Registered Rules and the Constitution are club-wide documents.';
export const ALREADY_IN_LIBRARY = 'The library already has that document. Publish a new version of it instead.';
export const TITLE_EMPTY = 'Give the document a title.';
export const TITLE_TOO_LONG = 'Keep the title to 120 characters at most.';
export const REVIEW_CYCLE = 'Pick a review cycle from 1 to 60 months, or none.';
export const NO_DOCUMENT = 'That document isn’t in the library.';
export const NO_VERSION = 'That version isn’t in the library.';
export const PUBLISH_CONFLICT =
  'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the document again.';
export const LABEL_EMPTY = 'Give the version a label, like v2.';
export const LABEL_TOO_LONG = 'Keep the label to 20 characters at most.';
export const BODY_EMPTY = 'Write the document’s text first.';
export const BODY_TOO_LONG = 'That’s too long (200000 characters at most).';
export const CHANGES_TOO_LONG = 'Keep what changed to 500 characters at most.';
export const APPROVAL_TOGETHER = 'Give the approving body, the approval date and the commencement date together.';
export const PICK_BODY = 'Pick who approved it.';
export const FUTURE_APPROVAL = 'The approval date can’t be in the future.';
export const BEFORE_APPROVED = 'It can’t commence before it was approved.';
export const ALREADY_RECORDED = 'Its approval is already recorded.';
export const NO_CYCLE = 'This document has no review cycle.';
export const NOTHING_IN_FORCE = 'Nothing is in force yet, so there’s nothing to review.';
export const NO_SIGN_OFF = 'This document doesn’t ask for sign-off.';
export const NOT_ASKED = 'You’re not asked to sign this document.';
export const NOT_IN_FORCE = 'That version isn’t the one in force. Open the document again, then sign.';

/** The approving bodies, in the order the screens offer them. */
export const APPROVING_BODIES: { value: ApprovingBody; label: string }[] = [
  { value: 'association_general_meeting', label: 'Association general meeting' },
  { value: 'association_committee', label: 'Association Committee' },
  { value: 'full_members', label: 'Full Members’ vote' },
  { value: 'nec', label: 'NEC' },
  { value: 'chapter_board', label: 'Chapter Board' },
];

export function approvingBodyLabel(body: ApprovingBody | null): string | null {
  return APPROVING_BODIES.find((b) => b.value === body)?.label ?? null;
}

export const KIND_LABELS: Record<DocumentKind, string> = {
  registered_rules: 'Registered Rules',
  constitution: 'Constitution',
  policy: 'Policy or bylaw',
  procedure: 'Procedure or form',
};

/** What a publisher types when adding a document. */
export interface DocumentInput {
  chapterId: string | null;
  kind: DocumentKind;
  title: string;
  asksSignOff: boolean;
  reviewMonths: number | null;
}

/** The three 15.5 approval facts: all set, or all null. */
export interface ApprovalInput {
  approvingBody: ApprovingBody | null;
  approvedOn: string | null;
  commencesOn: string | null;
}

/** What a publisher types when publishing a version. */
export interface VersionInput {
  label: string;
  body: string;
  whatChanged: string;
  freshSignOff: boolean;
  approval: ApprovalInput;
}

// ---------------------------------------------------------------------------
// Levels and reading
// ---------------------------------------------------------------------------

export type AuthorityLevel = 1 | 2 | 3 | 4 | 5;

/** Clause 2.2's order: Registered Rules, Constitution, NEC policy, chapter bylaw or policy, procedure. */
export function authorityLevel(doc: Pick<ClubDocument, 'kind' | 'chapterId'>): AuthorityLevel {
  switch (doc.kind) {
    case 'registered_rules':
      return 1;
    case 'constitution':
      return 2;
    case 'policy':
      return doc.chapterId === null ? 3 : 4;
    default:
      return 5;
  }
}

export const LEVEL_TITLES: Record<AuthorityLevel, string> = {
  1: 'Registered Rules',
  2: 'Constitution',
  3: 'NEC policies and schedules',
  4: 'Chapter bylaws and policies',
  5: 'Procedures and forms',
};

/** Approved members read every document; applicants only the Registered Rules and the Constitution (15.7). */
export function readsDocument(me: Member | null, doc: ClubDocument): boolean {
  if (!me) return false;
  if (me.approval === 'approved') return true;
  return me.approval === 'pending' && authorityLevel(doc) <= 2;
}

/** The NEC publishes club-wide documents; a chapter's board (or the NEC) publishes the chapter's. */
export function publishesDocument(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  return runsScope(me, chapterId, positions);
}

export interface LibraryGroup {
  level: AuthorityLevel;
  chapterId: string | null;
  heading: string;
  documents: ClubDocument[];
}

/** The documents `me` reads, grouped by level in 2.2 order, level 4 by chapter name, each by title. */
export function libraryGroups(me: Member | null, data: ClubData): LibraryGroup[] {
  const docs = (data.documents ?? []).filter((d) => readsDocument(me, d));
  const groups: LibraryGroup[] = [];
  const add = (level: AuthorityLevel, chapterId: string | null, heading: string, list: ClubDocument[]) => {
    if (list.length > 0) groups.push({ level, chapterId, heading, documents: [...list].sort((a, b) => a.title.localeCompare(b.title)) });
  };
  for (const level of [1, 2, 3] as const) add(level, null, LEVEL_TITLES[level], docs.filter((d) => authorityLevel(d) === level));
  const chapters = [...data.chapters].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of chapters) add(4, c.id, `${c.name} bylaws and policies`, docs.filter((d) => authorityLevel(d) === 4 && d.chapterId === c.id));
  add(5, null, LEVEL_TITLES[5], docs.filter((d) => authorityLevel(d) === 5));
  return groups;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export type VersionState = 'awaiting' | 'upcoming' | 'in_force' | 'superseded';

export function versionsOf(documentId: string, data: ClubData): DocumentVersion[] {
  return (data.documentVersions ?? []).filter((v) => v.documentId === documentId).sort((a, b) => a.number - b.number);
}

const commenced = (v: DocumentVersion, today: string) => v.approvedOn !== null && v.commencesOn !== null && v.commencesOn <= today;

/** The highest-numbered version that is approved and has commenced by `today`. */
export function inForce(doc: Pick<ClubDocument, 'id'>, data: ClubData, today: string): DocumentVersion | undefined {
  return versionsOf(doc.id, data).filter((v) => commenced(v, today)).at(-1);
}

export function versionState(version: DocumentVersion, data: ClubData, today: string): VersionState {
  const current = inForce({ id: version.documentId }, data, today);
  if (current && version.number < current.number) return 'superseded';
  if (current && version.number === current.number) return 'in_force';
  return version.approvedOn === null ? 'awaiting' : 'upcoming';
}

/** The version a member reads first: the one in force, or the newest when nothing is in force yet. */
export function shownVersion(doc: Pick<ClubDocument, 'id'>, data: ClubData, today: string): DocumentVersion | undefined {
  return inForce(doc, data, today) ?? versionsOf(doc.id, data).at(-1);
}

export interface DocumentBanner {
  kind: 'superseded' | 'newer';
  target: DocumentVersion;
  state: VersionState;
}

/** Points from an old version to the one in force, or from the open one to a newer one on its way. */
export function documentBanner(open: DocumentVersion, data: ClubData, today: string): DocumentBanner | null {
  const state = versionState(open, data, today);
  if (state === 'superseded') {
    const target = inForce({ id: open.documentId }, data, today)!;
    return { kind: 'superseded', target, state: 'in_force' };
  }
  const newer = versionsOf(open.documentId, data).filter((v) => v.number > open.number).at(-1);
  return newer ? { kind: 'newer', target: newer, state: versionState(newer, data, today) } : null;
}

// ---------------------------------------------------------------------------
// Actions: why the database would refuse, or null
// ---------------------------------------------------------------------------

const isWholeClub = (kind: DocumentKind) => kind === 'registered_rules' || kind === 'constitution';

export function cleanDocumentInput(input: DocumentInput): DocumentInput {
  return { ...input, title: input.title.trim() };
}

export function createDocumentProblem(me: Member | null, raw: DocumentInput, data: ClubData): string | null {
  const input = cleanDocumentInput(raw);
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!publishesDocument(me, input.chapterId, data.positions)) return scopeRefusal(input.chapterId);
  if (isWholeClub(input.kind) && input.chapterId !== null) return CLUB_WIDE_ONLY;
  if (isWholeClub(input.kind) && (data.documents ?? []).some((d) => d.kind === input.kind)) return ALREADY_IN_LIBRARY;
  if (input.title === '') return TITLE_EMPTY;
  if (charCount(input.title) > MAX_TITLE) return TITLE_TOO_LONG;
  const m = input.reviewMonths;
  if (m !== null && (!Number.isInteger(m) || m < 1 || m > MAX_REVIEW_MONTHS)) return REVIEW_CYCLE;
  return null;
}

const hasAnyApproval = (a: ApprovalInput) => a.approvingBody !== null || a.approvedOn !== null || a.commencesOn !== null;

/** The approval facts' own checks. All null passes: approval not recorded yet. */
export function approvalFieldsProblem(a: ApprovalInput, today: string): string | null {
  if (!hasAnyApproval(a)) return null;
  if (a.approvingBody === null || a.approvedOn === null || a.commencesOn === null) return APPROVAL_TOGETHER;
  if (!APPROVING_BODIES.some((b) => b.value === a.approvingBody)) return PICK_BODY;
  if (a.approvedOn > today) return FUTURE_APPROVAL;
  if (a.commencesOn < a.approvedOn) return BEFORE_APPROVED;
  return null;
}

export function cleanVersionInput(input: VersionInput): VersionInput {
  return { ...input, label: input.label.trim(), body: input.body.trim(), whatChanged: input.whatChanged.trim() };
}

/** The highest version number a document has, or 0 for none: what the editor opened on. */
export function latestNumber(documentId: string, data: ClubData): number {
  return versionsOf(documentId, data).at(-1)?.number ?? 0;
}

export function publishVersionProblem(
  me: Member | null,
  documentId: string,
  expected: number,
  raw: VersionInput,
  data: ClubData,
  today: string,
): string | null {
  const input = cleanVersionInput(raw);
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const doc = (data.documents ?? []).find((d) => d.id === documentId);
  if (!doc) return NO_DOCUMENT;
  if (!publishesDocument(me, doc.chapterId, data.positions)) return scopeRefusal(doc.chapterId);
  if (latestNumber(documentId, data) !== expected) return PUBLISH_CONFLICT;
  if (input.label === '') return LABEL_EMPTY;
  if (charCount(input.label) > MAX_LABEL) return LABEL_TOO_LONG;
  if (input.body === '') return BODY_EMPTY;
  if (charCount(input.body) > MAX_BODY) return BODY_TOO_LONG;
  if (charCount(input.whatChanged) > MAX_CHANGES) return CHANGES_TOO_LONG;
  return approvalFieldsProblem(input.approval, today);
}

export function recordApprovalProblem(
  me: Member | null,
  versionId: string,
  a: ApprovalInput,
  data: ClubData,
  today: string,
): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const version = (data.documentVersions ?? []).find((v) => v.id === versionId);
  const doc = version && (data.documents ?? []).find((d) => d.id === version.documentId);
  if (!version || !doc) return NO_VERSION;
  if (!publishesDocument(me, doc.chapterId, data.positions)) return scopeRefusal(doc.chapterId);
  if (version.approvedOn !== null) return ALREADY_RECORDED;
  if (!hasAnyApproval(a)) return APPROVAL_TOGETHER;
  return approvalFieldsProblem(a, today);
}

export function markReviewedProblem(me: Member | null, documentId: string, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const doc = (data.documents ?? []).find((d) => d.id === documentId);
  if (!doc) return NO_DOCUMENT;
  if (!publishesDocument(me, doc.chapterId, data.positions)) return scopeRefusal(doc.chapterId);
  if (doc.reviewMonths === null) return NO_CYCLE;
  if (!inForce(doc, data, today)) return NOTHING_IN_FORCE;
  return null;
}

export function signDocumentProblem(me: Member | null, versionId: string, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const version = (data.documentVersions ?? []).find((v) => v.id === versionId);
  const doc = version && (data.documents ?? []).find((d) => d.id === version.documentId);
  if (!version || !doc) return NO_VERSION;
  if (!doc.asksSignOff) return NO_SIGN_OFF;
  if (!isAsked(me!, doc)) return NOT_ASKED;
  if (inForce(doc, data, today)?.id !== version.id) return NOT_IN_FORCE;
  return null;
}

// ---------------------------------------------------------------------------
// Sign-off and review
// ---------------------------------------------------------------------------

const isAsked = (m: Member, doc: ClubDocument): boolean =>
  m.approval === 'approved' && m.status !== 'legacy' && (doc.chapterId === null || m.chapterId === doc.chapterId);

/** Who's asked to sign `doc`, in name order. Empty when it doesn't ask. */
export function askedToSignDocument(doc: ClubDocument, data: ClubData): Member[] {
  if (!doc.asksSignOff) return [];
  return data.members.filter((m) => isAsked(m, doc)).sort(byName);
}

/** The newest version at or below the one in force that asked everyone to sign again. */
export function signoffBase(doc: ClubDocument, data: ClubData, today: string): DocumentVersion | undefined {
  const current = inForce(doc, data, today);
  if (!current) return undefined;
  return versionsOf(doc.id, data).filter((v) => v.number <= current.number && (v.freshSignOff || v.number === 1)).at(-1);
}

export type SignStatus = 'none' | 'unsigned' | 'signed';

/** The member's latest sign-off on `doc` that counts (at or above the base), if any. */
export function countingSignoff(member: Member, doc: ClubDocument, data: ClubData, today: string) {
  const base = signoffBase(doc, data, today);
  if (!base) return undefined;
  const numbers = new Map(versionsOf(doc.id, data).map((v) => [v.id, v.number]));
  return (data.documentSignoffs ?? [])
    .filter((s) => s.documentId === doc.id && s.memberId === member.id && (numbers.get(s.versionId) ?? 0) >= base.number)
    .sort((a, b) => a.signedAt.localeCompare(b.signedAt))
    .at(-1);
}

/** 'none' when the document doesn't ask, the member isn't asked, or nothing is in force. */
export function signStatus(member: Member, doc: ClubDocument, data: ClubData, today: string): SignStatus {
  if (!doc.asksSignOff || !isAsked(member, doc) || !signoffBase(doc, data, today)) return 'none';
  return countingSignoff(member, doc, data, today) ? 'signed' : 'unsigned';
}

/** When the next review falls due, as an ISO date. Null with no cycle or nothing in force. */
export function reviewDueOn(doc: ClubDocument, data: ClubData, today: string): string | null {
  const current = inForce(doc, data, today);
  if (doc.reviewMonths === null || !current) return null;
  const from = doc.reviewedOn !== null && doc.reviewedOn > current.commencesOn! ? doc.reviewedOn : current.commencesOn!;
  return addMonths(from, doc.reviewMonths);
}

export type ReviewState = 'ok' | 'due_soon' | 'overdue';

export function reviewState(doc: ClubDocument, data: ClubData, today: string): ReviewState | null {
  const due = reviewDueOn(doc, data, today);
  if (!due) return null;
  const s = expiryState(due, today);
  return s === 'expired' ? 'overdue' : s === 'soon' ? 'due_soon' : 'ok';
}

// ---------------------------------------------------------------------------
// Reading on a phone
// ---------------------------------------------------------------------------

/** The text as blocks for the screen, in the Road Rules format. */
export const documentBlocks = rulesBlocks;

export interface BlockRef {
  index: number;
  text: string;
}

/** The headings, with their block positions, for the Contents list. */
export function documentContents(body: string): BlockRef[] {
  return documentBlocks(body)
    .map((b, index) => ({ index, b }))
    .filter(({ b }) => b.kind === 'heading')
    .map(({ index, b }) => ({ index, text: b.text }));
}

/** Blocks containing `query` (trimmed, case-insensitive), from two characters, at most 50. */
export function findInDocument(body: string, query: string): BlockRef[] {
  const q = query.trim().toLowerCase();
  if (charCount(q) < 2) return [];
  const hits: BlockRef[] = [];
  for (const [index, b] of documentBlocks(body).entries()) {
    if (b.text.toLowerCase().includes(q)) hits.push({ index, text: b.text });
    if (hits.length === MAX_FINDS) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

export function stateLabel(state: VersionState, version: DocumentVersion): string {
  switch (state) {
    case 'awaiting':
      return 'Awaiting approval';
    case 'upcoming':
      return `Commences ${formatAuDate(version.commencesOn)}`;
    case 'in_force':
      return 'In force';
    default:
      return 'Superseded';
  }
}

/** For publishers: "Review due 01/07/2026" in its last 30 days, or overdue. Null otherwise. */
export function reviewLine(doc: ClubDocument, data: ClubData, today: string): string | null {
  const state = reviewState(doc, data, today);
  const due = formatAuDate(reviewDueOn(doc, data, today));
  if (state === 'overdue') return `Review overdue: it was due ${due}`;
  if (state === 'due_soon') return `Review due ${due}`;
  return null;
}

/** How many documents `me` publishes that are due or overdue for review, for the Board row. */
export function reviewsDue(me: Member | null, data: ClubData, today: string): number {
  return (data.documents ?? []).filter((d) => publishesDocument(me, d.chapterId, data.positions) && reviewLine(d, data, today) !== null).length;
}
