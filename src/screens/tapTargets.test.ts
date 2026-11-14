// Small things stay easy to hit: a chat author's name is a 25px line, so its tap area grows to 44+
// with hitSlop. The Welcome page folds its 13 club links into one group so the first screen is calm.
// Home's three answers under Next ride stay one even row, and don't change height while one saves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');

test('the author name above a chat message is itself 44pt tall, not just given a bigger invisible area', () => {
  const chat = read('chat.tsx');
  const at = chat.indexOf('accessibilityLabel={author && !family');
  const block = chat.slice(at - 500, at + 400);
  assert.match(block, /minHeight: 44/);
});

test('a reaction chip under a message is 44pt tall', () => {
  const bits = fs.readFileSync(path.resolve(import.meta.dirname, '../ui/ChatBits.tsx'), 'utf8');
  const at = bits.indexOf('  pill: {');
  assert.match(bits.slice(at, at + 400), /minHeight: 44/);
});

test('the Welcome page folds the club links into one group', () => {
  const pub = read('public.tsx');
  const start = pub.indexOf('export function WelcomeScreen');
  const welcome = pub.slice(start, pub.indexOf('export function SignInScreen'));
  assert.match(welcome, /<Disclosure[^>]*title="Find the club online"/);
});

// The three answer buttons under Next ride on Home, from the opening tag to its close, so a prop written
// above the label is checked too.
const homeAnswers = () => {
  const rides = read('rides.tsx');
  const start = rides.indexOf('export function HomeNextRideCard');
  const card = rides.slice(start, rides.indexOf('export function RideRow'));
  const at = card.indexOf("a === 'no' ? 'Can’t go'");
  assert.ok(at >= 0, 'the Home card keeps its own short label');
  const open = card.lastIndexOf('<Button', at);
  assert.ok(open >= 0, 'the answers are Buttons');
  return { card, button: card.slice(open, card.indexOf('/>', at)) };
};

test('the three one-tap answers under Next ride on Home stay one row of equal buttons', () => {
  // "Can’t go" is the longest of the three. With the full button padding it wrapped to two lines in a
  // third of a phone's width, which left that button taller than Going and Maybe.
  const { button } = homeAnswers();
  // Equal thirds; slim sides give the label room; stretching keeps the three the same height where one
  // still wraps (a narrow phone, or large text).
  assert.match(button, /flex: 1/);
  assert.match(button, /paddingHorizontal: space\.xs/);
  assert.match(button, /alignSelf: 'stretch'/);
  // The answers stay full-size buttons: the 48pt touch target comes from the regular size.
  assert.doesNotMatch(button, /size="small"/);
});

test('saving an answer on Home does not make the row jump', () => {
  // A spinner beside the label takes 28pt, enough to push "Can’t go" onto a second line and stretch all
  // three buttons for the length of the save. The answer being saved shows as chosen instead, the other
  // two dim, and another tap is ignored while the first saves.
  const { card, button } = homeAnswers();
  assert.doesNotMatch(button, /\bbusy=\{/, 'no spinner beside these labels');
  assert.match(button, /kind=\{\(busy \?\? mine\) === a \? 'primary' : 'secondary'\}/);
  assert.match(button, /disabled=\{busy !== null && busy !== a\}/);
  const answer = card.slice(card.indexOf('const answer = async'), card.indexOf('setBusy(a)'));
  assert.match(answer, /if \(saving\.current\) return;\s+saving\.current = true;/, 'another tap is ignored while the first saves');
  assert.match(card, /finally \{\s+saving\.current = false;\s+setBusy\(null\);/, 'the next tap works once the save has finished');
});
