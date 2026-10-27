import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import * as act from './documentActions';
import type { DemoCtx } from './demoActions';
import { inForce, signStatus } from '../domain/documents';
import type { ClubData } from '../domain/types';

const blank: ClubData = { ...DEMO_DATA, documents: [], documentVersions: [], documentSignoffs: [] };
const me = (id: string) => blank.members.find((m) => m.id === id)!;
const NOW = '2026-10-27T01:00:00.000Z';
const TODAY = '2026-10-27';
const ctx = (who: string, data: ClubData = blank): DemoCtx => ({ data, me: me(who), today: TODAY, now: NOW });
const NONE = { approvingBody: null, approvedOn: null, commencesOn: null };

test('a chapter board adds a document, publishes it approved, and members sign it', () => {
  const made = act.createDocument(ctx('m-torque'), { chapterId: 'ch-west', kind: 'policy', title: ' West bylaws ', asksSignOff: true, reviewMonths: 12 });
  let data = made.data;
  const doc = data.documents!.find((d) => d.id === made.id)!;
  assert.equal(doc.title, 'West bylaws');
  assert.equal(doc.createdBy, 'm-torque');
  const v = act.publishDocumentVersion(ctx('m-torque', data), made.id, 0, {
    label: ' v1 ', body: '# Bylaws\n\nBe good. ', whatChanged: '', freshSignOff: false,
    approval: { approvingBody: 'chapter_board', approvedOn: '2026-10-20', commencesOn: '2026-10-27' },
  });
  data = v.data;
  const version = data.documentVersions!.find((x) => x.id === v.id)!;
  assert.deepEqual([version.number, version.label, version.body, version.freshSignOff, version.publishedBy], [1, 'v1', '# Bylaws\n\nBe good.', true, 'm-torque']);
  assert.equal(inForce(doc, data, TODAY)?.id, v.id);
  assert.equal(signStatus(me('m-diesel'), doc, data, TODAY), 'unsigned');
  data = act.signDocument(ctx('m-diesel', data), v.id);
  assert.equal(signStatus(me('m-diesel'), doc, data, TODAY), 'signed');
  assert.deepEqual(data.documentSignoffs, [{ versionId: v.id, documentId: made.id, memberId: 'm-diesel', signedAt: NOW }]);
  // Signing again moves the date, and keeps one row.
  data = act.signDocument({ ...ctx('m-diesel', data), now: '2026-10-28T01:00:00.000Z' }, v.id);
  assert.equal(data.documentSignoffs!.length, 1);
  assert.equal(data.documentSignoffs![0].signedAt, '2026-10-28T01:00:00.000Z');
  assert.throws(() => act.signDocument(ctx('m-smokey', data), v.id), /not asked to sign/);
});

test('a version published awaiting approval gets its approval recorded later, once', () => {
  const made = act.createDocument(ctx('m-rusty'), { chapterId: null, kind: 'constitution', title: 'Constitution', asksSignOff: false, reviewMonths: null });
  const v = act.publishDocumentVersion(ctx('m-rusty', made.data), made.id, 0, { label: 'v4', body: 'Text', whatChanged: '', freshSignOff: true, approval: NONE });
  assert.throws(() => act.publishDocumentVersion(ctx('m-rusty', v.data), made.id, 0, { label: 'v5', body: 'x', whatChanged: '', freshSignOff: true, approval: NONE }), /Someone else published/);
  assert.equal(v.data.documentVersions![0].approvedOn, null);
  const ok = { approvingBody: 'association_general_meeting' as const, approvedOn: '2026-10-26', commencesOn: '2026-11-01' };
  const data = act.recordDocumentApproval(ctx('m-rusty', v.data), v.id, ok);
  assert.deepEqual(
    [data.documentVersions![0].approvingBody, data.documentVersions![0].approvedOn, data.documentVersions![0].commencesOn],
    ['association_general_meeting', '2026-10-26', '2026-11-01'],
  );
  assert.throws(() => act.recordDocumentApproval(ctx('m-rusty', data), v.id, ok), /already recorded/);
  assert.throws(() => act.createDocument(ctx('m-rusty', data), { chapterId: null, kind: 'constitution', title: 'Again', asksSignOff: false, reviewMonths: null }), /already has that document/);
});

test('marking reviewed records today', () => {
  const made = act.createDocument(ctx('m-rusty'), { chapterId: null, kind: 'policy', title: 'Fee schedule', asksSignOff: false, reviewMonths: 12 });
  assert.throws(() => act.markDocumentReviewed(ctx('m-rusty', made.data), made.id), /nothing to review/);
  const v = act.publishDocumentVersion(ctx('m-rusty', made.data), made.id, 0, {
    label: '2026', body: 'Fees', whatChanged: '', freshSignOff: true, approval: { approvingBody: 'nec', approvedOn: '2025-06-01', commencesOn: '2025-07-01' },
  });
  const data = act.markDocumentReviewed(ctx('m-rusty', v.data), made.id);
  assert.equal(data.documents![0].reviewedOn, TODAY);
  assert.throws(() => act.markDocumentReviewed(ctx('m-torque', v.data), made.id), /Only the NEC/);
});

test('the demo library starts with v4 awaiting approval, in its full text', () => {
  const c = DEMO_DATA.documents!.find((d) => d.kind === 'constitution')!;
  const v = DEMO_DATA.documentVersions!.filter((x) => x.documentId === c.id);
  assert.equal(v.length, 1);
  assert.equal(v[0].label, 'v4');
  assert.equal(v[0].approvedOn, null);
  assert.match(v[0].body!, /15\.5\. Every controlled document must state its title, version, approving body/);
});

test('the live read maps to the app’s documents, with text to load', async () => {
  const { toDocuments } = await import('./documentsLive');
  const out = toDocuments({
    documents: [{
      id: 'd1', chapter_id: null, kind: 'constitution', title: 'Constitution', asks_sign_off: false, review_months: 12,
      reviewed_on: null, created_by: null, created_at: '2026-10-25T03:00:00+00:00',
    }],
    versions: [{
      id: 'v1', document_id: 'd1', number: 1, label: 'v4', what_changed: '', fresh_sign_off: true, approving_body: null,
      approved_on: null, commences_on: null, published_by: null, published_at: '2026-10-25T03:00:00+00:00',
    }],
    signoffs: [{ version_id: 'v1', document_id: 'd1', member_id: 'm1', signed_at: '2026-10-26T01:00:00+00:00' }],
  }, { v1: 'Text' });
  assert.deepEqual(out.documents![0], {
    id: 'd1', chapterId: null, kind: 'constitution', title: 'Constitution', asksSignOff: false, reviewMonths: 12, reviewedOn: null,
    createdBy: null, createdAt: '2026-10-25T03:00:00.000Z',
  });
  assert.equal(out.documentVersions![0].body, 'Text');
  assert.equal(out.documentVersions![0].publishedAt, '2026-10-25T03:00:00.000Z');
  assert.deepEqual(out.documentSignoffs, [{ versionId: 'v1', documentId: 'd1', memberId: 'm1', signedAt: '2026-10-26T01:00:00.000Z' }]);
  assert.deepEqual(toDocuments(null, {}), { documents: [], documentVersions: [], documentSignoffs: [] });
  assert.deepEqual(toDocuments({ documents: 'nope' } as never, {}), { documents: [], documentVersions: [], documentSignoffs: [] });
});
