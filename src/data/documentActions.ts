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
