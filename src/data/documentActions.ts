// What each document library action does to the demo club, under the same rules as the database
// (src/domain/documents.ts; checked by src/data/parity.test.ts).

import {
  cleanDocumentInput, cleanVersionInput, createDocumentProblem, latestNumber, markReviewedProblem, publishVersionProblem,
  recordApprovalProblem, signDocumentProblem, type ApprovalInput, type DocumentInput, type VersionInput,
} from '../domain/documents';
import type { ClubData, ClubDocument, DocumentVersion } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

export function createDocument(ctx: DemoCtx, raw: DocumentInput): { data: ClubData; id: string } {
  refuse(createDocumentProblem(ctx.me, raw, ctx.data));
  const input = cleanDocumentInput(raw);
  const doc: ClubDocument = {
    id: newId('doc'), chapterId: input.chapterId, kind: input.kind, title: input.title, asksSignOff: input.asksSignOff,
    reviewMonths: input.reviewMonths, reviewedOn: null, createdBy: ctx.me!.id, createdAt: nowOf(ctx),
  };
  return { data: { ...ctx.data, documents: [...(ctx.data.documents ?? []), doc] }, id: doc.id };
}

/** Version 1 always asks for a fresh sign-off. */
export function publishDocumentVersion(
  ctx: DemoCtx,
  documentId: string,
  expected: number,
  raw: VersionInput,
): { data: ClubData; id: string } {
  refuse(publishVersionProblem(ctx.me, documentId, expected, raw, ctx.data, ctx.today));
  const input = cleanVersionInput(raw);
  const number = latestNumber(documentId, ctx.data) + 1;
  const version: DocumentVersion = {
    id: newId('dv'), documentId, number, label: input.label, body: input.body, whatChanged: input.whatChanged,
    freshSignOff: number === 1 || input.freshSignOff, ...input.approval, publishedBy: ctx.me!.id, publishedAt: nowOf(ctx),
  };
  return { data: { ...ctx.data, documentVersions: [...(ctx.data.documentVersions ?? []), version] }, id: version.id };
}

export function recordDocumentApproval(ctx: DemoCtx, versionId: string, approval: ApprovalInput): ClubData {
  refuse(recordApprovalProblem(ctx.me, versionId, approval, ctx.data, ctx.today));
  return {
    ...ctx.data,
    documentVersions: (ctx.data.documentVersions ?? []).map((v) => (v.id === versionId ? { ...v, ...approval } : v)),
  };
}

export function markDocumentReviewed(ctx: DemoCtx, documentId: string): ClubData {
  refuse(markReviewedProblem(ctx.me, documentId, ctx.data, ctx.today));
  return { ...ctx.data, documents: (ctx.data.documents ?? []).map((d) => (d.id === documentId ? { ...d, reviewedOn: ctx.today } : d)) };
}

/** One sign-off per member per version; signing again moves the date. */
export function signDocument(ctx: DemoCtx, versionId: string): ClubData {
  refuse(signDocumentProblem(ctx.me, versionId, ctx.data, ctx.today));
  const version = ctx.data.documentVersions!.find((v) => v.id === versionId)!;
  const others = (ctx.data.documentSignoffs ?? []).filter((s) => !(s.versionId === versionId && s.memberId === ctx.me!.id));
  return {
    ...ctx.data,
    documentSignoffs: [...others, { versionId, documentId: version.documentId, memberId: ctx.me!.id, signedAt: nowOf(ctx) }],
  };
}

/**
 * The document actions as parity.json names them. Dates come resolved from …Days fields, and
 * `…Repeat` writes that text out that many times, for the length limits.
 */
export type DocumentAction =
  | {
      action: 'createDocument'; chapter: string | null; kind: DocumentInput['kind']; title: string; titleRepeat?: number;
      asksSignOff: boolean; reviewMonths: number | null;
    }
  | {
      action: 'publishDocumentVersion'; document: string; expected: number; label: string; labelRepeat?: number; body: string;
      bodyRepeat?: number; whatChanged: string; changesRepeat?: number; fresh: boolean; approvingBody?: ApprovalInput['approvingBody'];
      approved?: string; commences?: string;
    }
  | { action: 'recordDocumentApproval'; version: string; approvingBody?: ApprovalInput['approvingBody']; approved?: string; commences?: string }
  | { action: 'markDocumentReviewed'; document: string }
  | { action: 'signDocument'; version: string };

export const DOCUMENT_ACTIONS = new Set<string>([
  'createDocument', 'publishDocumentVersion', 'recordDocumentApproval', 'markDocumentReviewed', 'signDocument',
]);

const approvalOf = (a: { approvingBody?: ApprovalInput['approvingBody']; approved?: string; commences?: string }): ApprovalInput => ({
  approvingBody: a.approvingBody ?? null, approvedOn: a.approved ?? null, commencesOn: a.commences ?? null,
});

export function runDocumentAction(ctx: DemoCtx, a: DocumentAction): ClubData {
  switch (a.action) {
    case 'createDocument':
      return createDocument(ctx, {
        chapterId: a.chapter, kind: a.kind, title: a.title.repeat(a.titleRepeat ?? 1), asksSignOff: a.asksSignOff, reviewMonths: a.reviewMonths,
      }).data;
    case 'publishDocumentVersion':
      return publishDocumentVersion(ctx, a.document, a.expected, {
        label: a.label.repeat(a.labelRepeat ?? 1), body: a.body.repeat(a.bodyRepeat ?? 1),
        whatChanged: a.whatChanged.repeat(a.changesRepeat ?? 1), freshSignOff: a.fresh, approval: approvalOf(a),
      }).data;
    case 'recordDocumentApproval':
      return recordDocumentApproval(ctx, a.version, approvalOf(a));
    case 'markDocumentReviewed':
      return markDocumentReviewed(ctx, a.document);
    case 'signDocument':
      return signDocument(ctx, a.version);
  }
}
