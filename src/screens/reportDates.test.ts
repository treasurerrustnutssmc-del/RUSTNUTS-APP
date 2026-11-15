// A stamp (recordedAt, approvedAt, presentedAt) is an instant. Its first ten characters are the
// UTC date, which on a Melbourne morning is the day before, so the report screens show the
// Melbourne date of a stamp instead. Any first-ten-characters cut in these files is flagged,
// however the stamp got there, except the one in treasury.tsx's addMonths: that one cuts a date
// it built itself at UTC midnight, so its UTC date is the calendar date it means.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

const ADD_MONTHS = /function addMonths\(month: string, n: number\): string \{\n\s*const \[y, m\] = month\.split\('-'\)\.map\(Number\);\n\s*const d = new Date\(Date\.UTC\(y, m - 1 \+ n, 1\)\);\n\s*return d\.toISOString\(\)\.slice\(0, 10\);\n\}/;
const UTC_DATE = /\.(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|\.split\(\s*['"`]T['"`]\s*\)/;

test('the one allowed cut is addMonths, on a date it built at UTC midnight', () => {
  assert.match(read('treasury.tsx'), ADD_MONTHS);
});

for (const file of ['treasury.tsx', 'meetingReport.tsx']) {
  test(`${file} never reads a stamp's UTC date`, () => {
    const lines = read(file).replace(ADD_MONTHS, '').split('\n');
    const cuts = lines.filter((l) => UTC_DATE.test(l)).map((l) => l.trim());
    assert.deepEqual(cuts, []);
  });
}

test('the meeting report PDF is dated on the Melbourne day it was presented', () => {
  assert.match(read('meetingReport.tsx'), /preparedOn: report\?\.presentedAt \? melbourneDate\(report\.presentedAt\) : today/);
});
