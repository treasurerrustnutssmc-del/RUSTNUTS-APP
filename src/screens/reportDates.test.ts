// A stamp (recordedAt, approvedAt, presentedAt) is an instant. Its first ten characters are the
// UTC date, which on a Melbourne morning is the day before, so the report screens show the
// Melbourne date of a stamp instead.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

for (const file of ['treasury.tsx', 'meetingReport.tsx']) {
  test(`${file} never reads a stamp's UTC date`, () => {
    const cuts = read(file).match(/\w+At\??\.slice\(0, ?10\)/g) ?? [];
    assert.deepEqual(cuts, []);
  });
}

test('the meeting report PDF is dated on the Melbourne day it was presented', () => {
  assert.match(read('meetingReport.tsx'), /preparedOn: report\?\.presentedAt \? melbourneDate\(report\.presentedAt\) : today/);
});
