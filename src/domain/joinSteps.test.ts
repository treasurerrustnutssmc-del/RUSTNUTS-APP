import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JOIN_FIELDS, JOIN_STEPS, shownError, stepProblems } from './joinSteps';

test('every field of the form belongs to exactly one step', () => {
  const inSteps = JOIN_STEPS.flatMap((s) => s.fields);
  assert.deepEqual([...inSteps].sort(), [...JOIN_FIELDS].sort());
  assert.equal(new Set(inSteps).size, inSteps.length);
});

test('there are three short steps, named in plain words', () => {
  assert.deepEqual(JOIN_STEPS.map((s) => s.title), ['About you', 'How you’re joining', 'Your bike']);
});

test('a step is blocked only by problems in its own fields', () => {
  const errors = { fullName: 'Add your full name.', email: null, phone: null, adult: null, chapter: 'Pick the chapter you ride with.', bikeParts: null, year: null };
  assert.deepEqual(stepProblems(errors, 0), ['fullName']);
  assert.deepEqual(stepProblems(errors, 1), ['chapter']);
  assert.deepEqual(stepProblems(errors, 2), []);
});

test('an error shows once the person has left the field or tried to move on, not while they first type', () => {
  assert.equal(shownError('Add your full name.', false), null);
  assert.equal(shownError('Add your full name.', true), 'Add your full name.');
  assert.equal(shownError(null, true), null);
});
