import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from './friendlyError';

const msg = (error: { message?: string; code?: string }) => friendlyError(error).message;

test('our own database messages are written for members and pass straight through', () => {
  assert.equal(msg({ code: 'P0001', message: 'You can’t appoint yourself.' }), 'You can’t appoint yourself.');
});

test('permission refusals read as not allowed', () => {
  assert.equal(msg({ code: '42501', message: 'new row violates row-level security policy' }), "You're not allowed to do that.");
});

test('raw database rule failures never reach members', () => {
  const check = msg({ code: '23514', message: 'new row for relation "bikes" violates check constraint "bikes_year_check"' });
  assert.doesNotMatch(check, /relation|constraint|bikes_year_check/);
  const missing = msg({ code: '23503', message: 'insert or update on table "positions" violates foreign key constraint' });
  assert.doesNotMatch(missing, /foreign key|positions/);
  const other = msg({ code: 'XX000', message: 'internal error at heap.c:123' });
  assert.doesNotMatch(other, /heap\.c/);
});

test('no signal reads as no connection', () => {
  assert.match(msg({ message: 'TypeError: Failed to fetch' }), /connection/i);
});

test('sign-in problems say what to do', () => {
  assert.match(msg({ code: 'otp_expired', message: 'Token has expired or is invalid' }), /code didn’t work/);
  assert.match(msg({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }), /Wait a minute/);
  assert.match(msg({ code: 'email_address_invalid', message: 'Email address "jeff@" is invalid' }), /email address/i);
});
