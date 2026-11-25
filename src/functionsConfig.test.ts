// supabase/config.toml states, for every server function, whether Supabase checks the caller's sign-in
// before the function runs. Until 19 Nov 2026 that lived only in each function's opening comment and in
// whichever switch the last deploy used, so a redeploy with the wrong switch would have gone unnoticed
// (18 Nov audit, fix 15). A deploy now reads the setting from the file, and this test keeps the file whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', 'supabase');
const functions = readdirSync(join(root, 'functions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name)
  .sort();

function settings(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  let current: string | null = null;
  for (const raw of readFileSync(join(root, 'config.toml'), 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const section = /^\[functions\.([a-z0-9-]+)\]$/.exec(line);
    if (section) current = section[1];
    else if (line.startsWith('[')) current = null;
    const value = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (value && current) out[current] = value[1] === 'true';
  }
  return out;
}

// No sign-in check by Supabase: the website's door (the website has no sign-in) and the four jobs the
// database calls (the clock, or a website video going up or down), each of which refuses a call without the cron secret.
const OPEN = ['purge-files', 'send-push', 'site-api', 'site-video-copy', 'sync-rides', 'voice-sweep'];

test('config.toml names every server function, and nothing else', () => {
  assert.deepEqual(Object.keys(settings()).sort(), functions);
});

test('only the website door and the clock-run jobs skip the sign-in check', () => {
  const s = settings();
  assert.deepEqual(functions.filter((f) => s[f] === false), OPEN);
});

test('every clock-run job that skips the sign-in check asks for the cron secret itself', () => {
  for (const name of OPEN.filter((f) => f !== 'site-api')) {
    const source = readFileSync(join(root, 'functions', name, 'index.ts'), 'utf8');
    assert.match(source, /cronCallAllowed\(/, `${name} checks the cron secret`);
  }
});
