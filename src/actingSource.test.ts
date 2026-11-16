// Every "is this row open?" read goes through the readings in src/domain/acting.ts (held, duties,
// club-wide, or openRows for writers), so no screen or rule forgets that a lapsed or covered row
// has no power. access.ts is the other place allowed to look at endedOn itself.
// No line is excused: the "acting: pending" markers that held known sites until Task 23 are gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = __dirname;
const ALLOWED = new Set(['domain/acting.ts', 'domain/access.ts']);
const MARKER = /\/\/ acting: pending/;
const INLINE: RegExp[] = [/\.endedOn\s*(===|==|!==|!=)\s*null/, /!\s*[\w.]*\.endedOn\b/, /endedOn\s*\?\?/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name) || /\.testkit\.tsx?$/.test(e.name)) return [];
    return [path];
  });
}

/** The lines an inline open-row check sits on, as `file:line`. */
function inlineChecks(files: string[]): string[] {
  return files.flatMap((path) => {
    const file = relative(SRC, path).split('\\').join('/');
    if (ALLOWED.has(file)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, i) => (flagged(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
  });
}

/** Whether a line holds an inline open-row check. */
function flagged(line: string): boolean {
  return INLINE.some((r) => r.test(line));
}

test('the patterns catch every inline open-row form, and not an assignment', () => {
  for (const line of [
    'positions.filter((p) => p.endedOn === null)',
    'p.endedOn == null',
    'if (position.endedOn !== null) return',
    'p.endedOn != null',
    'rows.some((p) => !p.endedOn)',
    '!!seat.endedOn',
    'addMonths(p.startedOn, 24) <= (p.endedOn ?? today)',
  ]) {
    assert.ok(flagged(line), line);
  }
  assert.ok(!flagged("{ id, startedOn: today, endedOn: null }"), 'writing a new open row is fine');
  assert.ok(!flagged('{ ...p, endedOn: ctx.today }'));
  assert.ok(flagged('positions.filter((p) => p.endedOn === null) // acting: pending'), 'a marker no longer excuses a line');
});

test('no inline open-row checks outside acting.ts and access.ts', () => {
  const files = sourceFiles(SRC);
  assert.ok(files.some((f) => f.endsWith('board.tsx')), 'the scan reaches the screens');
  assert.deepEqual(inlineChecks(files), []);
});

test('no "acting: pending" markers remain', () => {
  const marked = sourceFiles(SRC).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, i) => (MARKER.test(line) ? [`${relative(SRC, path).split('\\').join('/')}:${i + 1}`] : [])),
  );
  assert.deepEqual(marked, []);
});
