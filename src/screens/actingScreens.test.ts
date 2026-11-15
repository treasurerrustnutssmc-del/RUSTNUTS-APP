// Task 21 of the acting roles plan: the audit, history and vote screens, and the phone's reminders,
// read acting rows the way the spec's Screens section says. Screens are React Native and can't run
// under node, so their wiring is read from the source. The rules behind them (actingReminderPlan,
// stintVoteWarnings, pastOfficeHolders, vpFallbackFor) have their own tests in src/domain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A file under src with its comment-only lines and block comments left out. */
const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

/** One top-level function's source, from its declaration to the next top-level declaration. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(String.raw`\n(export )?function ${name}\b`));
  assert.ok(start >= 0, `${name} is in the file`);
  const rest = src.slice(start + 1);
  const next = rest.slice(1).search(/\n(export )?(function|const|type|interface) /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('reminders.tsx adds actingReminderPlan and its memo depends on data.positions', () => {
  const src = read('data/reminders.tsx');
  assert.match(src, /import \{[^}]*\bactingReminderPlan\b[^}]*\} from '\.\.\/domain\/notifications'/, 'imports the acting plan');
  const memo = src.match(/const plan = useMemo\(\s*\(\) => ([\s\S]*?),\s*\[([^\]]*)\],?\s*\);/);
  assert.ok(memo, 'the plan is one useMemo');
  const [, body, deps] = memo;
  assert.match(body, /reminderPlan\(/, 'the ride reminders stay');
  assert.match(body, /actingReminderPlan\(me\?\.id \?\? null, data, /, 'the acting person and the covered holder get theirs');
  const depList = deps.split(',').map((d) => d.trim());
  // A stint's row, its until date, the stand-in's name and the seat's chapter all go into the text.
  for (const dep of ['data.positions', 'data.members', 'data.chapters', 'me?.id', 'prefs']) {
    assert.ok(depList.includes(dep), `the memo depends on ${dep}`);
  }
});

test('NewVote shows stintVoteWarnings; VoteScreen shows the stand-in and holder note on acting votes', () => {
  const src = read('screens/business.tsx');
  const newVote = fnBody(src, 'NewVoteScreen');
  assert.match(newVote, /const warnings = closesAt\s*\?\s*stintVoteWarnings\(/, 'NewVote works out the stint warnings');
  assert.match(newVote, /\{warnings\.join\(' '\)\}/, 'and shows them');

  const vote = fnBody(src, 'VoteScreen');
  assert.ok(vote.includes('The stand-in and the holder aren’t on this vote (8.5, 11.10).'), 'the note, word for word');
  // Only on a vote about acting: one seating a request, or one ending a stint.
  assert.match(vote, /const aboutActingVote = seatsActing \|\| endsActing;/);
  assert.match(vote, /\{aboutActingVote \? \(/, 'the note shows only on acting votes');
  // An empty seat has no holder: the note names the one person left out.
  assert.match(vote, /`\$\{subject \? displayName\(subject\) : 'The stand-in'\} isn’t on this vote \(8\.5, 11\.10\)\.`/);
});

test('the Vote screen’s 48-hour note is the shared ACTING_VOTE_OPEN words', () => {
  const src = read('screens/business.tsx');
  assert.match(src, /import \{[^}]*\bACTING_VOTE_OPEN\b[^}]*\} from '\.\.\/domain\/votes'/);
  const vote = fnBody(src, 'VoteScreen');
  assert.match(vote, /`\$\{ACTING_VOTE_OPEN\} It can be closed from \$\{when\(earliestClose\)\}\.`/);
  assert.ok(!src.includes('stays open at least 48 hours'), 'no paraphrase of the rule anywhere on the vote screens');
});

test('NewVote takes the acting shape only from a stint it found', () => {
  const newVote = fnBody(read('screens/business.tsx'), 'NewVoteScreen');
  // params.acting with no held stint (lapsed, or never there) would show a board-majority vote the
  // database then refuses with the removal words.
  assert.match(newVote, /const acting = stint !== null;/);
  assert.doesNotMatch(newVote, /params\.acting === true \|\|/);
});

test('the Auditor’s vp-fallback line has no button', () => {
  const src = read('screens/audit.tsx');
  const hub = fnBody(src, 'AuditScreen');
  // The Auditor can't record a President (11.8), so "Make Jet Acting President" lives on the
  // chapter's Board tab. Here every finding, vp-fallback included, only opens a request to the board.
  assert.doesNotMatch(src, /appointActing|vpFallbackFor|Acting President/);
  const checks = hub.slice(hub.indexOf('checks.map('), hub.indexOf('Tap one to ask the board about it.'));
  assert.ok(checks.length > 0, 'the findings list is there');
  assert.doesNotMatch(checks, /<(Button|ConfirmButton)\b/, 'no button on a finding');
  assert.match(checks, /onPress=\{\(\) => navigation\.navigate\('NewAuditRequest', \{ checkKey: c\.key \}\)\}/);
});

test('Membership records’ Positions read held rows and chip acting ones', () => {
  const src = read('screens/audit.tsx');
  const records = fnBody(src, 'AuditRecordsScreen');
  assert.match(records, /const seats = heldRows\(data\.positions\)\s*\.filter\(/, 'held rows, settled, not open-row checks');
  assert.match(records, /isActing\(p\) \? <Chip label="Acting"/, 'an Acting chip on a stint');
  // In role order, a stint right after the seat's full term, so a cover sits under the holder it covers.
  assert.match(records, /\.sort\(\(a, b\) => ROLE_ORDER\.indexOf\(a\.role\) - ROLE_ORDER\.indexOf\(b\.role\) \|\| Number\(isActing\(a\)\) - Number\(isActing\(b\)\)/);
  // A stint's end is its until date, its last acting day, not a term end.
  assert.match(records, /until \$\{formatAuDate\(p\.actingUntil!?\)\}/);
});

test('the hall of fame leaves acting rows out', () => {
  const hall = fnBody(read('screens/history.tsx'), 'HallOfFame');
  // pastOfficeHolders skips acting rows (its test is in social/history.test.ts); nothing here
  // lists positions any other way.
  assert.match(hall, /const past = pastOfficeHolders\(data\.members, data\.positions\);/);
  assert.doesNotMatch(hall, /data\.positions\.(filter|map|find|some)\(/);
});
