// The 5.5 gate on moving someone down to Supporter, Legacy or FNG, and the record every status change
// leaves (the launch audit's L2, widened by the deep audit's F2). Who may do it is checked against the
// database by the shared parity cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { club, member, who } from '../domain/stage4.testkit';
import { DOWNWARD_NEEDS_NOTICE } from '../domain/access';
import type { ClubData, StatusNotice } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { setStatus, type DemoCtx } from './demoActions';

const today = '2026-10-24';
const now = '2026-10-24T01:00:00.000Z';
const notice = (over: Partial<StatusNotice> = {}): StatusNotice => ({
  id: 'n-rider', memberId: 'rider', chapterId: 'west', about: 'attendance', record: 'Missed the year', proposal: 'Supporter',
  givenOn: '2026-09-20', respondBy: '2026-10-04', givenBy: 'sec', response: '', respondedAt: null, outcome: 'decided', outcomeNote: '',
  closedOn: '2026-10-10', closedBy: 'sec', ...over,
});
const base = club({ members: [...club().members, member('nomad', { status: 'nomad' })] });
const ctx = (id: string, data: ClubData = base): DemoCtx => ({ data, me: who(data, id), today, now });
const changes = (data: ClubData) => data.statusChanges ?? [];

test('a Full Member, FNG or Nomad moves down to Supporter, Legacy or FNG after a decided 5.5 notice, or at their own request', () => {
  assert.throws(() => setStatus(ctx('sec'), 'rider', 'supporter'), (e: unknown) => e instanceof NotAllowedError && e.message === DOWNWARD_NEEDS_NOTICE);
  assert.throws(() => setStatus(ctx('sec'), 'rider', 'legacy'), (e: unknown) => e instanceof NotAllowedError && e.message === DOWNWARD_NEEDS_NOTICE);
  assert.throws(() => setStatus(ctx('sec'), 'rider', 'fng'), (e: unknown) => e instanceof NotAllowedError && e.message === DOWNWARD_NEEDS_NOTICE);
  assert.throws(() => setStatus(ctx('sec'), 'fng', 'legacy'), NotAllowedError);
  assert.equal(who(setStatus(ctx('sec'), 'fng', 'legacy', true), 'fng').status, 'legacy', 'Legacy at their request');
  assert.throws(() => setStatus(ctx('sec'), 'fng', 'supporter'), NotAllowedError);
  assert.throws(() => setStatus(ctx('sec'), 'nomad', 'supporter'), NotAllowedError);
  const asked = setStatus(ctx('sec'), 'rider', 'supporter', true);
  assert.equal(who(asked, 'rider').status, 'supporter');
  assert.deepEqual(changes(asked), [{
    id: changes(asked)[0].id, memberId: 'rider', chapterId: 'west', fromStatus: 'full', toStatus: 'supporter', byRequest: true,
    noticeId: null, changedBy: 'sec', changedOn: today, changedAt: now,
  }]);
  const noticed = { ...base, statusNotices: [notice()] };
  const moved = setStatus(ctx('sec', noticed), 'rider', 'supporter');
  assert.equal(changes(moved)[0].noticeId, 'n-rider', 'the notice is on the record');
  assert.equal(changes(moved)[0].byRequest, false);
  const stale = { ...base, statusNotices: [notice({ closedOn: '2026-07-01' })] };
  assert.throws(() => setStatus(ctx('sec', stale), 'rider', 'supporter'), NotAllowedError, 'a notice decided over 90 days ago is stale');
  const open = { ...base, statusNotices: [notice({ outcome: null, closedOn: null, closedBy: null })] };
  assert.throws(() => setStatus(ctx('sec', open), 'rider', 'supporter'), NotAllowedError, 'an open notice isn’t decided');
});

test('every other status change is recorded too, without a notice or a request', () => {
  const data = setStatus(ctx('sec'), 'rider', 'nomad'); // sideways, so not gated
  assert.equal(changes(data).length, 1);
  assert.equal(changes(data)[0].fromStatus, 'full');
  assert.equal(changes(data)[0].toStatus, 'nomad');
  assert.equal(changes(data)[0].byRequest, false);
  assert.equal(changes(data)[0].noticeId, null);
  const twice = setStatus(ctx('sec', data), 'rider', 'supporter', true);
  assert.equal(changes(twice).length, 2, 'the record grows');
});

test('a move that isn’t gated records no notice, even when one was decided', () => {
  const withFamily: ClubData = {
    ...base, members: [...base.members, member('fam', { status: 'family' })], statusNotices: [notice({ id: 'n-fam', memberId: 'fam' })],
  };
  const moved = setStatus(ctx('sec', withFamily), 'fam', 'supporter');
  assert.equal(who(moved, 'fam').status, 'supporter');
  assert.equal(changes(moved)[0].noticeId, null, 'Family to Supporter isn’t a 5.5 move, so the notice isn’t on the record');
  assert.equal(changes(moved)[0].byRequest, false);
});
