// A form's error summary sits at the top, where the person is looking, and the form scrolls to it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');

test('the profile, bike and contact forms show a save error directly under the leave prompt, and scroll to it', () => {
  const me = read('me.tsx');
  const count = (me.match(/\{guard\.prompt\}\n\s*\{error \? <Notice tone="danger">\{error\}<\/Notice> : null\}/g) || []).length;
  assert.equal(count, 3, 'three forms put the error at the top');
  assert.equal((me.match(/scrollToTopKey=\{`\$\{guard\.held\}\|\$\{error \?\? ''\}`\}/g) || []).length, 3, 'and scroll up when it appears');
});

test('Ask to join shows "A few things to fix" above the fields', () => {
  const pub = read('public.tsx');
  const join = pub.slice(pub.indexOf('export function JoinScreen'), pub.indexOf('export function PendingScreen'));
  assert.ok(join.indexOf('A few things to fix') < join.indexOf('{step === 0 ? ('), 'summary comes before the step fields');
});
