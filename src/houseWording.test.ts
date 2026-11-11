// House wording: one name per thing, curly apostrophes, no build notes or admin messages shown to
// members. These came out of the 12/11/2026 usability and wording review. Each rule scans the app's
// own source (comments removed) so a banned phrase can't creep back in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '.');
// The club's own Road Rules text keeps its wording (it is a signed document), so it is not scanned.
const SKIP = new Set(['roadRulesGuide.ts', 'demoConstitution.ts']);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/testkit/.test(name) && !SKIP.has(name)) out.push(full);
  }
  return out;
}

/** The source with // and block comments removed, so only code and visible strings are left. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;,({])\/\/.*$/gm, '$1');
}

const FILES = sources(ROOT).map((f) => ({ file: path.relative(ROOT, f).split(path.sep).join('/'), text: withoutComments(fs.readFileSync(f, 'utf8')) }));

function hits(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const { file, text } of FILES) {
    text.split('\n').forEach((line, i) => {
      if (pattern.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  return found;
}

const RULES: [string, RegExp][] = [
  ['Screens about the chat rules are titled "Chat and posting rules", not "Club rules"', /title: 'Club rules'/],
  ['Say "Feedback and issues", not "Feedback & issues"', /Feedback (&|&amp;) issues/],
  ['Chat conduct rules are "Chat and posting rules", so "rules" is not used for three different things', /Club rules for chats and posts/],
  ['Attendance is "Attendance targets", not "Attendance rules"', /['"`>]Attendance rules/i],
  ['One wording for the profile button: "Edit profile"', /Edit my profile/i],
  ['One wording for missing details: "Not recorded"', /None recorded/],
  ['No admin or build notes shown to members (GIPHY key)', /GIPHY key/],
  ['No build notes shown to members (reminders)', /Reminders work now/],
  ['Say what /buy is: "order in the club Discord with /buy"', /order with \/buy/],
  ['Use a curly apostrophe (I’m joining as)', /I'm joining/i],
  ['Use a curly apostrophe (I’m 18 or over)', /I'm 18/i],
  ['Use a curly apostrophe (don’t have one yet)', /don't have one yet/],
  ['Use a curly apostrophe (They’re your)', /They're your/],
  ['Use a curly apostrophe (You’ll get a reminder)', /You'll get a reminder/],
  ['Use a curly apostrophe (Men’s Referral Service)', /Men's Referral/],
  ['Numbers of 1,000 or more have a comma', /\b1000 characters/],
  ['The create-ride button says "Create ride"', /Make the ride/i],
];

for (const [rule, pattern] of RULES) {
  test(rule, () => {
    assert.deepEqual(hits(pattern), []);
  });
}

test('the club shop says prices are in AUD (it says nothing about GST until the club confirms its GST status)', () => {
  const shop = FILES.find((f) => f.file === 'screens/shop.tsx')!;
  assert.match(shop.text, /All prices are in AUD\./);
  assert.doesNotMatch(shop.text, /GST/);
});
