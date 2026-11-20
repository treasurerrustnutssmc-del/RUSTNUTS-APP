import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { meetingFigures } from './meetingReport';
import { longDate, meetingStatement, noteParagraphs, STATEMENT_LABEL } from './meetingStatement';
import { CREDIT_CODES, DEBIT_CODES } from './ledger';
import type { ClubData, LedgerEntry } from './types';

let n = 0;
const line = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: `s-${(n += 1)}`, chapterId: null, code: 'CR-005', description: 'Line', amountCents: 100, receivedOn: null,
  entryOn: '2026-10-25', payeeMemberId: null, payeeName: null, paymentId: null, state: 'paid', recordedBy: null,
  recordedAt: '2026-10-25T01:00:00.000Z', updatedAt: '2026-10-25T01:00:00.000Z', voidReason: null, voidedBy: null, approvals: [],
  ...over,
});

// Jeff's November 2026 report: 22/10 to 08/11, $400 float, $50 fees, $200 club payment, $60 merch in,
// $268.22 club expenses and $2.01 bank fees out.
const data: ClubData = {
  ...DEMO_DATA,
  fundOpenings: [
    { chapterId: null, fy: 2026, amountCents: 285938 },
    { chapterId: 'ch-west', fy: 2026, amountCents: 519000 },
    { chapterId: 'ch-north', fy: 2026, amountCents: 168000 },
  ],
  cashFloats: [{ fy: 2026, amountCents: 40000 }],
  ledger: [
    line({ chapterId: 'ch-west', code: 'CR-001', amountCents: 5000, entryOn: '2026-10-26' }),
    line({ code: 'CR-003', amountCents: 20000 }),
    line({ code: 'CR-005', amountCents: 6000, entryOn: '2026-11-03' }),
    line({ code: 'DB-001', amountCents: 26822, entryOn: '2026-11-02' }),
    line({ code: 'DB-004', amountCents: 201, entryOn: '2026-11-02' }),
    line({ code: 'CR-005', amountCents: 999, entryOn: '2026-11-09' }), // after the period
  ],
};
const f = meetingFigures('2026-10-22', '2026-11-08', data);

test('long dates as Jeff writes them', () => {
  assert.equal(longDate('2026-11-08'), '8 November 2026');
  assert.equal(longDate('2026-10-21', { year: false }), '21 October');
  assert.equal(longDate('2026-11-21', { weekday: true }), 'Saturday 21 November 2026');
});

test('the statement runs in Jeff’s order, every code shown, $0 lines included', () => {
  const s = meetingStatement(f, data, '2026-11-21');
  assert.equal(s.title, 'Club Treasurer’s Report');
  assert.equal(s.subtitle, 'Saturday 21 November 2026 • Provisional figures');
  assert.equal(s.period, 'Cashbook period 22 October to 8 November 2026');
  const labels = s.rows.map((r) => r.label);
  const at = (l: string) => labels.indexOf(l);
  const order = ['Opening club funds at 21 October, including $400 float', 'Opening bank balance', 'Total credits',
    ...CREDIT_CODES.map((c) => STATEMENT_LABEL[c]), 'Total debits', ...DEBIT_CODES.map((c) => STATEMENT_LABEL[c]),
    'Provisional balances at 8 November 2026', 'Closing bank balance per cashbook', 'Cash float carried forward',
    'Total club funds', 'Club allocation', 'West allocation', 'North allocation', 'Net increase in recorded club funds'];
  order.forEach((l, i) => {
    assert.ok(at(l) >= 0, `${l} is there`);
    if (i > 0) assert.ok(at(l) > at(order[i - 1]), `${l} after ${order[i - 1]}`);
  });
  assert.equal(labels.length, order.length);
});

test('the figures match the books', () => {
  const s = meetingStatement(f, data, '2026-11-21');
  const cents = (l: string) => s.rows.find((r) => r.label === l)?.cents;
  assert.equal(cents('Opening club funds at 21 October, including $400 float'), 285938 + 519000 + 168000); // the Club fund holds the float
  assert.equal(cents('Opening bank balance'), 285938 + 519000 + 168000 - 40000);
  assert.equal(cents('Total credits'), 31000);
  assert.equal(cents('Members’ fees'), 5000);
  assert.equal(cents('Donations to RSMC'), 0);
  assert.equal(cents('Total debits'), 27023);
  assert.equal(cents('Bank payments (fees)'), 201);
  assert.equal(cents('Closing bank balance per cashbook'), f.closingCents - 40000);
  assert.equal(cents('Cash float carried forward'), 40000);
  assert.equal(cents('Total club funds'), f.closingCents);
  assert.equal(cents('West allocation'), 524000);
  assert.equal(cents('Net increase in recorded club funds'), 3977);
  assert.equal(s.rows.find((r) => r.label === 'Provisional balances at 8 November 2026')?.cents, null);
  assert.deepEqual(s.rows.filter((r) => r.kind === 'head').map((r) => r.label), [
    'Opening club funds at 21 October, including $400 float', 'Total credits', 'Total debits', 'Total club funds',
    'Net increase in recorded club funds',
  ]);
});

test('a fall says decrease, no float says nothing of one, and an even period says no change', () => {
  const down = { ...f, paymentsCents: f.paymentsCents + 10000, closingCents: f.openingCents - 500, floatCents: 0 };
  const s = meetingStatement(down, data, '2026-11-21');
  assert.ok(s.rows.some((r) => r.label === 'Net decrease in recorded club funds' && r.cents === 500));
  assert.ok(s.rows.some((r) => r.label === 'Opening club funds at 21 October'));
  assert.ok(!s.rows.some((r) => r.label === 'Cash float carried forward'));
  const even = meetingStatement({ ...f, closingCents: f.openingCents }, data, '2026-11-21');
  assert.ok(even.rows.some((r) => r.label === 'No change in recorded club funds' && r.cents === 0));
});

test('notes: a short opening sentence becomes the lead, as in Jeff’s PDF', () => {
  assert.deepEqual(noteParagraphs('Club expenses. CAV $196.20 and app costs.\n\nJust a plain note, with no lead at all here because it runs long.\n\n  '), [
    { lead: 'Club expenses.', text: 'CAV $196.20 and app costs.' },
    { lead: null, text: 'Just a plain note, with no lead at all here because it runs long.' },
  ]);
  assert.deepEqual(noteParagraphs('Line one\nline two'), [{ lead: null, text: 'Line one\nline two' }]);
  assert.deepEqual(noteParagraphs('Paid $50.00 today.'), [{ lead: null, text: 'Paid $50.00 today.' }]);
});
