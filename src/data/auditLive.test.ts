import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAudit } from './auditLive';

test('club_audit() reads as requests and reports', () => {
  const out = toAudit({
    requests: [{
      id: 'r1', chapter_id: null, kind: 'correction', area: 'controls', title: 'Two approvals', details: 'Fix it', due_on: '2026-11-12',
      ledger_entry_id: null, raised_by: 'a', raised_at: '2026-10-29T01:00:00+00:00', answer: null, answered_by: null,
      answered_at: null, closed_at: null, closed_by: null, close_note: null,
    }],
    reports: [{
      id: 'p1', title: 'Review', from_on: '2026-07-01', to_on: '2026-09-30', findings: 'Fine', recommendations: null,
      written_by: 'a', saved_at: '2026-10-29T01:00:00+00:00', issued_at: '2026-10-29T02:00:00+00:00',
    }],
  });
  assert.equal(out.auditRequests[0].chapterId, null);
  assert.equal(out.auditRequests[0].raisedAt, '2026-10-29T01:00:00.000Z');
  assert.equal(out.auditRequests[0].dueOn, '2026-11-12');
  assert.equal(out.auditReports[0].issuedAt, '2026-10-29T02:00:00.000Z');
});

test('an old database without club_audit reads as nothing', () => {
  assert.deepEqual(toAudit(null), { auditRequests: [], auditReports: [] });
  assert.deepEqual(toAudit([] as never), { auditRequests: [], auditReports: [] });
});
