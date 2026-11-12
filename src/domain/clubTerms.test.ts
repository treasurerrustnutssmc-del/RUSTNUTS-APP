// The club's own terms (confirmed by Chris, 12/11/2026): a Full member is what the app used to
// call "Full patch" and "Patched". "Patched" stays only for the act ("patched on 25/03/2023").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STATUS_LABEL } from './labels';
import { memberGroups } from './memberGroups';
import type { Member } from './types';

const member = (status: Member['status']): Member => ({
  id: `m-${status}`, chapterId: 'ch-west', fullName: `Test ${status}`, roadName: null, status, approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false,
});

test('a Full member is called a Full member everywhere', () => {
  assert.equal(STATUS_LABEL.full, 'Full member');
});

test('the member list groups them under Full members', () => {
  const groups = memberGroups([member('full'), member('nomad'), member('introduced')]);
  assert.deepEqual(groups.map((g) => g.title), ['Full members', 'Nomads', 'Hang Arounds']);
});

import { STATUS_LABEL as SHOP_STATUS } from './shop';

test('shop order states read in plain words, not as insider shorthand', () => {
  assert.equal(SHOP_STATUS.held, 'Waiting to send');
  assert.equal(SHOP_STATUS.sent, 'Sent to the shop');
});
