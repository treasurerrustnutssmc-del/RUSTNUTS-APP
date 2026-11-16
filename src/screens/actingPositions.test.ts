// Manage member › Positions for acting (docs/superpowers/specs/2026-11-15-acting-roles-design.md,
// "Screens"): an acting seat gets ActingActions, never TermActions and its "Start removal vote";
// a board too small to vote shows why next to the button it turns off; and the confirm steps
// don't show their warnings twice or stack two Cancel buttons.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, rel), 'utf8');
const board = read('board.tsx');
const between = (from: string, to: string) => {
  const start = board.indexOf(from);
  const end = board.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `${from} … ${to}`);
  return board.slice(start, end);
};
const manage = between('export function ManageMemberScreen', '\nfunction TermActions');
const actingActions = between('\nfunction ActingActions', '\nfunction ArrangeCover');
const arrangeCover = between('\nfunction ArrangeCover', '\nfunction RequestStep');
const requestStep = between('\nfunction RequestStep', '\nconst styles');

test('an acting seat on the Positions card gets ActingActions, a full term TermActions', () => {
  assert.match(manage, /\{isActing\(p\) \? <ActingActions position=\{p\} \/> : <TermActions position=\{p\} member=\{member\} \/>\}/);
  assert.ok(!actingActions.includes('Start removal vote'), 'ending acting is a board majority (9.3), never a removal vote');
  assert.ok(!actingActions.includes('<TermActions'));
  // NewVote finds the stint from the subject and role (stintAbout), so it takes no acting flag.
  assert.match(actingActions, /navigate\('NewVote', \{ chapterId: p\.chapterId, subjectMemberId: p\.memberId, subjectRole: p\.role \}\)/);
  assert.doesNotMatch(board + read('../navigation/types.ts'), /acting: (true|boolean)|acting\?: boolean/);
});

test('a board too small to vote turns the button off and says why beside it (8.6)', () => {
  assert.match(actingActions, /endVoteBlock\(p, data, today\)/);
  assert.match(actingActions, /disabled=\{endBlock !== null\}/);
  assert.match(arrangeCover, /disabled=\{state\.blocked !== null\}/);
  assert.ok(!arrangeCover.includes('<Notice'), 'the form never opens onto a refusal');
  // Every line saying why a button is off reads in the danger colour (DESIGN.md, Buttons).
  assert.match(actingActions, /\{endBlock \? <Small style=\{\{ color: colors\.danger \}\}>\{endBlock\}<\/Small> : null\}/);
  assert.match(actingActions, /\{dateBlock \? <Small style=\{\{ color: colors\.danger \}\}>\{dateBlock\}<\/Small> : null\}/);
  assert.match(arrangeCover, /\{state\.blocked \? <Small style=\{\{ color: colors\.danger \}\}>\{state\.blocked\}<\/Small> : null\}/);
});

test('a stint’s step-down on Manage member says Acting once', () => {
  // The title is Acting Treasurer (North), so "Yes, step down as Acting Treasurer (North)".
  assert.match(actingActions, /confirmAccessibilityLabel=\{`Yes, step down as \$\{title\}`\}/);
});

test('each request’s start-vote and close buttons say which request they act on', () => {
  // Two requests on the Board tab: a screen reader hears which one each confirm starts.
  const request = between('\nfunction BoardRequest', '\nfunction VpFallback');
  assert.match(request, /confirmLabel="Yes, start the vote"\s+confirmAccessibilityLabel=\{`Yes, start the vote: \$\{about\}`\}/);
  assert.match(requestStep, /confirmLabel="Yes, start the vote"\s+confirmAccessibilityLabel=\{`Yes, start the vote: \$\{\w+\}`\}/);
  // Withdraw and Decline say what happens to an open vote on it (closeRequestNote, boardLayout.test.ts).
  assert.match(request, /confirmNote=\{closeRequestNote\(request, data\)\}/);
  assert.doesNotMatch(request, /confirmNote="This closes the request/);
});

test('an armed confirm shows its warnings once, with one Cancel', () => {
  // The Appoint form and the cover form hide their warn lines while the confirm note repeats them.
  assert.match(manage, /onArmedChange=\{setActingArmed\}/);
  assert.match(manage, /actingArmed \? null : warnings\.map/);
  assert.match(arrangeCover, /onArmedChange=\{setArmed\}/);
  assert.match(arrangeCover, /armed \? null : warnings\.map/);
  assert.match(arrangeCover, /armed \? null : <Button label="Cancel"/, 'the form’s Cancel steps aside for the confirm’s');
});

test('I’m back names the stand-in through backNote, and the request shows why a vote can start again', () => {
  assert.match(actingActions, /confirmNote=\{backNote\(p, data\)\}/);
  assert.match(requestStep, /step\.last/);
});
