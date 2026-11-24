import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { financesAsSeenBy, forSharing, NAMES_HERE_LINE, PRIVACY_LINE, privacyLine, seesMemberNames } from './financePrivacy';
import { approveProblem, needsMyApproval } from './ledger';
import type { ClubData, LedgerEntry, MeetingReport, Member } from './types';

// Jeff, 24 Nov 2026: "no personal or road names on any transactions". Only the people who keep a
// fund's books, and the National Auditor, see members' names on its lines; board members approving
// spending see "a member". Mirrors public.club_ledger() and public.meeting_reports().

const who = (id: string) => DEMO_DATA.members.find((m) => m.id === id) as Member;
const line = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'x', chapterId: 'ch-west', code: 'DB-001', description: 'Fuel for Diesel', amountCents: 100, receivedOn: null,
  entryOn: '2026-08-10', payeeMemberId: 'm-diesel', payeeName: null, paymentId: 'pay-1', state: 'paid', recordedBy: 'm-sparks',
  recordedAt: '2026-08-10T01:00:00.000Z', updatedAt: '2026-08-10T01:00:00.000Z', voidReason: null, voidedBy: null, approvals: [],
  ...over,
});
const report = (notes: string): MeetingReport => ({
  id: 'r1', fromOn: '2026-07-01', toOn: '2026-10-31', notes, savedBy: 'm-sparks', savedAt: '2026-11-01T00:00:00.000Z',
  presentedBy: 'm-sparks', presentedAt: '2026-11-01T00:00:00.000Z', pdfPath: null, pdfName: null,
} as MeetingReport);
const data: ClubData = {
  ...DEMO_DATA,
  ledger: [
    line({ id: 'w', description: 'Fuel for Diesel (Dean Mercer)' }),
    line({ id: 'b', chapterId: 'ch-west', description: 'Hoodies', payeeMemberId: null, payeeName: 'Ink & Iron Printing', paymentId: null }),
    line({ id: 'n', chapterId: 'ch-west', description: 'Paid Torque', payeeMemberId: null, payeeName: 'Torque', paymentId: null }),
    line({ id: 's', chapterId: 'ch-west', description: 'Refund to Rusty', payeeMemberId: 'm-rusty', paymentId: null }),
  ],
  meetingReports: [report('Thanks to Sparks and Gary Kowalski.')],
};

test('who sees members’ names on a fund’s lines', () => {
  assert.ok(seesMemberNames(who('m-sparks'), 'ch-west', data), 'the West Treasurer');
  assert.ok(seesMemberNames(who('m-ace'), 'ch-west', data), 'the National Auditor');
  assert.ok(seesMemberNames(who('m-rusty'), 'ch-west', data), 'the NEC Chairman keeps the books');
  assert.ok(!seesMemberNames(who('m-torque'), 'ch-west', data), 'not the West Secretary, who approves');
  assert.ok(!seesMemberNames(who('m-diesel'), 'ch-west', data), 'not a Road Captain');
  assert.ok(!seesMemberNames(null, 'ch-west', data), 'nobody signed out');
});

test('the treasurer and the auditor get the books as written', () => {
  assert.equal(financesAsSeenBy(data, who('m-sparks')), data, 'nothing changed, the same object');
  const auditor = financesAsSeenBy(data, who('m-ace'));
  assert.deepEqual(auditor.ledger, data.ledger);
  assert.equal(auditor.meetingReports?.[0].notes, 'Thanks to Sparks and Gary Kowalski.');
});

test('a board member approving spending sees “a member”', () => {
  const seen = financesAsSeenBy(data, who('m-torque'));
  const by = (id: string) => seen.ledger!.find((e) => e.id === id)!;
  assert.equal(by('w').description, 'Fuel for a member (a member)');
  assert.equal(by('w').payeeName, 'A member', 'a member payee, by id');
  assert.equal(by('w').payeeMemberId, null, 'and the id goes, so the name can’t be looked up');
  assert.equal(by('w').paymentId, null, 'nor whose fee it was');
  assert.equal(by('b').payeeName, 'Ink & Iron Printing', 'a business stays named');
  assert.equal(by('n').payeeName, 'A member', 'a member typed as the payee');
  assert.equal(by('n').description, 'Paid a member');
  assert.equal(seen.meetingReports?.[0].notes, 'Thanks to a member and a member.', 'the notes, as members read them');
  assert.equal(data.ledger![0].description, 'Fuel for Diesel (Dean Mercer)', 'the books themselves are untouched');
});

test('a payment to yourself keeps your own id, so you can’t approve it', () => {
  const seen = financesAsSeenBy({ ...data, ledger: [line({ id: 't', payeeMemberId: 'm-torque', description: 'Refund to Torque' })] }, who('m-torque'));
  assert.equal(seen.ledger![0].payeeMemberId, 'm-torque');
  assert.equal(seen.ledger![0].payeeName, 'A member');
  assert.equal(seen.ledger![0].description, 'Refund to a member');
});

test('an ordinary member reads the meeting notes with names hidden', () => {
  const seen = financesAsSeenBy(data, who('m-gravel'));
  assert.equal(seen.meetingReports?.[0].notes, 'Thanks to a member and a member.');
});

test('what gets shared (the PDFs) has names taken out of every line and the notes', () => {
  const lines = { 'DB-001': [line({ id: 'p', description: 'Fuel for Diesel' })], 'DB-004': [line({ id: 'q', description: 'Bank fee' })] };
  const out = forSharing({ notes: 'Thanks Sparks.', lines }, DEMO_DATA.members);
  assert.equal(out.notes, 'Thanks a member.');
  assert.equal(out.lines!['DB-001']![0].description, 'Fuel for a member');
  assert.equal(out.lines!['DB-004']![0].description, 'Bank fee');
  assert.equal(lines['DB-001'][0].description, 'Fuel for Diesel', 'the books themselves are untouched');
  assert.equal(forSharing({ notes: '', lines: undefined }, DEMO_DATA.members).lines, undefined);
});

test('the privacy line says who sees names, to whoever sees them', () => {
  assert.equal(privacyLine(who('m-sparks'), data, 'ch-west'), NAMES_HERE_LINE, 'the West Treasurer, on West’s books');
  assert.equal(privacyLine(who('m-sparks'), data), NAMES_HERE_LINE, 'and on Treasury, keeping some books');
  assert.equal(privacyLine(who('m-ace'), data), NAMES_HERE_LINE, 'the Auditor');
  assert.equal(privacyLine(who('m-torque'), data, 'ch-west'), PRIVACY_LINE, 'a board member approving');
  assert.equal(privacyLine(who('m-gravel'), data), PRIVACY_LINE, 'a member');
  assert.equal(privacyLine(null, data), PRIVACY_LINE);
});

test('a board member who can’t approve a hidden payment is told why without the payee’s name', () => {
  // Torque covers Diesel's Road Captain seat; Diesel's refund waits for approval.
  const seat = DEMO_DATA.positions.find((p) => p.memberId === 'm-diesel' && p.role === 'road_captain')!;
  const covered: ClubData = {
    ...data,
    positions: [...data.positions, { id: 'p-cover', memberId: 'm-torque', chapterId: 'ch-west', role: 'road_captain', startedOn: '2026-11-01', endedOn: null, actingUntil: '2026-12-31', actingWhy: 'Diesel away', covers: seat.id, appointedBy: 'm-rusty' }],
    ledger: [line({ id: 'r', state: 'awaiting', entryOn: null, description: 'Refund to Diesel', payeeMemberId: 'm-diesel', approvals: [{ memberId: 'm-sparks', approvedAt: '2026-11-02T00:00:00.000Z' }] })],
  };
  const seen = financesAsSeenBy(covered, who('m-torque'));
  const want = 'This payment goes to the other approvers (13.3).';
  assert.equal(seen.ledger![0].myConflict, want, 'worked out before the payee is taken off');
  assert.equal(approveProblem(who('m-torque'), 'r', seen), want, 'so the Approve button stays off');
  assert.ok(!needsMyApproval(who('m-torque'), seen).some((e) => e.id === 'r'), 'and it isn’t on Home as one to approve');
});
