// A Disclosure tells assistive tech whether it is open. On the web build the accessibilityState
// prop alone is not passed through, so aria-expanded is set as well (Toggle does the same with aria-checked).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = fs.readFileSync(path.resolve(import.meta.dirname, 'primitives.tsx'), 'utf8');
const at = source.indexOf('export function Disclosure(');
const block = source.slice(at, source.indexOf('\n}\n', at));

test('Disclosure exposes expanded and collapsed to screen readers on native and web', () => {
  assert.match(block, /accessibilityState=\{\{ expanded: open \}\}/);
  assert.match(block, /aria-expanded=\{open\}/);
});
