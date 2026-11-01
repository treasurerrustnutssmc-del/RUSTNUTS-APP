// Every Edge Function, bundled as the one file Jeff pastes into the dashboard, must parse: shared
// modules pasted into one file can't each declare the same top-level name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const root = join(__dirname, '..', '..');
const functions = readdirSync(join(root, 'supabase', 'functions')).filter(
  (d) => !d.startsWith('_') && existsSync(join(root, 'supabase', 'functions', d, 'index.ts')),
);

for (const slug of functions) {
  test(`the one-file ${slug} has no top-level name declared twice`, () => {
    const code = execFileSync('node', [join(root, 'scripts', 'bundle-function.mjs'), slug], { encoding: 'utf8' });
    const file = ts.createSourceFile(`${slug}.ts`, code, ts.ScriptTarget.Latest, true);
    const seen = new Map<string, number>();
    for (const s of file.statements) {
      const names: string[] = [];
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
      } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) {
        names.push(s.name.text);
      }
      for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    const twice = [...seen].filter(([, n]) => n > 1).map(([name]) => name);
    assert.deepEqual(twice, [], `declared more than once in the ${slug} bundle`);
  });
}
