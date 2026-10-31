import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRON_HEADER, cronCallAllowed } from '../../supabase/functions/_shared/cronAuth';

test('with no secret set every call is allowed; with one set the header must match it exactly', () => {
  assert.equal(CRON_HEADER, 'x-cron-secret');
  assert.equal(cronCallAllowed(null, undefined), true);
  assert.equal(cronCallAllowed(null, ''), true);
  assert.equal(cronCallAllowed('anything', undefined), true);
  assert.equal(cronCallAllowed(null, 'shh'), false);
  assert.equal(cronCallAllowed(undefined, 'shh'), false);
  assert.equal(cronCallAllowed('', 'shh'), false);
  assert.equal(cronCallAllowed('sh', 'shh'), false);
  assert.equal(cronCallAllowed('shh ', 'shh'), false);
  assert.equal(cronCallAllowed('SHH', 'shh'), false);
  assert.equal(cronCallAllowed('shh', 'shh'), true);
});
