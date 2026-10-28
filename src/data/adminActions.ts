// What each Stage 5D action does to the demo club, under the same rules as the database
// (src/domain/conduct.ts, merch.ts and national.ts; checked by src/data/parity.test.ts).

import {
  hearingProblem, holdProblem, isFormal, isKept, lodgeProblem, outcomeProblem, recordConductProblem, removeConductProblem,
  withdrawProblem, type ConductInput,
} from '../domain/conduct';
import {
  cancelOrderProblem, cleanSizes, closeMerchProblem, decideMerchProblem, decideOrderProblem, handOverProblem, MERCH_CODE,
  merchLedgerDescription, orderProblem, payOrderProblem, proposeMerchProblem, type MerchInput, type OrderInput,
} from '../domain/merch';
import {
  CHAPTER_PARTS, decideContributionProblem, proposeChapterProblem, proposeContributionProblem, settleChapterProblem,
  settledStatus, sharesFor, slugOf, withdrawChapterProblem, withdrawContributionProblem, type ChapterInput, type ContributionInput,
} from '../domain/national';
import type {
  AppealOutcome, ChapterProposal, ClubData, ConductRecord, Contribution, LedgerEntry, MerchItem, MerchOrder,
} from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

// The purge: whatever is past its day is gone before anything else happens (6.9).
const purged = (ctx: DemoCtx): DemoCtx => ({
  ...ctx,
  data: { ...ctx.data, conduct: (ctx.data.conduct ?? []).filter((r) => isKept(r, ctx.today)) },
});

const withRecord = (data: ClubData, id: string, change: (r: ConductRecord) => ConductRecord | null): ClubData => ({
  ...data,
  conduct: (data.conduct ?? []).flatMap((r) => {
    if (r.id !== id) return [r];
    const next = change(r);
    return next ? [next] : [];
  }),
});

// Conduct records ------------------------------------------------------------------------------

export function recordConduct(ctx0: DemoCtx, input: ConductInput): { data: ClubData; id: string } {
  const ctx = purged(ctx0);
  refuse(recordConductProblem(ctx.me, input, ctx.data, ctx.today));
  const member = ctx.data.members.find((m) => m.id === input.memberId)!;
  const kind = input.kind!;
  const record: ConductRecord = {
    id: newId('cr'), memberId: member.id, chapterId: member.chapterId, kind, summary: input.summary.trim(), rule: input.rule.trim(),
    decidedOn: input.decidedOn, noticeOn: isFormal(kind) ? input.decidedOn : input.noticeOn,
    suspendedUntil: kind === 'suspension' ? input.suspendedUntil : null, recordedBy: ctx.me!.id, recordedAt: nowOf(ctx),
    holdUntil: null, holdReason: '', appeal: null,
  };
  return { data: { ...ctx.data, conduct: [...(ctx.data.conduct ?? []), record] }, id: record.id };
}

export function holdConduct(ctx0: DemoCtx, id: string, until: string | null, reason: string): ClubData {
  const ctx = purged(ctx0);
  refuse(holdProblem(ctx.me, id, until, reason, ctx.data, ctx.today));
  return withRecord(ctx.data, id, (r) => ({ ...r, holdUntil: until, holdReason: until === null ? '' : reason.trim() }));
}

export function removeConduct(ctx0: DemoCtx, id: string): ClubData {
  const ctx = purged(ctx0);
  refuse(removeConductProblem(ctx.me, id, ctx.data, ctx.today));
  return withRecord(ctx.data, id, () => null);
}

export function lodgeAppeal(ctx0: DemoCtx, id: string, grounds: string): ClubData {
  const ctx = purged(ctx0);
  refuse(lodgeProblem(ctx.me, id, grounds, ctx.data, ctx.today));
  return withRecord(ctx.data, id, (r) => ({
    ...r,
    appeal: {
      lodgedOn: ctx.today, lodgedBy: ctx.me!.id, grounds: grounds.trim(), panelIds: [], hearingOn: null, outcome: null,
      outcomeNote: '', decidedOn: null, decidedBy: null, withdrawnOn: null,
    },
  }));
}

export function setHearing(ctx0: DemoCtx, id: string, panelIds: string[], hearingOn: string): ClubData {
  const ctx = purged(ctx0);
  refuse(hearingProblem(ctx.me, id, panelIds, hearingOn, ctx.data, ctx.today));
  return withRecord(ctx.data, id, (r) => ({ ...r, appeal: { ...r.appeal!, panelIds: [...panelIds], hearingOn } }));
}

/** Set aside (or revoked) deletes the record straight away (6.9). */
export function decideAppeal(ctx0: DemoCtx, id: string, outcome: AppealOutcome, note: string): ClubData {
  const ctx = purged(ctx0);
  refuse(outcomeProblem(ctx.me, id, outcome, note, ctx.data, ctx.today));
  if (outcome === 'set_aside') return withRecord(ctx.data, id, () => null);
  return withRecord(ctx.data, id, (r) => ({
    ...r, appeal: { ...r.appeal!, outcome, outcomeNote: note.trim(), decidedOn: ctx.today, decidedBy: ctx.me!.id },
  }));
}

export function withdrawAppeal(ctx0: DemoCtx, id: string): ClubData {
  const ctx = purged(ctx0);
  refuse(withdrawProblem(ctx.me, id, ctx.data, ctx.today));
  return withRecord(ctx.data, id, (r) => ({ ...r, appeal: { ...r.appeal!, withdrawnOn: ctx.today } }));
}

// Merch ----------------------------------------------------------------------------------------

const withItem = (data: ClubData, id: string, change: (i: MerchItem) => MerchItem): ClubData => ({
  ...data, merchItems: (data.merchItems ?? []).map((i) => (i.id === id ? change(i) : i)),
});
const withOrder = (data: ClubData, id: string, change: (o: MerchOrder) => MerchOrder): ClubData => ({
  ...data, merchOrders: (data.merchOrders ?? []).map((o) => (o.id === id ? change(o) : o)),
});

export function proposeMerch(ctx: DemoCtx, input: MerchInput): { data: ClubData; id: string } {
  refuse(proposeMerchProblem(ctx.me, input, ctx.data));
  const item: MerchItem = {
    id: newId('mi'), chapterId: input.chapterId, name: input.name.trim(), details: input.details.trim(), sizes: cleanSizes(input.sizes),
    priceCents: input.priceCents, patchedOnly: input.patchedOnly, status: 'proposed', proposedBy: ctx.me!.id, proposedAt: nowOf(ctx),
    decidedBy: null, decidedAt: null, declineReason: '',
  };
  return { data: { ...ctx.data, merchItems: [...(ctx.data.merchItems ?? []), item] }, id: item.id };
}

export function decideMerch(ctx: DemoCtx, id: string, yes: boolean, reason: string): ClubData {
  refuse(decideMerchProblem(ctx.me, id, yes, reason, ctx.data));
  return withItem(ctx.data, id, (i) => ({
    ...i, status: yes ? 'on_sale' : 'declined', decidedBy: ctx.me!.id, decidedAt: nowOf(ctx), declineReason: yes ? '' : reason.trim(),
  }));
}

export function closeMerch(ctx: DemoCtx, id: string): ClubData {
  refuse(closeMerchProblem(ctx.me, id, ctx.data));
  return withItem(ctx.data, id, (i) => ({ ...i, status: 'closed' }));
}

export function orderMerch(ctx: DemoCtx, input: OrderInput): { data: ClubData; id: string } {
  refuse(orderProblem(ctx.me, input, ctx.data));
  const item = (ctx.data.merchItems ?? []).find((i) => i.id === input.itemId)!;
  const order: MerchOrder = {
    id: newId('mo'), itemId: item.id, memberId: ctx.me!.id, size: item.sizes.length > 0 ? input.size : null, qty: input.qty,
    unitCents: item.priceCents, note: input.note.trim(), status: 'waiting', orderedAt: nowOf(ctx), decidedBy: null, decidedAt: null,
    declineReason: '', paidOn: null, ledgerEntryId: null, handedOverOn: null,
  };
  return { data: { ...ctx.data, merchOrders: [...(ctx.data.merchOrders ?? []), order] }, id: order.id };
}

export function decideOrder(ctx: DemoCtx, id: string, yes: boolean, reason: string): ClubData {
  refuse(decideOrderProblem(ctx.me, id, yes, reason, ctx.data));
  return withOrder(ctx.data, id, (o) => ({
    ...o, status: yes ? 'approved' : 'declined', decidedBy: ctx.me!.id, decidedAt: nowOf(ctx), declineReason: yes ? '' : reason.trim(),
  }));
}

/** The money in: a CR-005 line in the item's fund, banked that day (13.1). */
export function payOrder(ctx: DemoCtx, id: string, paidOn: string): { data: ClubData; id: string } {
  refuse(payOrderProblem(ctx.me, id, paidOn, ctx.data, ctx.today));
  const order = (ctx.data.merchOrders ?? []).find((o) => o.id === id)!;
  const item = (ctx.data.merchItems ?? []).find((i) => i.id === order.itemId)!;
  const buyer = ctx.data.members.find((m) => m.id === order.memberId);
  const now = nowOf(ctx);
  const entry: LedgerEntry = {
    id: newId('le'), chapterId: item.chapterId, code: MERCH_CODE, description: merchLedgerDescription(order, item, buyer?.roadName ?? buyer?.fullName ?? 'Member'),
    amountCents: order.unitCents * order.qty, receivedOn: paidOn, entryOn: paidOn, payeeMemberId: null, payeeName: null, paymentId: null,
    state: 'paid', recordedBy: ctx.me!.id, recordedAt: now, updatedAt: now, voidReason: null, voidedBy: null, approvals: [],
  };
  const data = withOrder({ ...ctx.data, ledger: [...(ctx.data.ledger ?? []), entry] }, id, (o) => ({
    ...o, status: 'paid', paidOn, ledgerEntryId: entry.id,
  }));
  return { data, id: entry.id };
}

export function handOver(ctx: DemoCtx, id: string): ClubData {
  refuse(handOverProblem(ctx.me, id, ctx.data));
  return withOrder(ctx.data, id, (o) => ({ ...o, status: 'handed_over', handedOverOn: ctx.today }));
}

export function cancelOrder(ctx: DemoCtx, id: string): ClubData {
  refuse(cancelOrderProblem(ctx.me, id, ctx.data));
  return withOrder(ctx.data, id, (o) => ({
    ...o, status: 'cancelled', decidedBy: o.decidedBy ?? ctx.me!.id, decidedAt: o.decidedAt ?? nowOf(ctx),
  }));
}

// National contributions and new chapters --------------------------------------------------------

const withContribution = (data: ClubData, id: string, change: (k: Contribution) => Contribution): ClubData => ({
  ...data, contributions: (data.contributions ?? []).map((k) => (k.id === id ? change(k) : k)),
});
const withProposal = (data: ClubData, id: string, change: (p: ChapterProposal) => ChapterProposal): ClubData => ({
  ...data, chapterProposals: (data.chapterProposals ?? []).map((p) => (p.id === id ? change(p) : p)),
});

export function proposeContribution(ctx: DemoCtx, input: ContributionInput): { data: ClubData; id: string } {
  refuse(proposeContributionProblem(ctx.me, input, ctx.data));
  const k: Contribution = {
    id: newId('nc'), title: input.title.trim(), purpose: input.purpose.trim(), totalCents: input.totalCents, status: 'proposed',
    proposedBy: ctx.me!.id, proposedAt: nowOf(ctx), settledAt: null, shares: sharesFor(input.totalCents, ctx.data), decisions: [],
  };
  return { data: { ...ctx.data, contributions: [...(ctx.data.contributions ?? []), k] }, id: k.id };
}

export function decideContribution(ctx: DemoCtx, id: string, chapterId: string, voteId: string): ClubData {
  refuse(decideContributionProblem(ctx.me, id, chapterId, voteId, ctx.data));
  const vote = (ctx.data.votes ?? []).find((v) => v.id === voteId)!;
  const now = nowOf(ctx);
  return withContribution(ctx.data, id, (k) => {
    const decisions = [...k.decisions, { chapterId, yes: vote.result === 'carried', voteId, recordedBy: ctx.me!.id, recordedAt: now }];
    const status = settledStatus({ shares: k.shares, decisions });
    return { ...k, decisions, status: status ?? 'proposed', settledAt: status ? now : null };
  });
}

export function withdrawContribution(ctx: DemoCtx, id: string): ClubData {
  refuse(withdrawContributionProblem(ctx.me, id, ctx.data));
  return withContribution(ctx.data, id, (k) => ({ ...k, status: 'withdrawn', settledAt: nowOf(ctx) }));
}

export function proposeChapter(ctx: DemoCtx, input: ChapterInput): { data: ClubData; id: string } {
  refuse(proposeChapterProblem(ctx.me, input, ctx.data));
  const plan = Object.fromEntries(CHAPTER_PARTS.map((part) => [part, input.plan[part].trim()])) as ChapterProposal['plan'];
  const p: ChapterProposal = {
    id: newId('cp'), name: input.name.trim(), area: input.area.trim(), state: input.state, plan, founderIds: [...input.founderIds],
    presidentId: input.presidentId, saaId: input.saaId, status: 'proposed', proposedBy: ctx.me!.id, proposedAt: nowOf(ctx),
    voteId: null, decidedBy: null, decidedAt: null, chapterId: null,
  };
  return { data: { ...ctx.data, chapterProposals: [...(ctx.data.chapterProposals ?? []), p] }, id: p.id };
}

/**
 * Settles a proposal by the NEC's closed vote. Carried: the chapter is made, the founders move to
 * it (12.4) and the President and SAA take their seats today. Resolves to the new chapter's id.
 */
export function settleChapter(ctx: DemoCtx, id: string, voteId: string): { data: ClubData; chapterId: string | null } {
  refuse(settleChapterProblem(ctx.me, id, voteId, ctx.data));
  const vote = (ctx.data.votes ?? []).find((v) => v.id === voteId)!;
  const now = nowOf(ctx);
  const p = (ctx.data.chapterProposals ?? []).find((x) => x.id === id)!;
  if (vote.result !== 'carried') {
    return { data: withProposal(ctx.data, id, (x) => ({ ...x, status: 'not_approved', voteId, decidedBy: ctx.me!.id, decidedAt: now })), chapterId: null };
  }
  const chapterId = newId('ch');
  const seat = (memberId: string, role: 'president' | 'sergeant_at_arms') => ({
    id: newId('p'), memberId, chapterId, role, startedOn: ctx.today, endedOn: null,
  });
  const data: ClubData = {
    ...ctx.data,
    chapters: [...ctx.data.chapters, { id: chapterId, slug: slugOf(p.name), name: p.name, area: p.area, state: p.state }],
    members: ctx.data.members.map((m) => (p.founderIds.includes(m.id) ? { ...m, chapterId } : m)),
    positions: [...ctx.data.positions, seat(p.presidentId, 'president'), seat(p.saaId, 'sergeant_at_arms')],
  };
  return {
    data: withProposal(data, id, (x) => ({ ...x, status: 'approved', voteId, decidedBy: ctx.me!.id, decidedAt: now, chapterId })),
    chapterId,
  };
}

export function withdrawChapter(ctx: DemoCtx, id: string): ClubData {
  refuse(withdrawChapterProblem(ctx.me, id, ctx.data));
  return withProposal(ctx.data, id, (p) => ({ ...p, status: 'withdrawn', decidedBy: ctx.me!.id, decidedAt: nowOf(ctx) }));
}

// The shared parity cases ------------------------------------------------------------------------

/** The Stage 5D actions the shared parity cases use, by name. Dates come as …Days from today. */
export type AdminAction =
  | { action: 'recordConduct'; member: string; kind: ConductInput['kind']; summary: string; rule?: string; decided?: string; notice?: string; suspended?: string }
  | { action: 'holdConduct'; record: string; until?: string | null; reason: string }
  | { action: 'removeConduct'; record: string }
  | { action: 'lodgeAppeal'; record: string; grounds: string }
  | { action: 'setHearing'; record: string; panel: string[]; hearing?: string }
  | { action: 'decideAppeal'; record: string; outcome: AppealOutcome; note: string }
  | { action: 'withdrawAppeal'; record: string }
  | { action: 'proposeMerch'; chapter: string | null; itemName: string; details?: string; sizes: string[]; priceCents: number; patchedOnly?: boolean }
  | { action: 'decideMerch'; item: string; yes: boolean; reason?: string }
  | { action: 'closeMerch'; item: string }
  | { action: 'orderMerch'; item: string; size: string | null; qty: number; note?: string }
  | { action: 'decideOrder'; order: string; yes: boolean; reason?: string }
  | { action: 'payOrder'; order: string; paid?: string }
  | { action: 'handOver'; order: string }
  | { action: 'cancelOrder'; order: string }
  | { action: 'proposeContribution'; title: string; purpose: string; totalCents: number }
  | { action: 'decideContribution'; contribution: string; chapter: string; vote: string }
  | { action: 'withdrawContribution'; contribution: string }
  | {
      action: 'proposeChapter'; chapterName: string; area: string; state?: string; plan?: Partial<ChapterInput['plan']>; founders: string[];
      president: string; saa: string;
    }
  | { action: 'settleChapter'; proposal: string; vote: string }
  | { action: 'withdrawChapter'; proposal: string };

export const ADMIN_ACTIONS = new Set<string>([
  'recordConduct', 'holdConduct', 'removeConduct', 'lodgeAppeal', 'setHearing', 'decideAppeal', 'withdrawAppeal',
  'proposeMerch', 'decideMerch', 'closeMerch', 'orderMerch', 'decideOrder', 'payOrder', 'handOver', 'cancelOrder',
  'proposeContribution', 'decideContribution', 'withdrawContribution', 'proposeChapter', 'settleChapter', 'withdrawChapter',
]);

/** A full plan, for cases that don't care about it. */
export const CASE_PLAN: ChapterInput['plan'] = {
  location: 'Geelong.', membership: 'Five patched riders.', leadership: 'President and SAA named.', budget: '$500.', operations: 'Monthly.',
};

export function runAdminAction(ctx: DemoCtx, a: AdminAction): ClubData {
  switch (a.action) {
    case 'recordConduct':
      return recordConduct(ctx, {
        memberId: a.member, kind: a.kind, summary: a.summary, rule: a.rule ?? '', decidedOn: a.decided ?? '', noticeOn: a.notice ?? '',
        suspendedUntil: a.suspended ?? null,
      }).data;
    case 'holdConduct':
      return holdConduct(ctx, a.record, a.until ?? null, a.reason);
    case 'removeConduct':
      return removeConduct(ctx, a.record);
    case 'lodgeAppeal':
      return lodgeAppeal(ctx, a.record, a.grounds);
    case 'setHearing':
      return setHearing(ctx, a.record, a.panel, a.hearing ?? '');
    case 'decideAppeal':
      return decideAppeal(ctx, a.record, a.outcome, a.note);
    case 'withdrawAppeal':
      return withdrawAppeal(ctx, a.record);
    case 'proposeMerch':
      return proposeMerch(ctx, {
        chapterId: a.chapter, name: a.itemName, details: a.details ?? '', sizes: a.sizes, priceCents: a.priceCents, patchedOnly: a.patchedOnly ?? false,
      }).data;
    case 'decideMerch':
      return decideMerch(ctx, a.item, a.yes, a.reason ?? '');
    case 'closeMerch':
      return closeMerch(ctx, a.item);
    case 'orderMerch':
      return orderMerch(ctx, { itemId: a.item, size: a.size, qty: a.qty, note: a.note ?? '' }).data;
    case 'decideOrder':
      return decideOrder(ctx, a.order, a.yes, a.reason ?? '');
    case 'payOrder':
      return payOrder(ctx, a.order, a.paid ?? '').data;
    case 'handOver':
      return handOver(ctx, a.order);
    case 'cancelOrder':
      return cancelOrder(ctx, a.order);
    case 'proposeContribution':
      return proposeContribution(ctx, { title: a.title, purpose: a.purpose, totalCents: a.totalCents }).data;
    case 'decideContribution':
      return decideContribution(ctx, a.contribution, a.chapter, a.vote);
    case 'withdrawContribution':
      return withdrawContribution(ctx, a.contribution);
    case 'proposeChapter':
      return proposeChapter(ctx, {
        name: a.chapterName, area: a.area, state: a.state ?? 'VIC', plan: { ...CASE_PLAN, ...a.plan }, founderIds: a.founders,
        presidentId: a.president, saaId: a.saa,
      }).data;
    case 'settleChapter':
      return settleChapter(ctx, a.proposal, a.vote).data;
    case 'withdrawChapter':
      return withdrawChapter(ctx, a.proposal);
  }
}
