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

test('reminders.tsx adds actingReminderPlan and its memo depends on data', () => {
  const src = read('data/reminders.tsx');
  assert.match(src, /import \{[^}]*\bactingReminderPlan\b[^}]*\} from '\.\.\/domain\/notifications'/, 'imports the acting plan');
  const memo = src.match(/const plan = useMemo\(\s*\(\) => ([\s\S]*?),\s*\[([^\]]*)\],?\s*\);/);
  assert.ok(memo, 'the plan is one useMemo');
  const [, body, deps] = memo;
  assert.match(body, /reminderPlan\(/, 'the ride reminders stay');
  assert.match(body, /actingReminderPlan\(me\?\.id \?\? null, data, /, 'the acting person and the covered holder get theirs');
  // The provider memoises data (settled to today), so the memo follows all of it, not a list of parts
  // that goes stale when the plan reads another one.
  const depList = deps.split(',').map((d) => d.trim());
  for (const dep of ['data', 'me?.id', 'prefs']) assert.ok(depList.includes(dep), `the memo depends on ${dep}`);
  assert.ok(!depList.some((d) => d.startsWith('data.')), 'no parts of data');
  const raw = readFileSync(join(__dirname, '..', 'data/reminders.tsx'), 'utf8');
  const memoRaw = raw.slice(raw.indexOf('const plan = useMemo('), raw.indexOf('const key = '));
  assert.doesNotMatch(memoRaw, /exhaustive-deps/, 'nothing to switch the deps check off for');
});

test('NewVote shows stintVoteWarnings; VoteScreen judges an acting vote by the vote and says who isn’t on it', () => {
  const src = read('screens/business.tsx');
  const newVote = fnBody(src, 'NewVoteScreen');
  assert.match(newVote, /const warnings = closesAt\s*\?\s*stintVoteWarnings\(/, 'NewVote works out the stint warnings');
  assert.match(newVote, /\{warnings\.join\(' '\)\}/, 'and shows them');

  const vote = fnBody(src, 'VoteScreen');
  // By the vote's own shape (aboutActing), so a carried vote that ended a stint still reads as one.
  assert.match(vote, /const aboutActingVote = aboutActing\(vote, data\.positions\);/);
  assert.doesNotMatch(vote, /stintAbout\(/, 'not from the rows as they are now');
  // The words (stand-in, holder, Auditor) are actingVoteNote's, tested in votes.test.ts.
  assert.match(vote, /const actingNote = actingVoteNote\(vote, data\);/);
  assert.match(vote, /\{actingNote \? <Small>\{actingNote\}<\/Small> : null\}/);
  assert.doesNotMatch(vote, /aren’t on this vote|isn’t on this vote/, 'no copy of the note’s words');
});

test('the removal labels read isRemovalVote; the closed card ends acting for an acting vote', () => {
  const src = read('screens/business.tsx');
  assert.match(fnBody(src, 'voteKindLabel'), /if \(isRemovalVote\(vote\)\) return 'Removal vote';/);
  const vote = fnBody(src, 'VoteScreen');
  assert.match(vote, /isRemovalVote\(vote\)\s*\?\s*endsActing\s*\?\s*`End \$\{displayName\(subject\)\}’s acting as/);
  assert.match(vote, /const endsActing = aboutActingVote && !seatsActing;/);
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

test('Membership records’ Positions draw auditSeatRows', () => {
  const records = fnBody(read('screens/audit.tsx'), 'AuditRecordsScreen');
  // The rows, their order and their words are auditSeatRows' (audit.test.ts): held rows, settled.
  assert.match(records, /const seats = auditSeatRows\(chapterId, data, today\);/);
  assert.match(records, /title=\{s\.title\}/);
  assert.match(records, /\{s\.line\}/);
  assert.match(records, /s\.chip \? <Chip label=\{s\.chip\.label\} tone=\{s\.chip\.tone\} \/> : undefined/);
  assert.doesNotMatch(records, /heldRows|termState|ROLE_ORDER/, 'nothing worked out on the screen');
});

test('the hall of fame leaves acting rows out', () => {
  const hall = fnBody(read('screens/history.tsx'), 'HallOfFame');
  // pastOfficeHolders skips acting rows (its test is in social/history.test.ts); nothing here
  // lists positions any other way.
  assert.match(hall, /const past = pastOfficeHolders\(data\.members, data\.positions\);/);
  assert.doesNotMatch(hall, /data\.positions\.(filter|map|find|some)\(/);
});
