// The live database's club_audit() read (snake_case JSON) as the app's National Auditor data.

import type { AuditArea, AuditData, AuditRequestKind } from '../domain/types';

type Ts = string;
type Day = string;
type Id = string;

export interface AuditJson {
  requests: {
    id: Id; chapter_id: Id | null; kind: AuditRequestKind; area: AuditArea; title: string; details: string; due_on: Day | null;
    ledger_entry_id: Id | null; raised_by: Id | null; raised_at: Ts; answer: string | null; answered_by: Id | null;
    answered_at: Ts | null; closed_at: Ts | null; closed_by: Id | null; close_note: string | null;
  }[];
  reports: {
    id: Id; title: string; from_on: Day; to_on: Day; findings: string; recommendations: string | null; written_by: Id | null;
    saved_at: Ts; issued_at: Ts | null;
  }[];
}

const instant = (ts: Ts) => new Date(ts).toISOString();
const maybeInstant = (ts: Ts | null) => (ts ? instant(ts) : null);
const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

export function toAudit(raw: AuditJson | null | undefined): Required<AuditData> {
  // Anything but a plain object (an old database without club_audit, a stub) reads as nothing.
  const json = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  return {
    auditRequests: list(json?.requests).map((r) => ({
      id: r.id,
      chapterId: r.chapter_id,
      kind: r.kind,
      area: r.area,
      title: r.title,
      details: r.details,
      dueOn: r.due_on,
      ledgerEntryId: r.ledger_entry_id,
      raisedBy: r.raised_by,
      raisedAt: instant(r.raised_at),
      answer: r.answer,
      answeredBy: r.answered_by,
      answeredAt: maybeInstant(r.answered_at),
      closedAt: maybeInstant(r.closed_at),
      closedBy: r.closed_by,
      closeNote: r.close_note,
    })),
    auditReports: list(json?.reports).map((r) => ({
      id: r.id,
      title: r.title,
      fromOn: r.from_on,
      toOn: r.to_on,
      findings: r.findings,
      recommendations: r.recommendations,
      writtenBy: r.written_by,
      savedAt: instant(r.saved_at),
      issuedAt: maybeInstant(r.issued_at),
    })),
  };
}
