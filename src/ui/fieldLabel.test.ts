// Every text box carries its visible label as its accessible name, so a screen reader announces
// "Full name, edit text" and not just "edit text" (the review found 22 unnamed boxes on Ask to join).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = fs.readFileSync(path.resolve(import.meta.dirname, 'primitives.tsx'), 'utf8');
const start = source.indexOf('export function Field(');
const field = source.slice(start, source.indexOf('\nexport function Toggle', start));

test('Field names its text box with its label, before caller props so a caller can override it', () => {
  const nameAt = field.indexOf('accessibilityLabel={label}');
  const spreadAt = field.indexOf('{...input}');
  assert.ok(nameAt > -1, 'TextInput has accessibilityLabel={label}');
  assert.ok(nameAt < spreadAt, 'the label comes before {...input}');
});

const toggleAt = source.indexOf('export function Toggle(');
const toggle = source.slice(toggleAt, source.indexOf('\nexport function Choices', toggleAt));

test('Toggle names its switch with its label', () => {
  assert.match(toggle, /<Switch[\s\S]*accessibilityLabel=\{label\}/);
});
