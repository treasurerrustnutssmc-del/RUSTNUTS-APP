// The Rides tab's line under the colour filters says which way the colours differ from the
// member's usual set, using the colourNote rule, and keeps the Show my usual button.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const rides = fs.readFileSync(path.resolve(import.meta.dirname, 'rides.tsx'), 'utf8');

test('the Rides colour line follows colourNote and keeps Show my usual', () => {
  assert.match(rides, /colourNote\(categories, defaultCategories\(me, data\.chapters\)\)/);
  assert.ok(rides.includes('Some of your usual ride colours are hidden.'));
  assert.ok(rides.includes('Showing more than your usual ride colours.'));
  assert.ok(!rides.includes('Some ride colours are hidden.'), 'the old line is gone');
  assert.equal((rides.match(/label="Show my usual"/g) || []).length, 1);
});
