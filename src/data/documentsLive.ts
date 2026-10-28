// The live database's club_documents() read (snake_case JSON) as the app's document library.
// Versions come without their text; the bodies loaded so far (by version id) are put back in.

import type { ApprovingBody, ClubData, DocumentKind } from '../domain/types';

export interface DocumentsJson {
  documents: {
    id: string; chapter_id: string | null; kind: DocumentKind; title: string; asks_sign_off: boolean; review_months: number | null;
    reviewed_on: string | null; created_by: string | null; created_at: string;
  }[];
  versions: {
    id: string; document_id: string; number: number; label: string; what_changed: string; fresh_sign_off: boolean;
    approving_body: ApprovingBody | null; approved_on: string | null; commences_on: string | null; published_by: string | null;
    published_at: string;
  }[];
  signoffs: { version_id: string; document_id: string; member_id: string; signed_at: string }[];
}

type DocumentData = Pick<ClubData, 'documents' | 'documentVersions' | 'documentSignoffs'>;

const instant = (ts: string) => new Date(ts).toISOString();
const list = <T>(v: T[] | unknown): T[] => (Array.isArray(v) ? v : []);

/** Null (not loaded, or the database doesn't have the library yet) maps to an empty library. */
export function toDocuments(json: DocumentsJson | null, bodies: Record<string, string>): DocumentData {
  return {
    documents: list<DocumentsJson['documents'][number]>(json?.documents).map((d) => ({
      id: d.id, chapterId: d.chapter_id, kind: d.kind, title: d.title, asksSignOff: d.asks_sign_off, reviewMonths: d.review_months,
      reviewedOn: d.reviewed_on, createdBy: d.created_by, createdAt: instant(d.created_at),
    })),
    documentVersions: list<DocumentsJson['versions'][number]>(json?.versions).map((v) => ({
      id: v.id, documentId: v.document_id, number: v.number, label: v.label, body: bodies[v.id] ?? null, whatChanged: v.what_changed,
      freshSignOff: v.fresh_sign_off, approvingBody: v.approving_body, approvedOn: v.approved_on, commencesOn: v.commences_on,
      publishedBy: v.published_by, publishedAt: instant(v.published_at),
    })),
    documentSignoffs: list<DocumentsJson['signoffs'][number]>(json?.signoffs).map((s) => ({
      versionId: s.version_id, documentId: s.document_id, memberId: s.member_id, signedAt: instant(s.signed_at),
    })),
  };
}

/** Texts loaded this session, by version id. A version never changes, so they stay good. */
export const loadedBodies: Record<string, string> = {};
