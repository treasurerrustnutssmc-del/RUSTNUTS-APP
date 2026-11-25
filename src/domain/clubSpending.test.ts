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

test('first names, surnames and road names however they are spaced come out too (Jeff, 24 Nov 2026)', () => {
  const crew = [
    { fullName: 'Gary Kowalski', roadName: 'Bam Bam' },
    { fullName: 'Christopher Andrew Dyson', roadName: 'Dysco' },
  ] as Pick<Member, 'fullName' | 'roadName'>[];
  assert.equal(hideMemberNames('Fuel for Gary', crew), 'Fuel for a member', 'a first name alone');
  assert.equal(hideMemberNames('Kowalski’s refund', crew), 'a member’s refund', 'a surname alone');
  assert.equal(hideMemberNames('Fees - BamBam and bam-bam', crew), 'Fees - a member and a member', 'road name spaced differently');
  assert.equal(hideMemberNames('Merch from Christopher Andrew D', crew), 'Merch from a member D', 'every part of a full name');
  assert.equal(hideMemberNames('Dawn Studios - merchandise', crew), 'Dawn Studios - merchandise', 'businesses stay');
  assert.equal(hideMemberNames('Garyville and Bambam2', crew), 'Garyville and Bambam2', 'still whole words only');
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

test('club words and businesses survive names that are everyday words (review, 24 Nov 2026)', () => {
  const crew = [
    { fullName: 'Tom Shell', roadName: 'Rusty' },
    { fullName: 'Gary Kowalski', roadName: 'Diesel' },
  ] as Pick<Member, 'fullName' | 'roadName'>[];
  assert.equal(hideMemberNames('Rego for the Rusty Bus', crew), 'Rego for the Rusty Bus', 'the club’s van keeps its name');
  assert.equal(hideMemberNames('RUSTY BUS tyres, paid Rusty', crew), 'Rusty Bus tyres, paid a member');
  assert.equal(hideMemberNames('Gary a membership', crew), 'a member a membership', 'the collapse is whole words only');
  assert.equal(hideMemberNames('Gary Kowalski Diesel', crew), 'a member', 'parts of names side by side collapse');
});

test('a typed business payee keeps its other words when one word is a name', () => {
  const crew = [{ fullName: 'Tom Shell', roadName: 'Rusty' }] as Pick<Member, 'fullName' | 'roadName'>[];
  const data: ClubData = {
    ...DEMO_DATA, members: crew as Member[],
    ledger: [
      line({ id: 'a', entryOn: '2026-08-01', payeeName: 'Shell Ringwood' }),
      line({ id: 'b', entryOn: '2026-08-02', payeeName: 'Tom' }),
      line({ id: 'c', entryOn: '2026-08-03', payeeName: 'Rusty Bus Repairs' }),
    ],
  };
  const out = spendingLines(data, 2026);
  assert.equal(out.find((l) => l.id === 'a')!.payee, 'a member Ringwood', 'not swapped whole for one word');
  assert.equal(out.find((l) => l.id === 'b')!.payee, 'A member', 'a name on its own is a member');
  assert.equal(out.find((l) => l.id === 'c')!.payee, 'Rusty Bus Repairs');
});

test('hiding is quick with a big club and long books', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ fullName: `Person${i} Surname${i}`, roadName: `Road${i}` }));
  const t = Date.now();
  for (let i = 0; i < 2000; i++) hideMemberNames(`Fuel for Road${i % 300} and Person${i % 7}`, many);
  assert.ok(Date.now() - t < 1500, `2,000 lines took ${Date.now() - t} ms`);
});
