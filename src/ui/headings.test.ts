// Headings are real headings for screen readers: a screen reader user moves by heading, and a screen with
// none gives them nothing to move by. The page title is level 1 where the navigation bar shows no title
// (Welcome, Sign in, Ask to join, the waiting screen, the rules gate, Home); otherwise it is level 2 under the bar's own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');
const fn = (src: string, name: string) => {
  const at = src.indexOf(`export function ${name}(`);
  return src.slice(at, src.indexOf('\n}\n', at));
};

test('Display, H1 and H2 are headings, with levels', () => {
  const p = read('primitives.tsx');
  assert.match(fn(p, 'Display'), /accessibilityRole="header"[\s\S]*aria-level=\{1\}/);
  assert.match(fn(p, 'H1'), /accessibilityRole="header"[\s\S]*aria-level=\{level\}/);
  assert.match(fn(p, 'H1'), /level = 2/);
  assert.match(fn(p, 'H2'), /accessibilityRole="header"[\s\S]*aria-level=\{3\}/);
});

test('the screens with no title in the navigation bar make their own title level 1', () => {
  const pub = read('../screens/public.tsx');
  assert.match(pub, /<H1 level=\{1\}>\{joining \? 'First, your email' : 'Sign in'\}<\/H1>/);
  assert.match(pub, /<H1 level=\{1\}>Ask to join<\/H1>/);
  assert.match(pub, /<H1 level=\{1\}>Thanks, /);
  assert.match(read('../screens/postingRules.tsx'), /<H1 level=\{1\}>\{POSTING_RULES_TITLE\}<\/H1>/);
});

test('the Home greeting is the Home page heading', () => {
  const m = read('../screens/members.tsx');
  const at = m.indexOf('G’day, {displayName(me)}');
  assert.match(m.slice(at - 400, at), /accessibilityRole="header"[\s\S]*aria-level=\{1\}/);
});
