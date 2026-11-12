// Irreversible actions say what will happen before the second tap, and Approve says what it does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');

test('declining an applicant says who is told and that it cannot be undone', () => {
  const board = read('board.tsx');
  const at = board.indexOf('label="Decline"');
  assert.match(board.slice(at, at + 500), /confirmNote=\{`Declining tells[\s\S]*?can’t be undone/);
});

test('approving says what it does, under the vote', () => {
  assert.match(read('board.tsx'), /Approving lets them in as \$\{STATUS_LABEL\[status\]\}/);
});

test('removing a bike or a contact says it cannot be undone', () => {
  const me = read('me.tsx');
  for (const label of ['Remove this bike', 'Remove this contact']) {
    const at = me.indexOf(`label="${label}"`);
    assert.match(me.slice(at, at + 400), /confirmNote="[^"]*can’t be undone/, label);
  }
});
