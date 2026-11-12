// Small things stay easy to hit: a chat author's name is a 25px line, so its tap area grows to 44+
// with hitSlop. The Welcome page folds its 13 club links into one group so the first screen is calm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');

test('the author name above a chat message has a 44pt tap area', () => {
  const chat = read('chat.tsx');
  const at = chat.indexOf('accessibilityLabel={author && !family');
  const block = chat.slice(at - 400, at + 400);
  assert.match(block, /hitSlop=\{\{ top: 10, bottom: 10 \}\}/);
});

test('the Welcome page folds the club links into one group', () => {
  const pub = read('public.tsx');
  const start = pub.indexOf('export function WelcomeScreen');
  const welcome = pub.slice(start, pub.indexOf('export function SignInScreen'));
  assert.match(welcome, /<Disclosure[^>]*title="Find the club online"/);
});
