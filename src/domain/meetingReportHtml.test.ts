import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { meetingFigures } from './meetingReport';
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
  notes: 'Club expenses. Bear & Tigs paid.\n\nCobra: <check> the register.',
  meetingOn: '2026-10-25',
  logoSrc: 'data:image/png;base64,AAAA',
  fontSrc: null,
};

test('the printed report is Jeff’s one-page statement, in his order', () => {
  const html = meetingReportHtml(base);
  const order = ['Rustnuts Social Motorcycle Club Incorporated', 'Incorporation No. A0119901K', 'A.B.N 13188715331',
    '38 Delaney Boulevard, Williams Landing VIC 3027', 'Club Treasurer’s Report', 'Sunday 25 October 2026 • Provisional figures',
    'Cashbook period 1 August to 21 October 2026', 'Opening club funds at 31 July, including $400 float', 'Total credits',
    'Members’ fees', 'Event buy-in', 'Total debits', 'Club expenses', 'Club meeting expenses',
    'Provisional balances at 21 October 2026', 'Total club funds', 'Club allocation', 'West allocation', 'North allocation',
    'Net decrease in recorded club funds', 'Bear &amp; Tigs paid.', 'From the club’s cashbook in the Rustnuts app.'];
  let at = -1;
  for (const text of order) {
    const i = html.indexOf(text, at + 1);
    assert.ok(i > at, `${text} after the one before`);
    at = i;
  }
  assert.match(html, /<img[^>]+src="data:image\/png;base64,AAAA"/);
  assert.match(html, /size: A4/);
});

test('the figures, as on Jeff’s report', () => {
  const html = meetingReportHtml(base);
  assert.match(html, /Opening bank balance<\/td><td[^>]*>\$7,897\.71/);
  assert.match(html, /Total debits<\/td><td[^>]*>\$1,330\.00/);
  assert.match(html, /Donations to RSMC<\/td><td[^>]*>\$0\.00/);
  assert.match(html, /Net decrease in recorded club funds<\/td><td[^>]*>\$970\.00/);
  assert.ok(!html.includes('Princetown'), 'no line descriptions on the members’ report');
});

test('notes: the lead in bold, everything typed escaped, no notes no notes', () => {
  const html = meetingReportHtml(base);
  assert.match(html, /<p><b>Club expenses\.<\/b> Bear &amp; Tigs paid\.<\/p>/);
  assert.match(html, /<p>Cobra: &lt;check&gt; the register\.<\/p>/);
  assert.ok(!html.includes('<check>'));
  assert.ok(!meetingReportHtml({ ...base, notes: '  ' }).includes('class="notes"'));
});
