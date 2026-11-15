// The Rides tab's line under the colour filters says which way the colours differ from the
// member's usual set. colourNote picks the note and COLOUR_NOTE_TEXT holds its sentence (both
// tested in src/domain/savedFilters.test.ts). This pins the screen to them: the line and the
// Show my usual button show for either note, and the sentence is the one for that note.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const rides = fs.readFileSync(path.resolve(import.meta.dirname, 'rides.tsx'), 'utf8');

test('the Rides colour line follows colourNote and keeps Show my usual', () => {
  assert.match(rides, /const note = colourNote\(categories, defaultCategories\(me, data\.chapters\)\);/);
  const start = rides.indexOf('{note ? (');
  assert.ok(start > 0, 'the line shows whenever there is a note, hidden or extra');
  const block = rides.slice(start, rides.indexOf(') : null}', start));
  assert.match(block, /<Small style=\{\{ flex: 1 \}\}>\{COLOUR_NOTE_TEXT\[note\]\}<\/Small>/, 'the sentence is the one for this note');
  assert.match(block, /label="Show my usual"/, 'the button shows for either note');
  assert.ok(!/ride colours are hidden|than your usual ride colours/.test(rides), 'no sentence typed into the screen');
  assert.equal((rides.match(/label="Show my usual"/g) || []).length, 1);
});
