// The live database's club_admin() read (snake_case JSON) as the app's Stage 5D data.

import type {
  AdminData, AppealOutcome, ChapterPart, ConductKind, ContributionStatus, MerchStatus, OrderStatus, ProposalStatus,
} from '../domain/types';

type Ts = string;
type Day = string;
type Id = string;

export interface AdminJson {
  conduct: {
    id: Id; member_id: Id; chapter_id: Id; kind: ConductKind; summary: string; rule: string | null; decided_on: Day;
    notice_on: Day; suspended_until: Day | null; recorded_by: Id | null; recorded_at: Ts; hold_until: Day | null;
    hold_reason: string | null;
    appeal: {
      lodged_on: Day; lodged_by: Id | null; grounds: string; panel: Id[] | null; hearing_on: Day | null;
      outcome: AppealOutcome | null; outcome_note: string | null; decided_on: Day | null; decided_by: Id | null;
      withdrawn_on: Day | null;
    } | null;
  }[];
  merch_items: {
    id: Id; chapter_id: Id | null; name: string; details: string | null; sizes: string[] | null; price_cents: number;
    patched_only: boolean; status: MerchStatus; proposed_by: Id | null; proposed_at: Ts; decided_by: Id | null;
    decided_at: Ts | null; decline_reason: string | null;
  }[];
  merch_orders: {
    id: Id; item_id: Id; member_id: Id; size: string | null; qty: number; unit_cents: number; note: string | null;
    status: OrderStatus; ordered_at: Ts; decided_by: Id | null; decided_at: Ts | null; decline_reason: string | null;
    paid_on: Day | null; ledger_entry_id: Id | null; handed_over_on: Day | null;
  }[];
  contributions: {
    id: Id; title: string; purpose: string; total_cents: number; status: ContributionStatus; proposed_by: Id | null;
    proposed_at: Ts; settled_at: Ts | null; shares: { chapter_id: Id; voting_members: number; cents: number }[] | null;
    decisions: { chapter_id: Id; yes: boolean; vote_id: Id; recorded_by: Id | null; recorded_at: Ts }[] | null;
  }[];
  chapter_proposals: {
    id: Id; name: string; area: string; state: string; plan: Record<ChapterPart, string>; founder_ids: Id[] | null;
    president_id: Id; saa_id: Id; status: ProposalStatus; proposed_by: Id | null; proposed_at: Ts; vote_id: Id | null;
    decided_by: Id | null; decided_at: Ts | null; chapter_id: Id | null;
  }[];
}

const instant = (ts: Ts) => new Date(ts).toISOString();
const maybeInstant = (ts: Ts | null) => (ts ? instant(ts) : null);
const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const text = (s: string | null | undefined) => s ?? '';
const num = (n: number | string) => Number(n);

export function toAdmin(raw: AdminJson | null | undefined): Required<AdminData> {
  // Anything but a plain object (an old database without club_admin, a stub) reads as nothing.
  const json = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  return {
    conduct: list(json?.conduct).map((r) => ({
      id: r.id,
      memberId: r.member_id,
      chapterId: r.chapter_id,
      kind: r.kind,
      summary: r.summary,
      rule: text(r.rule),
      decidedOn: r.decided_on,
      noticeOn: r.notice_on,
      suspendedUntil: r.suspended_until,
      recordedBy: r.recorded_by,
      recordedAt: instant(r.recorded_at),
      holdUntil: r.hold_until,
      holdReason: text(r.hold_reason),
      appeal: r.appeal
        ? {
            lodgedOn: r.appeal.lodged_on,
            lodgedBy: r.appeal.lodged_by,
            grounds: r.appeal.grounds,
            panelIds: list(r.appeal.panel),
            hearingOn: r.appeal.hearing_on,
            outcome: r.appeal.outcome,
            outcomeNote: text(r.appeal.outcome_note),
            decidedOn: r.appeal.decided_on,
            decidedBy: r.appeal.decided_by,
            withdrawnOn: r.appeal.withdrawn_on,
          }
        : null,
    })),
    merchItems: list(json?.merch_items).map((i) => ({
      id: i.id,
      chapterId: i.chapter_id,
      name: i.name,
      details: text(i.details),
      sizes: list(i.sizes),
      priceCents: num(i.price_cents),
      patchedOnly: i.patched_only,
      status: i.status,
      proposedBy: i.proposed_by,
      proposedAt: instant(i.proposed_at),
      decidedBy: i.decided_by,
      decidedAt: maybeInstant(i.decided_at),
      declineReason: text(i.decline_reason),
    })),
    merchOrders: list(json?.merch_orders).map((o) => ({
      id: o.id,
      itemId: o.item_id,
      memberId: o.member_id,
      size: o.size,
      qty: num(o.qty),
      unitCents: num(o.unit_cents),
      note: text(o.note),
      status: o.status,
      orderedAt: instant(o.ordered_at),
      decidedBy: o.decided_by,
      decidedAt: maybeInstant(o.decided_at),
      declineReason: text(o.decline_reason),
      paidOn: o.paid_on,
      ledgerEntryId: o.ledger_entry_id,
      handedOverOn: o.handed_over_on,
    })),
    contributions: list(json?.contributions).map((k) => ({
      id: k.id,
      title: k.title,
      purpose: k.purpose,
      totalCents: num(k.total_cents),
      status: k.status,
      proposedBy: k.proposed_by,
      proposedAt: instant(k.proposed_at),
      settledAt: maybeInstant(k.settled_at),
      shares: list(k.shares).map((s) => ({ chapterId: s.chapter_id, votingMembers: num(s.voting_members), cents: num(s.cents) })),
      decisions: list(k.decisions).map((d) => ({
        chapterId: d.chapter_id, yes: d.yes, voteId: d.vote_id, recordedBy: d.recorded_by, recordedAt: instant(d.recorded_at),
      })),
    })),
    chapterProposals: list(json?.chapter_proposals).map((p) => ({
      id: p.id,
      name: p.name,
      area: p.area,
      state: p.state,
      plan: p.plan,
      founderIds: list(p.founder_ids),
      presidentId: p.president_id,
      saaId: p.saa_id,
      status: p.status,
      proposedBy: p.proposed_by,
      proposedAt: instant(p.proposed_at),
      voteId: p.vote_id,
      decidedBy: p.decided_by,
      decidedAt: maybeInstant(p.decided_at),
      chapterId: p.chapter_id,
    })),
  };
}
