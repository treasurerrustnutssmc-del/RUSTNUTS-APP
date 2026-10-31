import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEWER_CODE, REVIEWER_EMAIL, isReviewerCode, isReviewerEmail } from './reviewer';

test('the review email is recognised however it is typed', () => {
  assert.equal(isReviewerEmail(REVIEWER_EMAIL), true);
  assert.equal(isReviewerEmail('  Review@RustnutsSMC.com.au '), true);
});

test('other emails, look-alikes included, sign in as normal', () => {
  assert.equal(isReviewerEmail('jeff@example.com'), false);
  assert.equal(isReviewerEmail('review@rustnutssmc.com'), false);
  assert.equal(isReviewerEmail('xreview@rustnutssmc.com.au'), false);
  assert.equal(isReviewerEmail('review@rustnutssmc.com.au.evil.com'), false);
  assert.equal(isReviewerEmail(''), false);
});

test('only the review code opens the review demo', () => {
  assert.equal(isReviewerCode(REVIEWER_CODE), true);
  assert.equal(isReviewerCode(` ${REVIEWER_CODE.slice(0, 3)} ${REVIEWER_CODE.slice(3)} `), true);
  assert.equal(isReviewerCode('000000'), false);
  assert.equal(isReviewerCode(''), false);
});
