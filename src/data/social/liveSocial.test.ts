import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBirthdays } from './liveSocial';

test('birthday rows: taken-off ones are left out', () => {
  assert.deepEqual(
    toBirthdays([
      { member_id: 'a', month: 3, day: 7 },
      { member_id: 'b', month: null, day: null },
    ]),
    [{ memberId: 'a', month: 3, day: 7 }],
  );
});
