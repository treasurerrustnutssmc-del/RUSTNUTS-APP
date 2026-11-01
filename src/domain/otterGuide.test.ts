import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OTTER_GUIDE } from './otterGuide';

const screens = ['otterMinutes.tsx', 'business.tsx'].map((f) => readFileSync(join(__dirname, '..', 'screens', f), 'utf8')).join('\n');
const guide = OTTER_GUIDE.flatMap((s) => [s.title, ...s.items, s.note ?? '']).join('\n');

test('the guide covers recording, exporting, the app, checking and the limits', () => {
  assert.deepEqual(
    OTTER_GUIDE.map((s) => s.title),
    ['At the meeting', 'Get the transcript out of Otter', 'In the app', 'Check the draft before you save', 'Limits and privacy', 'If you see a message instead'],
  );
  for (const s of OTTER_GUIDE) assert.ok(s.items.length > 0, s.title);
});

test('every button the guide tells the secretary to tap is a real label on the screens', () => {
  const buttons = ['Draft from Otter', 'Pick the file', 'Draft the minutes', 'Use this draft', 'Replace the draft minutes', 'Check these', 'Who was there', 'Action items', 'Start again'];
  for (const label of buttons) {
    assert.ok(guide.includes(`“${label}”`), `the guide doesn’t name “${label}”`);
    assert.ok(screens.includes(`'${label}'`) || screens.includes(`"${label}"`), `“${label}” isn’t on the screens`);
  }
});
