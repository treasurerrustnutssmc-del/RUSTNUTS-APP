import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasChanges } from './dirty';

test('nothing typed means nothing to lose', () => {
  assert.equal(hasChanges({ name: 'Dave', phone: '0400' }, { name: 'Dave', phone: '0400' }), false);
});

test('any changed field counts', () => {
  assert.equal(hasChanges({ name: 'Dave', phone: '0400' }, { name: 'Dave', phone: '0411' }), true);
});

test('empty, missing and blank are the same, and trailing spaces do not count', () => {
  assert.equal(hasChanges({ a: null, b: undefined, c: '' }, { a: '', b: '  ', c: null }), false);
  assert.equal(hasChanges({ a: 'x' }, { a: 'x ' }), false);
});

test('switches and numbers compare as they are', () => {
  assert.equal(hasChanges({ project: false }, { project: true }), true);
  assert.equal(hasChanges({ year: 2019 }, { year: 2019 }), false);
});
