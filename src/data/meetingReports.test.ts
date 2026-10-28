import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import * as act from './ledgerActions';
import { toMeetingReports } from './ledgerLive';
import type { DemoCtx } from './demoActions';
import type { ClubData } from '../domain/types';

const blank: ClubData = { ...DEMO_DATA, meetingReports: [] };
const me = (id: string) => blank.members.find((m) => m.id === id)!;
const NOW = '2026-10-25T01:00:00.000Z';
const ctx = (who: string, data: ClubData = blank): DemoCtx => ({ data, me: me(who), today: '2026-10-25', now: NOW });

test('a meeting report: saved as a draft, changed, presented and then locked', () => {
  const r = act.saveMeetingReport(ctx('m-sparks'), null, { fromOn: '2026-08-01', toOn: '2026-10-21', notes: 'Bear paid.' });
  let data = r.data;
  const one = () => data.meetingReports!.find((x) => x.id === r.id)!;
  assert.deepEqual([one().notes, one().savedBy, one().presentedAt], ['Bear paid.', 'm-sparks', null]);
  data = act.saveMeetingReport(ctx('m-rusty', data), r.id, { fromOn: '2026-08-01', toOn: '2026-10-21', notes: 'Bear and Tigs paid.' }).data;
  assert.deepEqual([one().notes, one().savedBy, data.meetingReports!.length], ['Bear and Tigs paid.', 'm-rusty', 1]);
  assert.throws(() => act.presentMeetingReport(ctx('m-torque', data), r.id), /keeps its books/);
  data = act.presentMeetingReport(ctx('m-sparks', data), r.id);
  assert.deepEqual([one().presentedBy, one().presentedAt], ['m-sparks', NOW]);
  assert.throws(() => act.saveMeetingReport(ctx('m-sparks', data), r.id, { fromOn: '2026-08-01', toOn: '2026-10-21', notes: '' }), /can’t be changed/);
  assert.throws(() => act.deleteMeetingReport(ctx('m-sparks', data), r.id), /can’t be changed/);
});

test('a draft can be deleted', () => {
  const r = act.saveMeetingReport(ctx('m-sparks'), null, { fromOn: '2026-10-01', toOn: '2026-10-21', notes: '' });
  assert.deepEqual(act.deleteMeetingReport(ctx('m-sparks', r.data), r.id).meetingReports, []);
});

test('the live read becomes reports and their figures', () => {
  const out = toMeetingReports([{
    id: 'r1', from_on: '2026-08-01', to_on: '2026-10-21', notes: 'n', saved_by: 'm1', saved_at: '2026-10-25T01:00:00+00:00',
    presented_by: null, presented_at: null,
    figures: {
      from: '2026-08-01', to: '2026-10-21',
      funds: { club: { opening_cents: '100' as unknown as number, receipts_cents: 5, payments_cents: 1, closing_cents: 104 } },
      credits: [{ code: 'CR-001', cents: 5 }], debits: [{ code: 'DB-004', cents: 1 }],
      receipts_cents: 5, payments_cents: 1, opening_cents: 100, closing_cents: 104, float_cents: 0,
      months: [{ month: '2026-08-01', from: '2026-08-01', to: '2026-08-31', receipts_cents: 5, payments_cents: 1 }],
      line_count: 2, last_change_at: '2026-10-21T01:00:00+00:00',
    },
  }]);
  assert.deepEqual(out.meetingReports, [{
    id: 'r1', fromOn: '2026-08-01', toOn: '2026-10-21', notes: 'n', savedBy: 'm1', savedAt: '2026-10-25T01:00:00.000Z',
    presentedBy: null, presentedAt: null,
  }]);
  const f = out.meetingTotals[0];
  assert.equal(f.id, 'r1');
  assert.deepEqual(f.funds.club, { openingCents: 100, receiptsCents: 5, paymentsCents: 1, closingCents: 104 }, 'big sums come back as numbers');
  assert.deepEqual(f.months, [{ month: '2026-08-01', from: '2026-08-01', to: '2026-08-31', receiptsCents: 5, paymentsCents: 1 }]);
  assert.equal(f.lastChangeAt, '2026-10-21T01:00:00.000Z');
  for (const odd of [null, 'x', { a: 1 }] as unknown[]) assert.deepEqual(toMeetingReports(odd as never).meetingReports, []);
});
