// A role chip shows the words it's given (an acting seat spells itself out: ACTING TREASURER (NORTH)),
// else the role's short form. Callers pass chipLabel(position, chapters) from domain/home.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const src = fs.readFileSync(path.resolve(import.meta.dirname, 'primitives.tsx'), 'utf8');
const fn = (name: string) => {
  const at = src.indexOf(`export function ${name}(`);
  return src.slice(at, src.indexOf('\n}\n', at));
};

test('RoleChip takes an optional label and shows it in place of the short form', () => {
  const chip = fn('RoleChip');
  assert.match(chip, /\{\s*role,\s*label,\s*accessibilityLabel\s*\}:\s*\{\s*role:\s*PositionRole;\s*label\?:\s*string;\s*accessibilityLabel\?:\s*string\s*\}/);
  assert.match(chip, /<Chip label=\{label \?\? ROLE_SHORT\[role\]\} tone="bone"/);
});

test('RoleChip and Chip pass a spoken label through, so TREAS (WEST) is read as Treasurer (West)', () => {
  const role = fn('RoleChip');
  assert.match(role, /accessibilityLabel\?: string/);
  assert.match(role, /<Chip label=\{label \?\? ROLE_SHORT\[role\]\} tone="bone" accessibilityLabel=\{accessibilityLabel\} \/>/);
  const chip = fn('Chip');
  assert.match(chip, /accessibilityLabel\?: string/);
  assert.match(chip, /accessible=\{accessibilityLabel != null\}/, 'read as one piece only when it has its own words');
  assert.match(chip, /accessibilityLabel=\{accessibilityLabel\}/);
});
