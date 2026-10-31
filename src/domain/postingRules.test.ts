import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGREE_FIRST,
  bioProblem,
  hasAgreedPostingRules,
  needsPostingRules,
  POSTING_RULES_SECTIONS,
  postingRulesProblem,
  postingRulesUpdatedLine,
} from './postingRules';
import type { Member } from './types';

const member = (over: Partial<Member> = {}): Member => ({
  id: 'm', chapterId: 'ch-west', fullName: 'Mick', roadName: null, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, postingRulesAcceptedOn: '2026-10-31', ...over,
});

test('the rules say the things App Review looks for', () => {
  const text = JSON.stringify(POSTING_RULES_SECTIONS);
  assert.ok(text.includes('no tolerance'), 'no tolerance');
  assert.ok(text.includes('abusive members'), 'abusive members');
  assert.ok(text.includes('24 hours'), '24 hours');
  assert.ok(text.includes('Report'), 'reporting');
  assert.ok(text.includes('block'), 'blocking');
  assert.ok(text.includes('apps@rustnutssmc.com.au'), 'contact');
});

test('a member who has agreed can post; one who has not is told to agree first', () => {
  assert.equal(postingRulesProblem(member()), null);
  assert.equal(postingRulesProblem(member({ postingRulesAcceptedOn: null })), AGREE_FIRST);
  // Older fixtures leave the field out: that counts as agreed, so nothing else changes.
  assert.equal(postingRulesProblem(member({ postingRulesAcceptedOn: undefined })), null);
  assert.equal(hasAgreedPostingRules(null), true);
});

test('only approved members who are not Family are shown the rules first', () => {
  assert.equal(needsPostingRules(member({ postingRulesAcceptedOn: null })), true);
  assert.equal(needsPostingRules(member({ postingRulesAcceptedOn: null, status: 'introduced' })), true);
  assert.equal(needsPostingRules(member()), false);
  assert.equal(needsPostingRules(member({ postingRulesAcceptedOn: null, status: 'family' })), false);
  assert.equal(needsPostingRules(member({ postingRulesAcceptedOn: null, approval: 'pending' })), false);
  assert.equal(needsPostingRules(member({ postingRulesAcceptedOn: null, approval: 'suspended' })), false);
  assert.equal(needsPostingRules(null), false);
});

test('a bio needs the rules agreed; a blank one does not', () => {
  const notYet = member({ postingRulesAcceptedOn: null });
  assert.equal(bioProblem(notYet, 'Tail Gunner'), AGREE_FIRST);
  assert.equal(bioProblem(notYet, '  '), null);
  assert.equal(bioProblem(notYet, null), null);
  assert.equal(bioProblem(member(), 'Tail Gunner'), null);
});

test('the updated line shows the date as DD/MM/YYYY', () => {
  assert.equal(postingRulesUpdatedLine('2026-10-31'), 'Last updated 31/10/2026');
});
