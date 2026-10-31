#!/usr/bin/env node
// Prints an Edge Function as one file for the Supabase dashboard editor (how Jeff deploys): each
// `import ... from '../_shared/<name>.ts'` line in the entry, and each `import ... from './<name>.ts'`
// line inside a shared module, is replaced by that module's source, exports and all. A module used
// twice goes in once. Imports from npm: and https: are left as they are.
//   node scripts/bundle-function.mjs purge-files > /path/to/purge-files-index.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/bundle-function.mjs <function-slug>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');
const seen = new Set();

function inline(name) {
  if (seen.has(name)) return '';
  seen.add(name);
  const source = withShared(readFileSync(join(root, '_shared', `${name}.ts`), 'utf8')).trimEnd();
  return `// ---- from supabase/functions/_shared/${name}.ts (pasted in so the dashboard editor needs one file) ----\n${source}\n// ---- end of _shared/${name}.ts ----\n`;
}

function withShared(code) {
  return code.replace(/^import [^;]*?from '(?:\.\.\/_shared|\.)\/([\w-]+)\.ts';\n/gm, (_line, name) => inline(name));
}

process.stdout.write(withShared(readFileSync(join(root, slug, 'index.ts'), 'utf8')));
