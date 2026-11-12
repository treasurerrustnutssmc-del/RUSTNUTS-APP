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
  ['Fees: the button says Fees (members pay by bank transfer, not card)', /Pay your fees/],
  ['Say "app team", not "app keepers"', /app keepers/],
  ['Say what is due: licence and rego renewals', /'renewal needs' : 'renewals need'/],
  ['Support is called Support in the club links and on Welcome', /(label: 'Support and resources'|label="Support and resources")/],
  ['The documents rows say Club documents, matching Me', /title="Documents"/],
  ['The Board row for the shop is not just Merch (that is the tab)', /title="Merch"/],
  ['The Merch tab does not repeat its own name as a heading', /<H1>Merch<\/H1>/],
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

test('the Board fees section says Chapter fees, so it is not mistaken for the member Fees on Me', () => {
  const fees = FILES.find((f) => f.file === 'screens/fees.tsx')!;
  assert.match(fees.text, /<SectionTitle title="Chapter fees" \/>/);
});

// Constitution clause numbers like (5.4) stay on the board's own screens, where they cite the rule.
// On screens every member reads they are noise, so they are left out there.
const NO_CLAUSE_NUMBERS: [string, string[]][] = [
  ['screens/attendance.tsx', ['(4.12)', '(5.4)']],
  ['screens/notices.tsx', ['(5.5)']],
  ['screens/fees.tsx', ['(4.11)']],
  ['screens/fng.tsx', ['(4.11)']],
  ['screens/checkin.tsx', ['(5.4)', '(5.2, 4.6)']],
];
for (const [file, refs] of NO_CLAUSE_NUMBERS) {
  test(`member screens do not show clause numbers: ${file}`, () => {
    const text = FILES.find((f) => f.file === file)!.text;
    for (const ref of refs) assert.ok(!text.includes(ref), `${file} shows ${ref}`);
  });
}
