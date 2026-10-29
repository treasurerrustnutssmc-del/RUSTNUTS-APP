// What each National Auditor action does to the demo club, under the same rules as the database
// (src/domain/audit.ts and access.ts; checked by src/data/parity.test.ts).

import { auditorSeat, renewAuditorProblem } from '../domain/access';
import {
  answerRequestProblem, closeRequestProblem, deleteReportProblem, issueReportProblem, raiseRequestProblem, saveReportProblem,
  type ReportInput, type RequestInput,
} from '../domain/audit';
import type { AuditArea, AuditRequestKind, ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

const blank = (s: string | null) => (s && s.trim() ? s.trim() : null);

export function raiseAuditRequest(ctx: DemoCtx, input: RequestInput): { data: ClubData; id: string } {
  refuse(raiseRequestProblem(ctx.me, input, ctx.data, ctx.today));
  const id = newId('ar');
  const request = {
    id, chapterId: input.chapterId, kind: input.kind, area: input.area, title: input.title.trim(), details: input.details.trim(),
    dueOn: input.dueOn, ledgerEntryId: input.ledgerEntryId, raisedBy: ctx.me!.id, raisedAt: nowOf(ctx),
    answer: null, answeredBy: null, answeredAt: null, closedAt: null, closedBy: null, closeNote: null,
  };
  return { data: { ...ctx.data, auditRequests: [request, ...(ctx.data.auditRequests ?? [])] }, id };
}

export function answerAuditRequest(ctx: DemoCtx, id: string, answer: string): ClubData {
  refuse(answerRequestProblem(ctx.me, id, answer, ctx.data));
  return {
    ...ctx.data,
    auditRequests: (ctx.data.auditRequests ?? []).map((r) =>
      r.id === id ? { ...r, answer: answer.trim(), answeredBy: ctx.me!.id, answeredAt: nowOf(ctx) } : r),
  };
}

export function closeAuditRequest(ctx: DemoCtx, id: string, note: string): ClubData {
  refuse(closeRequestProblem(ctx.me, id, note, ctx.data));
  return {
    ...ctx.data,
    auditRequests: (ctx.data.auditRequests ?? []).map((r) =>
      r.id === id ? { ...r, closedAt: nowOf(ctx), closedBy: ctx.me!.id, closeNote: note.trim() } : r),
  };
}

export function saveAuditReport(ctx: DemoCtx, input: ReportInput): { data: ClubData; id: string } {
  refuse(saveReportProblem(ctx.me, input, ctx.data, ctx.today));
  const fields = {
    title: input.title.trim(), fromOn: input.fromOn, toOn: input.toOn, findings: input.findings.trim(),
    recommendations: blank(input.recommendations), writtenBy: ctx.me!.id, savedAt: nowOf(ctx),
  };
  const reports = ctx.data.auditReports ?? [];
  if (input.id !== null) {
    const id = input.id;
    return { data: { ...ctx.data, auditReports: reports.map((r) => (r.id === id ? { ...r, ...fields } : r)) }, id };
  }
  const id = newId('rep');
  return { data: { ...ctx.data, auditReports: [{ id, ...fields, issuedAt: null }, ...reports] }, id };
}

export function issueAuditReport(ctx: DemoCtx, id: string): ClubData {
  refuse(issueReportProblem(ctx.me, id, ctx.data));
  return { ...ctx.data, auditReports: (ctx.data.auditReports ?? []).map((r) => (r.id === id ? { ...r, issuedAt: nowOf(ctx) } : r)) };
}

export function deleteAuditReport(ctx: DemoCtx, id: string): ClubData {
  refuse(deleteReportProblem(ctx.me, id, ctx.data));
  return { ...ctx.data, auditReports: (ctx.data.auditReports ?? []).filter((r) => r.id !== id) };
}

/** Ends the sitting Auditor's term today and starts a new twelve-month one (11.8). */
export function renewAuditor(ctx: DemoCtx): ClubData {
  refuse(renewAuditorProblem(ctx.me, ctx.data, ctx.today));
  const seat = auditorSeat(ctx.data)!;
  return {
    ...ctx.data,
    positions: [
      ...ctx.data.positions.map((p) => (p.id === seat.id ? { ...p, endedOn: ctx.today < p.startedOn ? p.startedOn : ctx.today } : p)),
      { id: newId('p'), memberId: seat.memberId, chapterId: null, role: 'nec_auditor', startedOn: ctx.today, endedOn: null },
    ],
  };
}

// The shared demo/database cases (supabase/tests/parity.json) ------------------------------------

export const AUDIT_ACTIONS = new Set<string>(['raiseAuditRequest', 'saveAuditReport', 'renewAuditor']);

export type AuditAction =
  | {
      action: 'raiseAuditRequest'; chapter: string | null; kind: AuditRequestKind; area: AuditArea; title: string; details: string;
      due?: string | null;
    }
  | { action: 'saveAuditReport'; title: string; from: string; to: string; findings: string; recommendations?: string | null }
  | { action: 'renewAuditor' };

export function runAuditAction(ctx: DemoCtx, a: AuditAction): ClubData {
  switch (a.action) {
    case 'raiseAuditRequest':
      return raiseAuditRequest(ctx, {
        chapterId: a.chapter, kind: a.kind, area: a.area, title: a.title, details: a.details, dueOn: a.due ?? null, ledgerEntryId: null,
      }).data;
    case 'saveAuditReport':
      return saveAuditReport(ctx, {
        id: null, title: a.title, fromOn: a.from, toOn: a.to, findings: a.findings, recommendations: a.recommendations ?? null,
      }).data;
    case 'renewAuditor':
      return renewAuditor(ctx);
  }
}
