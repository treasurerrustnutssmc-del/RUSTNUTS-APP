import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The web version of the app for members whose phone can't get the app yet (iPhone members while
// Apple reviews the TestFlight beta, 20 Nov 2026). Built fresh by the Pages workflow on every push.
const root = join(__dirname, '..');
const pages = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
const scriptPath = join(root, 'scripts/web-preview.sh');
const SLUG = 'ride-68e58a114b';

test('the Pages workflow builds the web version at its unlisted address, and the static pages still publish if it fails', () => {
  assert.match(pages, new RegExp(`- run: scripts/web-preview\\.sh ${SLUG}\\s*\\n\\s*continue-on-error: true`));
  assert.match(pages, /- uses: actions\/setup-node@v4\s*\n\s*continue-on-error: true/);
  assert.match(pages, /- run: npm ci\s*\n\s*continue-on-error: true/);
  const build = pages.indexOf('scripts/web-preview.sh');
  const upload = pages.indexOf('actions/upload-pages-artifact');
  assert.ok(build > 0 && build < upload, 'built before site/ is uploaded');
});

test('the web version talks to the live club database, stays out of search engines and opens full screen from the home screen', () => {
  assert.ok(existsSync(scriptPath));
  const script = readFileSync(scriptPath, 'utf8');
  assert.match(script, /EXPO_PUBLIC_SUPABASE_URL=https:\/\/mfhbvsybudneimgbfjpy\.supabase\.co/);
  assert.match(script, /noindex,nofollow/);
  assert.match(script, /apple-mobile-web-app-capable/);
  assert.match(script, /BASE="\/RUSTNUTS-APP\/\$SLUG"/);
  assert.match(script, /\^\[a-z0-9-\]\+\$/, 'the slug is checked before anything is removed');
  assert.match(script, /mv "\$OUT" "site\/\$SLUG"/, 'a half-built app is never published');
});

test('a local build of the web version is never committed', () => {
  const ignore = readFileSync(join(root, 'site/.gitignore'), 'utf8');
  assert.match(ignore, /^\/ride-\*\/$/m);
});
