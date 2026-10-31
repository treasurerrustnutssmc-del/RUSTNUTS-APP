import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canActOnContentReport,
  reportContentProblem,
  reportedByMe,
  resolveContentReportProblem,
  withoutReported,
  type ContentReport,
  type ReportTarget,
} from './reports';
import type { Member, Position } from './types';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Name ${id}`, roadName: null, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, postingRulesAcceptedOn: '2026-10-31', ...over,
});
const seat = (id: string, memberId: string, chapterId: string | null, role: Position['role']): Position => ({
  id, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});
const westie = member('westie');
const seller = member('seller');
const secretary = member('secretary');
const northPres = member('northpres', { chapterId: 'ch-north' });
const positions = [seat('p1', 'secretary', 'ch-west', 'secretary'), seat('p2', 'northpres', 'ch-north', 'president')];
const target = (over: Partial<ReportTarget> = {}): ReportTarget => ({
  kind: 'listing', id: 'l1', authorId: 'seller', gone: false, snapshot: 'Panniers', ...over,
});

test('an approved member reports someone else’s listing, with or without a reason', () => {
  assert.equal(reportContentProblem(westie, 'listing', target(), ''), null);
  assert.equal(reportContentProblem(westie, 'listing', target(), 'Not on'), null);
});

test('the refusals, in the database’s order', () => {
  assert.equal(reportContentProblem(null, 'listing', target(), ''), 'Sign in first.');
  assert.equal(reportContentProblem(member('p', { approval: 'pending' }), 'listing', target(), ''), 'Only approved members can do that.');
  assert.equal(reportContentProblem(member('f', { status: 'family' }), 'listing', target(), ''), 'Only approved members can do that.');
  assert.equal(reportContentProblem(westie, 'photo', target(), ''), 'Pick what you’re reporting.');
  assert.equal(reportContentProblem(westie, 'listing', undefined, ''), 'No such listing.');
  assert.equal(reportContentProblem(westie, 'build_update', undefined, ''), 'No such update.');
  assert.equal(reportContentProblem(westie, 'nomination', undefined, ''), 'No such nomination.');
  assert.equal(reportContentProblem(westie, 'mechanic', undefined, ''), 'No such workshop.');
  assert.equal(reportContentProblem(westie, 'profile', undefined, ''), 'That member no longer exists.');
  assert.equal(reportContentProblem(westie, 'listing', target({ gone: true }), ''), 'That listing has been taken down.');
  assert.equal(reportContentProblem(westie, 'build_update', target({ kind: 'build_update', gone: true }), ''), 'That update has been taken down.');
  assert.equal(reportContentProblem(westie, 'nomination', target({ kind: 'nomination', gone: true }), ''), 'That nomination has been withdrawn.');
  assert.equal(reportContentProblem(westie, 'mechanic', target({ kind: 'mechanic', gone: true }), ''), 'That workshop is off the list.');
  assert.equal(reportContentProblem(westie, 'profile', target({ kind: 'profile', gone: true }), ''), 'They’re not an approved member.');
  assert.equal(reportContentProblem(seller, 'listing', target(), ''), 'You can’t report your own listing.');
  assert.equal(reportContentProblem(seller, 'profile', target({ kind: 'profile' }), ''), 'You can’t report your own profile.');
  assert.equal(reportContentProblem(westie, 'listing', target(), 'x'.repeat(501)), 'Keep the reason under 500 characters.');
  // An emoji is one character, as the database counts it.
  assert.equal(reportContentProblem(westie, 'listing', target(), '🏍️'.repeat(200)), null);
});

const report = (over: Partial<ContentReport> = {}): ContentReport => ({
  id: 'cr1', kind: 'listing', targetId: 'l1', authorId: 'seller', reporterId: 'westie', reason: null, snapshot: 'Panniers',
  createdAt: '2026-10-31T00:00:00.000Z', resolvedAt: null, resolvedBy: null, outcome: null, ...over,
});

test('any board member or the NEC deals with reports on posts; a profile goes to that member’s chapter board', () => {
  assert.equal(canActOnContentReport(secretary, report(), seller, positions), true);
  assert.equal(canActOnContentReport(northPres, report(), seller, positions), true);
  assert.equal(canActOnContentReport(westie, report(), seller, positions), false);
  const profile = report({ kind: 'profile', targetId: 'seller' });
  assert.equal(canActOnContentReport(secretary, profile, seller, positions), true);
  assert.equal(canActOnContentReport(northPres, profile, seller, positions), false);
  assert.equal(canActOnContentReport(secretary, profile, undefined, positions), false);
  assert.equal(canActOnContentReport(member('s2', { approval: 'suspended' }), report(), seller, positions), false);
});

test('dealing with a report: the refusals in order', () => {
  assert.equal(resolveContentReportProblem(null, report(), seller, positions), 'Sign in first.');
  assert.equal(resolveContentReportProblem(secretary, undefined, seller, positions), 'No such report.');
  assert.equal(resolveContentReportProblem(westie, report(), seller, positions), 'Only the board can do that.');
  assert.equal(resolveContentReportProblem(northPres, report({ kind: 'profile' }), seller, positions), 'Only that member’s chapter board can do that.');
  assert.equal(resolveContentReportProblem(secretary, report({ resolvedAt: '2026-10-31T01:00:00.000Z' }), seller, positions), 'That report was already dealt with.');
  assert.equal(resolveContentReportProblem(secretary, report(), seller, positions), null);
});

test('what you have reported is hidden from you until the board acts', () => {
  const mine = [{ kind: 'listing' as const, targetId: 'l1' }, { kind: 'message' as const, targetId: 'm9' }];
  assert.deepEqual(withoutReported([{ id: 'l1' }, { id: 'l2' }], 'listing', mine), [{ id: 'l2' }]);
  assert.deepEqual(withoutReported([{ id: 'l1' }], 'build_update', mine), [{ id: 'l1' }]);
  assert.equal(reportedByMe('message', 'm9', mine), true);
  assert.equal(reportedByMe('message', 'm1', mine), false);
});
