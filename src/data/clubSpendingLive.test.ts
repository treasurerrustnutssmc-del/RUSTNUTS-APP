import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSpending } from './ledgerLive';

test('club_spending() rows become spending lines; anything malformed is dropped', () => {
  assert.deepEqual(toSpending([
    { id: 'a', entry_on: '2026-11-02', code: 'DB-001', chapter_id: null, amount_cents: '26822', description: 'CAV statements', payee: 'Consumer Affairs Victoria' },
    { id: 'b', entry_on: 'soon', code: 'DB-001', chapter_id: null, amount_cents: 1, description: '', payee: null },
    { id: 'c', entry_on: '2026-11-03', code: 'DB-004', chapter_id: 'ch-west', amount_cents: 94, description: null, payee: null },
  ]), [
    { id: 'a', entryOn: '2026-11-02', code: 'DB-001', chapterId: null, amountCents: 26822, description: 'CAV statements', payee: 'Consumer Affairs Victoria' },
    { id: 'c', entryOn: '2026-11-03', code: 'DB-004', chapterId: 'ch-west', amountCents: 94, description: '', payee: null },
  ]);
  assert.equal(toSpending(null), undefined, 'no function yet: work it out from the books as before');
});
