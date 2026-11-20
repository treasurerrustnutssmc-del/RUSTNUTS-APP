import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { hideMemberNames, spendingByCode, spendingFor, spendingLines, spendingMonths, spendingTotal, spendingYears } from './clubSpending';
import type { ClubData, LedgerEntry, Member } from './types';

const people = [
  { fullName: 'Gary Kowalski', roadName: 'Rusty' },
  { fullName: 'Lisa Romano', roadName: 'Sparks' },
  { fullName: 'Al', roadName: 'El Jefe' },
] as Pick<Member, 'fullName' | 'roadName'>[];

test('member names come out of what members read', () => {
  assert.equal(hideMemberNames('Fuel for Rusty and Sparks', people), 'Fuel for a member and a member');
  assert.equal(hideMemberNames('Transfer to West for RUSTY’s fees', people), 'Transfer to West for a member’s fees');
  assert.equal(hideMemberNames('Refund to Gary Kowalski', people), 'Refund to a member', 'the full name, not "Gary a member"');
  assert.equal(hideMemberNames('Meeting food (El Jefe)', people), 'Meeting food (a member)');
  assert.equal(hideMemberNames('Rustyness and Sparkster', people), 'Rustyness and Sparkster', 'only whole words');
  assert.equal(hideMemberNames('Paid Al', people), 'Paid Al', 'names under three characters stay');
  assert.equal(hideMemberNames('Dawn Studios - merchandise', people), 'Dawn Studios - merchandise');
});

let n = 0;
const line = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: `e-${++n}`, chapterId: null, code: 'DB-001', description: 'Thing', amountCents: 100, receivedOn: null,
  entryOn: '2026-08-10', payeeMemberId: null, payeeName: null, paymentId: null, state: 'paid', recordedBy: 'm-sparks',
  recordedAt: '2026-08-10T01:00:00.000Z', updatedAt: '2026-08-10T01:00:00.000Z', voidReason: null, voidedBy: null, approvals: [],
  ...over,
});

test('every paid expense in the year, newest first, with member payees hidden', () => {
  const data: ClubData = {
    ...DEMO_DATA,
    ledger: [
      line({ id: 'a', entryOn: '2026-08-01', description: 'Fuel for Rusty', payeeName: 'Rusty', amountCents: 5000 }),
      line({ id: 'b', entryOn: '2026-09-01', code: 'DB-005', chapterId: 'ch-west', payeeName: 'Dawn Studios', amountCents: 20000 }),
      line({ id: 'c', entryOn: '2026-09-02', payeeMemberId: 'm-sparks', payeeName: null, amountCents: 300 }),
      line({ id: 'd', entryOn: '2026-09-03', state: 'awaiting' }),
      line({ id: 'e', entryOn: '2026-09-04', state: 'void' }),
      line({ id: 'f', entryOn: '2026-09-05', code: 'CR-005' }),
      line({ id: 'g', entryOn: '2026-06-30', description: 'Last year' }),
    ],
  };
  const out = spendingLines(data, 2026);
  assert.deepEqual(out.map((l) => l.id), ['c', 'b', 'a'], 'paid debits only, this year, newest first');
  assert.deepEqual(out[2], { id: 'a', entryOn: '2026-08-01', code: 'DB-001', chapterId: null, amountCents: 5000, description: 'Fuel for a member', payee: 'A member' });
  assert.equal(out[1].payee, 'Dawn Studios');
  assert.equal(out[0].payee, 'A member', 'a member payee by id');
  assert.equal(spendingTotal(out), 25300);
  assert.deepEqual(spendingLines(data, 2025).map((l) => l.id), ['g']);
  assert.deepEqual(spendingLines({ ...data, ledger: undefined }, 2026), []);
});

test('live members get the database’s lines; the demo and the books keepers work them out', () => {
  const mine = spendingLines({ ...DEMO_DATA, ledger: [line({ id: 'x', entryOn: '2026-09-01', amountCents: 700 })] }, 2026);
  const fromDb = [{ id: 'db', entryOn: '2026-10-01', code: 'DB-004' as const, chapterId: null, amountCents: 94, description: 'Fee', payee: null },
    { id: 'old', entryOn: '2026-06-01', code: 'DB-001' as const, chapterId: null, amountCents: 5, description: 'Old', payee: null }];
  assert.deepEqual(spendingFor({ ...DEMO_DATA, spending: fromDb, ledger: [] }, 2026).map((l) => l.id), ['db']);
  assert.deepEqual(spendingFor({ ...DEMO_DATA, ledger: [line({ id: 'x', entryOn: '2026-09-01', amountCents: 700 })] }, 2026), mine);
});

test('the year’s spending by kind, biggest first, and the years to pick from', () => {
  const lines = [
    { id: '1', entryOn: '2026-10-01', code: 'DB-004' as const, chapterId: null, amountCents: 94, description: '', payee: null },
    { id: '2', entryOn: '2026-10-02', code: 'DB-001' as const, chapterId: null, amountCents: 3000, description: '', payee: null },
    { id: '3', entryOn: '2026-10-03', code: 'DB-001' as const, chapterId: null, amountCents: 200, description: '', payee: null },
  ];
  assert.deepEqual(spendingByCode(lines), [{ code: 'DB-001', cents: 3200 }, { code: 'DB-004', cents: 94 }]);
  assert.deepEqual(spendingYears('2026-11-21'), [2026, 2025]);
  assert.deepEqual(spendingYears('2026-06-30'), [2025, 2024]);
  assert.deepEqual(spendingMonths(lines.slice().reverse()).map((m) => [m.month, m.lines.length]), [['2026-10', 3]]);
});
