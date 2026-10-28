import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAdmin } from './adminLive';

const T = '2026-10-24T02:00:00+00:00';
const Z = '2026-10-24T02:00:00.000Z';

test('an answer that isn’t the admin read reads as nothing', () => {
  for (const odd of [[], 'x', 1, null, undefined, { conduct: 'x' }] as unknown[]) {
    const a = toAdmin(odd as never);
    assert.deepEqual([a.conduct, a.merchItems, a.merchOrders, a.contributions, a.chapterProposals], [[], [], [], [], []]);
  }
});

test('the live admin read becomes app records', () => {
  const a = toAdmin({
    conduct: [{
      id: 'r1', member_id: 'm1', chapter_id: 'c1', kind: 'suspension', summary: 'Ride', rule: null, decided_on: '2026-10-01',
      notice_on: '2026-10-01', suspended_until: '2026-11-01', recorded_by: 'm2', recorded_at: T, hold_until: null, hold_reason: null,
      appeal: {
        lodged_on: '2026-10-03', lodged_by: 'm1', grounds: 'No', panel: ['m3'], hearing_on: null, outcome: null, outcome_note: null,
        decided_on: null, decided_by: null, withdrawn_on: null,
      },
    }],
    merch_items: [{
      id: 'i1', chapter_id: null, name: 'Tee', details: null, sizes: ['S', 'M'], price_cents: 3500, patched_only: true, status: 'on_sale',
      proposed_by: 'm2', proposed_at: T, decided_by: 'm3', decided_at: T, decline_reason: null,
    }],
    merch_orders: [{
      id: 'o1', item_id: 'i1', member_id: 'm1', size: 'M', qty: 2, unit_cents: 3500, note: null, status: 'paid', ordered_at: T,
      decided_by: 'm3', decided_at: T, decline_reason: null, paid_on: '2026-10-24', ledger_entry_id: 'e1', handed_over_on: null,
    }],
    contributions: [{
      id: 'k1', title: 'Run', purpose: 'Fuel', total_cents: 10001, status: 'proposed', proposed_by: 'm2', proposed_at: T, settled_at: null,
      shares: [{ chapter_id: 'c1', voting_members: 6, cents: 5455 }],
      decisions: [{ chapter_id: 'c1', yes: true, vote_id: 'v1', recorded_by: 'm2', recorded_at: T }],
    }],
    chapter_proposals: [{
      id: 'p1', name: 'North', area: 'Bendigo', state: 'VIC',
      plan: { location: 'a', membership: 'b', leadership: 'c', budget: 'd', operations: 'e' }, founder_ids: ['m1'],
      president_id: 'm1', saa_id: 'm4', status: 'proposed', proposed_by: 'm2', proposed_at: T, vote_id: null, decided_by: null,
      decided_at: null, chapter_id: null,
    }],
  });
  assert.deepEqual(a.conduct[0], {
    id: 'r1', memberId: 'm1', chapterId: 'c1', kind: 'suspension', summary: 'Ride', rule: '', decidedOn: '2026-10-01',
    noticeOn: '2026-10-01', suspendedUntil: '2026-11-01', recordedBy: 'm2', recordedAt: Z, holdUntil: null, holdReason: '',
    appeal: {
      lodgedOn: '2026-10-03', lodgedBy: 'm1', grounds: 'No', panelIds: ['m3'], hearingOn: null, outcome: null, outcomeNote: '',
      decidedOn: null, decidedBy: null, withdrawnOn: null,
    },
  });
  assert.deepEqual(a.merchItems[0], {
    id: 'i1', chapterId: null, name: 'Tee', details: '', sizes: ['S', 'M'], priceCents: 3500, patchedOnly: true, status: 'on_sale',
    proposedBy: 'm2', proposedAt: Z, decidedBy: 'm3', decidedAt: Z, declineReason: '',
  });
  assert.deepEqual(a.merchOrders[0], {
    id: 'o1', itemId: 'i1', memberId: 'm1', size: 'M', qty: 2, unitCents: 3500, note: '', status: 'paid', orderedAt: Z,
    decidedBy: 'm3', decidedAt: Z, declineReason: '', paidOn: '2026-10-24', ledgerEntryId: 'e1', handedOverOn: null,
  });
  assert.deepEqual(a.contributions[0], {
    id: 'k1', title: 'Run', purpose: 'Fuel', totalCents: 10001, status: 'proposed', proposedBy: 'm2', proposedAt: Z, settledAt: null,
    shares: [{ chapterId: 'c1', votingMembers: 6, cents: 5455 }],
    decisions: [{ chapterId: 'c1', yes: true, voteId: 'v1', recordedBy: 'm2', recordedAt: Z }],
  });
  assert.deepEqual(a.chapterProposals[0], {
    id: 'p1', name: 'North', area: 'Bendigo', state: 'VIC',
    plan: { location: 'a', membership: 'b', leadership: 'c', budget: 'd', operations: 'e' }, founderIds: ['m1'],
    presidentId: 'm1', saaId: 'm4', status: 'proposed', proposedBy: 'm2', proposedAt: Z, voteId: null, decidedBy: null,
    decidedAt: null, chapterId: null,
  });
});
