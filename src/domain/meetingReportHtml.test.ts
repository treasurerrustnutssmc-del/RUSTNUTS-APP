import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import { meetingFigures, meetingLines } from './meetingReport';
import { meetingReportHtml } from './meetingReportHtml';
import type { ClubData, LedgerEntry } from './types';

const line = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36), chapterId: null, code: 'CR-005', description: 'Line', amountCents: 100, receivedOn: null,
  entryOn: '2026-08-10', payeeMemberId: null, payeeName: null, paymentId: null, state: 'paid', recordedBy: null,
  recordedAt: '2026-08-10T01:00:00.000Z', updatedAt: '2026-08-10T01:00:00.000Z', voidReason: null, voidedBy: null, approvals: [],
  ...over,
});

const data: ClubData = {
  ...DEMO_DATA,
  fundOpenings: [{ chapterId: null, fy: 2026, amountCents: 829771 }],
  cashFloats: [{ fy: 2026, amountCents: 40000 }],
  ledger: [
    line({ chapterId: 'ch-west', code: 'CR-001', description: 'Member fees (Bear)', amountCents: 36000, entryOn: '2026-09-20' }),
    line({ code: 'DB-001', description: 'Accommodation <Princetown> & co', amountCents: 133000, entryOn: '2026-09-17' }),
  ],
};
const figures = meetingFigures('2026-08-01', '2026-10-21', data);
const base = {
  figures,
  data,
  notes: 'Bear and Tigs: paid.\n\nCobra: <check> the register.',
  preparedBy: 'Jeff Ostler, Treasurer, West and North Chapters',
  preparedOn: '2026-10-25',
  logoSrc: 'data:image/png;base64,AAAA',
  fontSrc: null,
};

test('the printed report has every section of Jeff’s, in order', () => {
  const html = meetingReportHtml(base);
  const order = ['Treasurer’s Report', 'Cash position', 'Chapter and shared-fund allocations', 'Monthly cash movement',
    'Meeting read-out', 'Receipts', 'Payments', 'Treasurer’s notes', 'Basis and checks'];
  let at = -1;
  for (const heading of order) {
    const i = html.indexOf(heading, at + 1);
    assert.ok(i > at, `${heading} after the one before`);
    at = i;
  }
  assert.match(html, /October 2026 \| Reporting period: 01\/08\/2026 to 21\/10\/2026/);
  assert.match(html, /Prepared by Jeff Ostler, Treasurer, West and North Chapters/);
  assert.match(html, /Prepared 25\/10\/2026 from the club’s books in the Rustnuts app\./);
  assert.match(html, /RUSTNUTS SMC \| A0119901K \| Treasurer’s report • October 2026/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,AAAA"/);
});

test('the figures, in Jeff’s format', () => {
  const html = meetingReportHtml(base);
  assert.match(html, /Opening bank balance at 01\/08\/2026<\/td><td[^>]*>\$7,897\.71/);
  assert.match(html, /Payments during the reporting period<\/td><td[^>]*>\(\$1,330\.00\)/);
  assert.match(html, /Recorded cash float<\/td><td[^>]*>\$400\.00/);
  assert.match(html, /The bank balance decreased by \$970\.00 over the reporting period\./);
  assert.match(html, /West Chapter/);
  assert.match(html, /Club \/ shared funds/);
  assert.match(html, /September<\/td><td[^>]*>\$360\.00<\/td><td[^>]*>\$1,330\.00<\/td><td[^>]*>-\$970\.00/);
  assert.match(html, /October \(to 21\/10\/2026\)/);
});

test('lines go under their code when given, and everything typed is escaped', () => {
  const plain = meetingReportHtml(base);
  assert.ok(!plain.includes('Princetown'), 'no lines unless asked for');
  const withLines = meetingReportHtml({ ...base, lines: meetingLines('2026-08-01', '2026-10-21', data) });
  assert.match(withLines, /Accommodation &lt;Princetown&gt; &amp; co/);
  assert.ok(!withLines.includes('<Princetown>'));
  assert.match(plain, /<p>Bear and Tigs: paid\.<\/p>\s*<p>Cobra: &lt;check&gt; the register\.<\/p>/);
});

test('no notes, no notes section; a failed check says so', () => {
  assert.ok(!meetingReportHtml({ ...base, notes: '  ' }).includes('Treasurer’s notes'));
  const off = { ...figures, closingCents: figures.closingCents + 1 };
  assert.match(meetingReportHtml({ ...base, figures: off }), /Check failed/);
  assert.match(meetingReportHtml(base), /Each of the 2 paid lines/);
});
