// The Board tab and "Attendance and terms" for acting (docs/superpowers/specs/2026-11-15-acting-roles-design.md,
// "Screens"): the scope sentence, open requests with their one next step and Withdraw or Decline, the
// 11.2 line with its button, and stints listed apart from terms. The words and rules are tested in
// src/domain/boardLayout.test.ts; this pins that the screens draw from them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
const slice = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `${from} … ${to}`);
  return src.slice(start, end);
};
const board = read('board.tsx');
const boardTab = slice(board, 'export function BoardScreen', '\n// ---');
const attendance = slice(read('attendance.tsx'), 'export function BoardAttendance', '\n// ---');

test('the scope sentence comes from scopeText, with no "act for" or "Acting is" left on a club-wide Board tab', () => {
  assert.match(boardTab, /scopeText\(me, data\)/);
  assert.ok(!board.includes('You act for'), 'the board you sit on, not one you act for');
  assert.ok(!board.includes('Acting is each chapter board’s'));
});

test('open requests show with their next step, and the confirm and withdraw buttons follow the rules', () => {
  assert.match(boardTab, /boardRequests\(me, data, /);
  const card = slice(board, '\nfunction BoardRequest', '\nfunction ');
  assert.match(card, /requestLine\(request, data\)/);
  assert.match(card, /requestNext\(request, me, data, /);
  assert.match(card, /requestActions\(request, me, data, today\)/);
  assert.match(card, /confirmActing\(request\.id\)/);
  assert.match(card, /withdrawActingRequest\(request\.id\)/);
  assert.match(card, /<ConfirmButton[\s\S]*label=\{next\.label\}/, 'Confirm cover and Confirm acting are ConfirmButtons');
});

test('the 11.2 line and Make Jet Acting President, recorded through appointActing', () => {
  assert.match(boardTab, /vpFallbackLine\(/);
  const fallback = slice(board, '\nfunction VpFallback', '\n// ---');
  assert.match(fallback, /appointActing\(/);
  assert.match(fallback, /appointActingProblem\(/, 'the form checks the date and the why as typed');
});

test('Attendance and terms lists stints apart from terms, in their own words and warning colour', () => {
  assert.match(attendance, /termsDue\(/);
  assert.match(attendance, /stintsDue\(/);
  assert.match(attendance, /stintLine\(/);
  assert.match(attendance, /stintTone\(/);
});
