import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import {
  ALREADY_IN_LIBRARY, ALREADY_RECORDED, APPROVAL_TOGETHER, approvalFieldsProblem, authorityLevel, BEFORE_APPROVED, BODY_EMPTY, BODY_TOO_LONG,
  CHANGES_TOO_LONG, CLUB_WIDE_ONLY, createDocumentProblem, documentBanner, documentContents, findInDocument, FUTURE_APPROVAL, inForce,
  LABEL_EMPTY, LABEL_TOO_LONG, libraryGroups, markReviewedProblem, NO_CYCLE, NO_DOCUMENT, NO_VERSION, NOT_ASKED, NOT_IN_FORCE, NOTHING_IN_FORCE,
  NO_SIGN_OFF, PICK_BODY, PUBLISH_CONFLICT, publishesDocument, publishVersionProblem, readsDocument, recordApprovalProblem, REVIEW_CYCLE,
  reviewDueOn, reviewState, shownVersion, signDocumentProblem, signoffBase, signStatus, askedToSignDocument, TITLE_EMPTY, TITLE_TOO_LONG,
  versionState, stateLabel, reviewLine, reviewsDue, type ApprovalInput, type DocumentInput, type VersionInput,
} from './documents';
import type { ClubData, ClubDocument, DocumentSignoff, DocumentVersion } from './types';

const TODAY = '2026-10-27';

function doc(over: Partial<ClubDocument>): ClubDocument {
  return {
    id: 'd-x', chapterId: null, kind: 'policy', title: 'Policy', asksSignOff: false, reviewMonths: null, reviewedOn: null,
    createdBy: 'm-rusty', createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}
function ver(over: Partial<DocumentVersion>): DocumentVersion {
  return {
    id: `v-${over.documentId ?? 'd-x'}-${over.number ?? 1}`, documentId: 'd-x', number: 1, label: 'v1', body: 'Text', whatChanged: '',
    freshSignOff: true, approvingBody: 'nec', approvedOn: '2026-01-10', commencesOn: '2026-02-01', publishedBy: 'm-rusty',
    publishedAt: '2026-01-05T00:00:00.000Z', ...over,
  };
}

const CONST = doc({ id: 'd-const', kind: 'constitution', title: 'Constitution', reviewMonths: 12 });
const RULES = doc({ id: 'd-rules', kind: 'registered_rules', title: 'Registered Rules' });
const FEES = doc({ id: 'd-fees', kind: 'policy', title: 'Fee schedule', reviewMonths: 12 });
const WEST = doc({ id: 'd-west', chapterId: 'ch-west', kind: 'policy', title: 'West bylaws', asksSignOff: true });
const NORTH = doc({ id: 'd-north', chapterId: 'ch-north', kind: 'policy', title: 'North bylaws' });
const FORM = doc({ id: 'd-form', kind: 'procedure', title: 'Incident form' });

const versions: DocumentVersion[] = [
  ver({ documentId: 'd-const', number: 1, label: 'v4', approvingBody: null, approvedOn: null, commencesOn: null, publishedBy: null }),
  ver({ documentId: 'd-rules', number: 1 }),
  ver({ documentId: 'd-fees', number: 1, approvedOn: '2025-06-01', commencesOn: '2025-07-01' }),
  ver({ documentId: 'd-west', number: 1, approvingBody: 'chapter_board' }),
  ver({ documentId: 'd-west', number: 2, label: 'v2', freshSignOff: false, approvingBody: 'chapter_board', approvedOn: '2026-05-01', commencesOn: '2026-06-01' }),
  ver({ documentId: 'd-north', number: 1, approvingBody: 'chapter_board' }),
  ver({ documentId: 'd-form', number: 1 }),
];

const base: ClubData = {
  ...DEMO_DATA,
  documents: [CONST, RULES, FEES, WEST, NORTH, FORM],
  documentVersions: versions,
  documentSignoffs: [],
};
const me = (id: string) => base.members.find((m) => m.id === id)!;
const with_ = (over: Partial<ClubData>): ClubData => ({ ...base, ...over });

const input = (over: Partial<DocumentInput> = {}): DocumentInput => ({
  chapterId: null, kind: 'policy', title: 'Ride policy', asksSignOff: false, reviewMonths: null, ...over,
});
const NONE: ApprovalInput = { approvingBody: null, approvedOn: null, commencesOn: null };
const vin = (over: Partial<VersionInput> = {}): VersionInput => ({
  label: 'v2', body: 'New text', whatChanged: '', freshSignOff: true, approval: NONE, ...over,
});

// ---------------------------------------------------------------------------
// Levels and reading
// ---------------------------------------------------------------------------

test('authority levels follow clause 2.2', () => {
  assert.equal(authorityLevel(RULES), 1);
  assert.equal(authorityLevel(CONST), 2);
  assert.equal(authorityLevel(FEES), 3);
  assert.equal(authorityLevel(WEST), 4);
  assert.equal(authorityLevel(FORM), 5);
  assert.equal(authorityLevel(doc({ kind: 'procedure', chapterId: 'ch-west' })), 5);
});

test('library groups come in level order, chapters by name, then titles', () => {
  const groups = libraryGroups(me('m-rusty'), base);
  assert.deepEqual(groups.map((g) => g.heading), [
    'Registered Rules', 'Constitution', 'NEC policies and schedules', 'North bylaws and policies', 'West bylaws and policies', 'Procedures and forms',
  ]);
  assert.deepEqual(groups[3].documents.map((d) => d.id), ['d-north']);
});

test('approved members read everything, applicants only the Rules and the Constitution, the public nothing', () => {
  for (const d of base.documents!) assert.equal(readsDocument(me('m-rooster'), d), true);
  assert.equal(readsDocument(me('m-dylan'), RULES), true);
  assert.equal(readsDocument(me('m-dylan'), CONST), true);
  assert.equal(readsDocument(me('m-dylan'), FEES), false);
  assert.equal(readsDocument(me('m-dylan'), FORM), false);
  assert.equal(readsDocument(null, CONST), false);
  assert.deepEqual(libraryGroups(me('m-dylan'), base).map((g) => g.heading), ['Registered Rules', 'Constitution']);
});

test('the NEC publishes club-wide documents, a chapter board its own', () => {
  assert.equal(publishesDocument(me('m-rusty'), null, base.positions), true);
  assert.equal(publishesDocument(me('m-torque'), null, base.positions), false);
  assert.equal(publishesDocument(me('m-torque'), 'ch-west', base.positions), true);
  assert.equal(publishesDocument(me('m-torque'), 'ch-north', base.positions), false);
  assert.equal(publishesDocument(me('m-smokey'), 'ch-west', base.positions), true); // a President sits on the NEC
  assert.equal(publishesDocument(me('m-patches'), 'ch-west', base.positions), false);
});

// ---------------------------------------------------------------------------
// Version states
// ---------------------------------------------------------------------------

test('version states across approval and commencement', () => {
  const v = (id: string, n: number) => versions.find((x) => x.documentId === id && x.number === n)!;
  assert.equal(versionState(v('d-const', 1), base, TODAY), 'awaiting');
  assert.equal(versionState(v('d-west', 1), base, TODAY), 'superseded');
  assert.equal(versionState(v('d-west', 2), base, TODAY), 'in_force');
  assert.equal(versionState(v('d-west', 2), base, '2026-05-31'), 'upcoming');
  assert.equal(versionState(v('d-west', 1), base, '2026-05-31'), 'in_force');
  assert.equal(versionState(v('d-west', 2), base, '2026-06-01'), 'in_force');
});

test('an older version never approved is superseded, and never the shown version', () => {
  const data = with_({
    documentVersions: [
      ver({ id: 'a1', documentId: 'd-fees', number: 1, approvingBody: null, approvedOn: null, commencesOn: null }),
      ver({ id: 'a2', documentId: 'd-fees', number: 2 }),
    ],
  });
  assert.equal(versionState(data.documentVersions![0], data, TODAY), 'superseded');
  assert.equal(shownVersion(FEES, data, TODAY)?.id, 'a2');
});

test('the shown version is the one in force, else the newest', () => {
  assert.equal(inForce(CONST, base, TODAY), undefined);
  assert.equal(shownVersion(CONST, base, TODAY)?.label, 'v4');
  assert.equal(shownVersion(WEST, base, TODAY)?.number, 2);
  assert.equal(shownVersion(doc({ id: 'nothing' }), base, TODAY), undefined);
});

test('banners: a newer pending version, or a superseded one open', () => {
  const data = with_({
    documentVersions: [...versions, ver({ id: 'w3', documentId: 'd-west', number: 3, label: 'v3', approvingBody: null, approvedOn: null, commencesOn: null })],
  });
  const w2 = data.documentVersions!.find((v) => v.documentId === 'd-west' && v.number === 2)!;
  const w1 = data.documentVersions!.find((v) => v.documentId === 'd-west' && v.number === 1)!;
  assert.deepEqual(documentBanner(w2, data, TODAY), { kind: 'newer', target: data.documentVersions!.at(-1), state: 'awaiting' });
  assert.deepEqual(documentBanner(w1, data, TODAY), { kind: 'superseded', target: w2, state: 'in_force' });
  assert.equal(documentBanner(w2, base, TODAY), null);
});

// ---------------------------------------------------------------------------
// Adding a document
// ---------------------------------------------------------------------------

test('adding a document: refusals in order', () => {
  const empty = with_({ documents: [], documentVersions: [] });
  assert.equal(createDocumentProblem(null, input(), empty), 'Sign in first.');
  assert.equal(createDocumentProblem(me('m-dylan'), input(), empty), 'Only approved members can do that.');
  assert.equal(createDocumentProblem(me('m-torque'), input(), empty), 'Only the NEC can do that.');
  assert.equal(createDocumentProblem(me('m-jet'), input({ chapterId: 'ch-west' }), empty), 'Only that chapter’s board can do that.');
  assert.equal(createDocumentProblem(me('m-rusty'), input({ chapterId: 'ch-west', kind: 'constitution' }), empty), CLUB_WIDE_ONLY);
  assert.equal(createDocumentProblem(me('m-rusty'), input({ kind: 'constitution' }), base), ALREADY_IN_LIBRARY);
  assert.equal(createDocumentProblem(me('m-rusty'), input({ kind: 'registered_rules' }), base), ALREADY_IN_LIBRARY);
  assert.equal(createDocumentProblem(me('m-rusty'), input({ title: '   ' }), empty), TITLE_EMPTY);
  assert.equal(createDocumentProblem(me('m-rusty'), input({ title: 'x'.repeat(121) }), empty), TITLE_TOO_LONG);
  assert.equal(createDocumentProblem(me('m-rusty'), input({ title: '😀'.repeat(120) }), empty), null);
  for (const bad of [0, 61, 1.5, -3]) assert.equal(createDocumentProblem(me('m-rusty'), input({ reviewMonths: bad }), empty), REVIEW_CYCLE);
  assert.equal(createDocumentProblem(me('m-rusty'), input({ reviewMonths: 60 }), empty), null);
  assert.equal(createDocumentProblem(me('m-torque'), input({ chapterId: 'ch-west', kind: 'procedure' }), base), null);
});

// ---------------------------------------------------------------------------
// Publishing and approval
// ---------------------------------------------------------------------------

test('publishing a version: refusals in order', () => {
  assert.equal(publishVersionProblem(null, 'd-west', 2, vin(), base, TODAY), 'Sign in first.');
  assert.equal(publishVersionProblem(me('m-torque'), 'nope', 2, vin(), base, TODAY), NO_DOCUMENT);
  assert.equal(publishVersionProblem(me('m-jet'), 'd-west', 2, vin(), base, TODAY), 'Only that chapter’s board can do that.');
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 1, vin(), base, TODAY), PUBLISH_CONFLICT);
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 2, vin({ label: ' ' }), base, TODAY), LABEL_EMPTY);
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 2, vin({ label: 'x'.repeat(21) }), base, TODAY), LABEL_TOO_LONG);
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 2, vin({ body: '\n ' }), base, TODAY), BODY_EMPTY);
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 2, vin({ body: 'x'.repeat(200001) }), base, TODAY), BODY_TOO_LONG);
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 2, vin({ whatChanged: 'x'.repeat(501) }), base, TODAY), CHANGES_TOO_LONG);
  assert.equal(
    publishVersionProblem(me('m-torque'), 'd-west', 2, vin({ approval: { approvingBody: 'chapter_board', approvedOn: null, commencesOn: null } }), base, TODAY),
    APPROVAL_TOGETHER,
  );
  assert.equal(publishVersionProblem(me('m-torque'), 'd-west', 2, vin(), base, TODAY), null);
  assert.equal(publishVersionProblem(me('m-rusty'), 'd-form', 0, vin(), with_({ documentVersions: [] }), TODAY), null);
});

test('approval fields go together, from the list, not in the future, commencing on or after approval', () => {
  const a = (over: Partial<ApprovalInput>): ApprovalInput => ({ approvingBody: 'nec', approvedOn: '2026-10-01', commencesOn: '2026-10-01', ...over });
  assert.equal(approvalFieldsProblem(NONE, TODAY), null);
  assert.equal(approvalFieldsProblem(a({ commencesOn: null }), TODAY), APPROVAL_TOGETHER);
  assert.equal(approvalFieldsProblem(a({ approvingBody: null }), TODAY), APPROVAL_TOGETHER);
  assert.equal(approvalFieldsProblem(a({ approvingBody: 'the pub' as never }), TODAY), PICK_BODY);
  assert.equal(approvalFieldsProblem(a({ approvedOn: '2026-10-28', commencesOn: '2026-11-01' }), TODAY), FUTURE_APPROVAL);
  assert.equal(approvalFieldsProblem(a({ commencesOn: '2026-09-30' }), TODAY), BEFORE_APPROVED);
  assert.equal(approvalFieldsProblem(a({ approvedOn: TODAY, commencesOn: '2027-01-01' }), TODAY), null);
});

test('recording approval later', () => {
  const ok: ApprovalInput = { approvingBody: 'association_general_meeting', approvedOn: '2026-10-26', commencesOn: '2026-11-01' };
  const v4 = 'v-d-const-1';
  assert.equal(recordApprovalProblem(null, v4, ok, base, TODAY), 'Sign in first.');
  assert.equal(recordApprovalProblem(me('m-rusty'), 'nope', ok, base, TODAY), NO_VERSION);
  assert.equal(recordApprovalProblem(me('m-torque'), v4, ok, base, TODAY), 'Only the NEC can do that.');
  assert.equal(recordApprovalProblem(me('m-rusty'), 'v-d-fees-1', ok, base, TODAY), ALREADY_RECORDED);
  assert.equal(recordApprovalProblem(me('m-rusty'), v4, NONE, base, TODAY), APPROVAL_TOGETHER);
  assert.equal(recordApprovalProblem(me('m-rusty'), v4, { ...ok, commencesOn: '2026-10-01' }, base, TODAY), BEFORE_APPROVED);
  assert.equal(recordApprovalProblem(me('m-rusty'), v4, ok, base, TODAY), null);
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

test('marking reviewed', () => {
  assert.equal(markReviewedProblem(null, 'd-fees', base, TODAY), 'Sign in first.');
  assert.equal(markReviewedProblem(me('m-rusty'), 'nope', base, TODAY), NO_DOCUMENT);
  assert.equal(markReviewedProblem(me('m-torque'), 'd-fees', base, TODAY), 'Only the NEC can do that.');
  assert.equal(markReviewedProblem(me('m-rusty'), 'd-form', base, TODAY), NO_CYCLE);
  assert.equal(markReviewedProblem(me('m-rusty'), 'd-const', base, TODAY), NOTHING_IN_FORCE);
  assert.equal(markReviewedProblem(me('m-rusty'), 'd-fees', base, TODAY), null);
});

test('review due: the later of commencement and last review, plus the cycle, month end rolling back', () => {
  assert.equal(reviewDueOn(FEES, base, TODAY), '2026-07-01');
  assert.equal(reviewState(FEES, base, TODAY), 'overdue');
  assert.equal(reviewDueOn(FEES, base, '2025-06-15'), null); // nothing in force yet
  assert.equal(reviewDueOn(FORM, base, TODAY), null); // no cycle
  assert.equal(reviewDueOn(CONST, base, TODAY), null); // nothing in force
  const reviewed = with_({ documents: [{ ...FEES, reviewedOn: '2026-10-20' }] });
  assert.equal(reviewDueOn(reviewed.documents![0], reviewed, TODAY), '2027-10-20');
  assert.equal(reviewState(reviewed.documents![0], reviewed, TODAY), 'ok');
  const jan31 = with_({
    documents: [{ ...FEES, reviewMonths: 1 }],
    documentVersions: [ver({ documentId: 'd-fees', approvedOn: '2026-01-01', commencesOn: '2026-01-31' })],
  });
  assert.equal(reviewDueOn(jan31.documents![0], jan31, TODAY), '2026-02-28');
  assert.equal(reviewState(FEES, base, '2026-06-01'), 'due_soon');
  assert.equal(reviewState(FEES, base, '2026-05-31'), 'ok');
  assert.equal(reviewState(FORM, base, TODAY), null);
});

// ---------------------------------------------------------------------------
// Sign-off
// ---------------------------------------------------------------------------

const sign = (memberId: string, versionId: string): DocumentSignoff => ({
  versionId, documentId: versionId.split('-').slice(1, 3).join('-'), memberId, signedAt: '2026-03-01T00:00:00.000Z',
});

test('sign-off base and status', () => {
  assert.equal(signoffBase(WEST, base, TODAY)?.number, 1); // v2 didn't ask for a fresh sign-off
  assert.equal(signStatus(me('m-torque'), WEST, base, TODAY), 'unsigned');
  const signed = with_({ documentSignoffs: [sign('m-torque', 'v-d-west-1')] });
  assert.equal(signStatus(me('m-torque'), WEST, signed, TODAY), 'signed');
  assert.equal(signStatus(me('m-smokey'), WEST, signed, TODAY), 'none'); // another chapter's member
  assert.equal(signStatus(me('m-rooster'), WEST, signed, TODAY), 'none'); // Legacy
  assert.equal(signStatus(me('m-torque'), FEES, signed, TODAY), 'none'); // doesn't ask
  const fresh = with_({
    documentSignoffs: [sign('m-torque', 'v-d-west-1')],
    documentVersions: [...versions, ver({ documentId: 'd-west', number: 3, label: 'v3', approvedOn: '2026-10-01', commencesOn: '2026-10-02' })],
  });
  assert.equal(signoffBase(WEST, fresh, TODAY)?.number, 3);
  assert.equal(signStatus(me('m-torque'), WEST, fresh, TODAY), 'unsigned');
  assert.equal(signStatus(me('m-torque'), WEST, fresh, '2026-10-01'), 'signed'); // v3 not in force yet
});

test('who is asked to sign a chapter document', () => {
  const asked = askedToSignDocument(WEST, base).map((m) => m.id);
  assert.ok(asked.includes('m-torque'));
  assert.ok(!asked.includes('m-rooster'));
  assert.ok(!asked.includes('m-smokey'));
  assert.ok(!asked.includes('m-dylan'));
  assert.deepEqual(askedToSignDocument(FEES, base), []);
});

test('signing: refusals in order', () => {
  assert.equal(signDocumentProblem(null, 'v-d-west-2', base, TODAY), 'Sign in first.');
  assert.equal(signDocumentProblem(me('m-torque'), 'nope', base, TODAY), NO_VERSION);
  assert.equal(signDocumentProblem(me('m-torque'), 'v-d-fees-1', base, TODAY), NO_SIGN_OFF);
  assert.equal(signDocumentProblem(me('m-smokey'), 'v-d-west-2', base, TODAY), NOT_ASKED);
  assert.equal(signDocumentProblem(me('m-rooster'), 'v-d-west-2', base, TODAY), NOT_ASKED);
  assert.equal(signDocumentProblem(me('m-torque'), 'v-d-west-1', base, TODAY), NOT_IN_FORCE);
  assert.equal(signDocumentProblem(me('m-torque'), 'v-d-west-2', base, TODAY), null);
});

// ---------------------------------------------------------------------------
// Reading on a phone
// ---------------------------------------------------------------------------

const TEXT = '# Part A\nIntro line\nmore intro\n\n# 1. Name\n1.1. The club is called Rustnuts.\n\n1.2. It rides.\n# 2. Authority\n- Law first';

test('contents lists the headings with their block positions', () => {
  assert.deepEqual(documentContents(TEXT), [
    { index: 0, text: 'Part A' }, { index: 2, text: '1. Name' }, { index: 5, text: '2. Authority' },
  ]);
});

test('find lists matching blocks, case-insensitive, from two characters, at most 50', () => {
  assert.deepEqual(findInDocument(TEXT, 'r'), []);
  assert.deepEqual(findInDocument(TEXT, ' RUSTNUTS '), [{ index: 3, text: '1.1. The club is called Rustnuts.' }]);
  assert.deepEqual(findInDocument(TEXT, 'rides').map((h) => h.index), [4]);
  assert.equal(findInDocument(Array.from({ length: 80 }, () => 'ride on').join('\n\n'), 'ride').length, 50);
});

test('state and review lines for the screens', () => {
  const v = versions.find((x) => x.documentId === 'd-west' && x.number === 2)!;
  assert.equal(stateLabel('awaiting', v), 'Awaiting approval');
  assert.equal(stateLabel('upcoming', v), 'Commences 01/06/2026');
  assert.equal(stateLabel('in_force', v), 'In force');
  assert.equal(stateLabel('superseded', v), 'Superseded');
  assert.equal(reviewLine(FEES, base, TODAY), 'Review overdue: it was due 01/07/2026');
  assert.equal(reviewLine(FEES, base, '2026-06-01'), 'Review due 01/07/2026');
  assert.equal(reviewLine(FEES, base, '2026-05-01'), null);
  assert.equal(reviewLine(FORM, base, TODAY), null);
  assert.equal(reviewsDue(me('m-rusty'), base, TODAY), 1);
  assert.equal(reviewsDue(me('m-torque'), base, TODAY), 0);
});
