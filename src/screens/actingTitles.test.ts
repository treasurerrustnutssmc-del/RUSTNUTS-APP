// Acting roles, Task 17: titles everywhere read the held rows and show a stint as acting, and Home's
// club-wide scope follows seesEveryChapter. An Acting President sits on the NEC, so their access
// level is 'national', but they read member data of their own chapter only, so "national" can't
// mean "every chapter" on Home. See docs/superpowers/specs/2026-11-15-acting-roles-design.md
// (Screens: Titles everywhere) and DESIGN.md (Acting titles).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { accessLevel, seesEveryChapter } from '../domain/access';
import { DEMO_DATA } from '../data/demoStory.testkit';
import type { Position } from '../domain/types';

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, rel), 'utf8');
const members = read('members.tsx');
const me = read('me.tsx');
const coverBits = read('coverBits.tsx');
const deleteAccount = read('deleteAccount.tsx');
const memberBits = read('../ui/MemberBits.tsx');
const chatBits = read('../ui/ChatBits.tsx');

/** The source of one top-level function (or component), up to its closing brace. */
function fn(src: string, name: string): string {
  const at = src.search(new RegExp(`function ${name}\\(`));
  assert.ok(at >= 0, `${name} is defined`);
  return src.slice(at, src.indexOf('\n}\n', at));
}

test('members.tsx gates alerts and the All chapters chip on seesEveryChapter, not level === \'national\'', () => {
  // Why: Jet, Acting President of North in an empty seat, is on the NEC but reads North only.
  const jetActing: Position = {
    id: 'p-jet-acting', memberId: 'm-jet', chapterId: 'ch-north', role: 'president', startedOn: '2026-11-01', endedOn: null,
    actingUntil: '2026-12-13', actingWhy: 'No President since the ACM', covers: null, endedReason: null, appointedBy: 'm-crank',
  };
  const positions = [...DEMO_DATA.positions.map((p) => (p.id === 'p-9' ? { ...p, endedOn: '2026-10-31' } : p)), jetActing];
  const jet = DEMO_DATA.members.find((m) => m.id === 'm-jet')!;
  assert.equal(accessLevel(jet, positions), 'national');
  assert.equal(seesEveryChapter(jet, positions), false);

  const home = fn(members, 'HomeScreen');
  // The national level still shows the Board card (isBoard); it just doesn't widen it to every chapter.
  const scope = home.slice(home.indexOf('const boardScope'), home.indexOf('const boardAlerts'));
  const chip = home.split('\n').find((l) => l.includes("'All chapters'"));
  assert.ok(chip, 'the Board card still has the All chapters chip');
  for (const [what, src] of [['the renewal alerts', scope], ['the All chapters chip', chip]]) {
    assert.doesNotMatch(src, /level === 'national'/, `${what} don’t read the national level as every chapter`);
  }
  const every = /const (\w+) = seesEveryChapter\(me, data\.positions\);/.exec(home);
  assert.ok(every, 'Home asks seesEveryChapter once');
  const flag = every[1];
  assert.match(scope, new RegExp(`\\(${flag} \\|\\| m\\.chapterId === me\\.chapterId\\)`), 'the renewal alerts cover every chapter only for a club-wide seat');
  assert.match(chip, new RegExp(`label=\\{${flag} \\? 'All chapters'`));
});

test('sortedPositions uses heldPositions', () => {
  const sorted = fn(memberBits, 'sortedPositions');
  assert.match(sorted, /heldPositions\(memberId, data\.positions\)/, 'a covered holder keeps the title; a lapsed stint has none');
  assert.doesNotMatch(sorted, /activePositions/);
});

test('the NEC list renders necRows', () => {
  const chapters = fn(members, 'ChaptersScreen');
  assert.match(chapters, /necRows\(data\)\.map\(/, 'one row per chapter, for whoever casts its vote');
  assert.doesNotMatch(chapters, /p\.role === 'president'/, 'the Presidents no longer come from the raw rows');
});

test('RoleChips draws roleChipTexts, short in a member row, long on member detail; AuthorLine uses chipLabel', () => {
  const chips = fn(memberBits, 'RoleChips');
  assert.match(chips, /roleChipTexts\(positions, data\.chapters, form\)/, 'an acting seat says Acting: ACTING TREASURER (NORTH), or ACTING TREAS (NORTH) in a dense row');
  assert.match(chips, /<RoleChip key=\{c\.key\} role=\{c\.role\} label=\{c\.label\} accessibilityLabel=\{c\.spoken\} \/>/);
  assert.match(chips, /form = 'long'/, 'the long form unless a row asks for the short one');
  assert.match(fn(memberBits, 'MemberRow'), /<RoleChips\b[^>]*\bform="short"/, 'a member row has 216 of room at 360 wide');
  const detail = fn(members, 'MemberDetailScreen');
  assert.match(detail, /<RoleChips\b/, 'member detail shows the same chips');
  assert.doesNotMatch(detail, /<RoleChips\b[^>]*\bform=/, 'member detail has the full width, so it keeps the long form');
  const author = fn(chatBits, 'AuthorLine');
  assert.match(author, /topSeat\(member\.id, data\.positions\)/, 'the same top seat the name button reads out');
  assert.match(author, /<RoleChip\s+key=\{top\.id\}\s+role=\{top\.role\}\s+label=\{chipLabel\(top, data\.chapters, 'short'\)\}/, 'a chat name line is a dense row too');
  // Keyed by seat: when the top seat changes, Android would otherwise keep the old spoken words on the chip.
});

test('a screen reader hears an acting chip’s whole title, and a full-term chip as shown', () => {
  // Only a stint gets spoken words (spoken is undefined for a full term, so PRES (WEST) is read as it was).
  assert.match(fn(chatBits, 'AuthorLine'), /accessibilityLabel=\{actingSpoken\(top, data\.chapters\)\}/);
  // The chat name is a button with its own label, which hides the chip inside it, so the label says the title.
  const chat = read('chat.tsx');
  assert.match(chat, /accessibilityLabel=\{author && !family \? authorPageLabel\(author, data\) : undefined\}/);
  assert.doesNotMatch(chat, /`\$\{displayName\(author\)\}’s page`/, 'no second spelling of the name button’s words');
});

test('Me draws its chips with roleChipTexts: long words for every title, and a stint that fits at 360', () => {
  const screen = fn(me, 'MeScreen');
  assert.match(screen, /roleChipTexts\(positions, data\.chapters, 'long', ROLE_LABEL\)/);
  assert.match(screen, /<Chip key=\{c\.key\} label=\{c\.label\} tone="bone" accessibilityLabel=\{c\.spoken\} \/>/);
});

test('the Home header puts a stint’s until date on a line of its own', () => {
  const home = fn(members, 'HomeScreen');
  // Each title wraps as one piece, so at 360 wide a line breaks between titles, never inside one
  // ("Vice President," then "Acting President").
  assert.match(home, /<View style=\{styles\.titleLine\}>/);
  assert.match(home, /\{titles\.map\(\(t, i\) => \(\s*<Small key=\{t\.key\} style=\{styles\.titlePiece\}>/);
  assert.match(members, /titleLine: \{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 \}/);
  assert.match(home, /<Small[^>]*>\{`until \$\{\w+\}`\}<\/Small>/, 'until 13/12/2026, under the titles');
  assert.doesNotMatch(home, /longTitle|longSeatTitle/, 'the date never runs on after the titles');
});

test('the Chapters lists read held rows and show acting titles', () => {
  for (const name of ['ChaptersScreen', 'ChapterDetailScreen']) {
    const body = fn(members, name);
    assert.doesNotMatch(body, /endedOn/, `${name} reads the held rows, not endedOn`);
    assert.match(body, /heldRows\(data\.positions\)/, name);
  }
  assert.doesNotMatch(members, /acting: pending/, 'the open-row markers in members.tsx are gone');
  assert.match(fn(members, 'ChaptersScreen'), /label=\{seatTitle\(p, \[\], ROLE_LABEL\)\}/, 'Acting Treasurer, in its chapter’s card');
  assert.match(fn(members, 'ChapterDetailScreen'), /subtitle=\{longTitle\(positionTitles\(\[p\], \[\], '', ROLE_LABEL\)\[0\]\)\}/, 'Acting Treasurer until 13/12/2026');
});

test('member detail shows each seat in the long form, and no term words on a stint', () => {
  const detail = fn(members, 'MemberDetailScreen');
  assert.match(detail, /longSeatTitle\(p, data\.chapters\)/, 'Acting Treasurer (North) until 13/12/2026');
  assert.match(detail, /const term = !isActing\(p\) && termEndsOn\(p\) \?/, 'a stint isn’t a term, so no "term ends"');
});

test('stepping down from a stint, and from a covered seat', () => {
  const button = fn(memberBits, 'StepDownButton');
  // Delete account and the member page list one button per seat, so each names its seat, a stint
  // too ("Step down as Acting Treasurer (North)"). Manage member keeps "Step down from acting".
  assert.match(button, /label=\{`Step down as \$\{title\}`\}/);
  assert.doesNotMatch(button, /Step down from acting/);
  // The covered holder hears that the cover ends too, and a stand-in that their own stint does
  // (stepDownNote, tested in home.test.ts).
  assert.match(button, /confirmNote=\{stepDownNote\(position, data\)\}/);
  // The title already says Acting, so the label says it once.
  assert.match(button, /confirmAccessibilityLabel=\{`Yes, step down as \$\{title\}`\}/);
  assert.doesNotMatch(memberBits + read('board.tsx'), /step down from acting as/);
  assert.match(fn(members, 'StepDownButtons'), /<StepDownButton\b/);
  assert.match(fn(deleteAccount, 'StepDownSeats'), /<StepDownButton\b/, 'Delete account lists acting seats with the same step-down');
});

test('Me’s titles read held rows in role order, as member detail does, with a stint’s until date', () => {
  const screen = fn(me, 'MeScreen');
  assert.match(screen, /const positions = sortedPositions\(me\.id, data\);/);
  assert.doesNotMatch(me, /activePositions/);
  assert.match(screen, /`Acting until \$\{\w+\}`/);
});

// Acting roles, Task 20: Me and Home for cover. The words and what shows come from meLayout's
// coverPanels (tested there); these pin that the screens draw them and wire each button.
test('Me and Home show the covered holder’s notice with an I’m back ConfirmButton', () => {
  assert.match(fn(me, 'MeScreen'), /<CoverPanels panels=\{coverPanels\(me, data, today\)\} \/>/, 'Me: every board seat’s panel');
  assert.match(fn(members, 'HomeScreen'), /<CoverPanels panels=\{homeCoverPanels\(me, data, today\)\} \/>/, 'Home: the covered notice only');
  // Both draw it from one module, so Home doesn't pull in the Me screen.
  assert.match(members, /import \{ CoverPanels \} from '\.\/coverBits';/, 'Home draws the same panel as Me');
  assert.match(me, /import \{ CoverPanels, StandInPanels \} from '\.\/coverBits';/);
  assert.doesNotMatch(me, /function CoveredSeat|function ArrangeCover/);
  const covered = fn(coverBits, 'CoveredSeat');
  assert.match(covered, /<ConfirmButton\b[^>]*label=\{panel\.button\.label\}/s, 'I’m back is a ConfirmButton');
  assert.match(covered, /endPosition\(panel\.cover\.id\)/, 'I’m back ends the cover (holder_back)');
  assert.match(covered, /\{panel\.notice\}/);
});

test('Me asks for cover with the stand-ins, Until and Why, and the note on the ConfirmButton', () => {
  const arrange = fn(coverBits, 'ArrangeCover');
  assert.match(arrange, /<Choices\b(<\w+>)?[^>]*options=\{panel\.choices\}/s);
  assert.match(arrange, /<DateField\b/);
  assert.match(arrange, /requestCoverProblem\(me, panel\.seat, \w+, [\w.]+, \w+, data, today\)/, 'the button waits on the rule');
  assert.match(arrange, /confirmNote=\{[^}]*coverConfirmNote\(panel\.seat, \w+, [\w.]+, data, today\)/s);
  assert.match(arrange, /requestCover\(panel\.seat\.id, /);
  // A date the rule refuses (out of range, past the stand-in's licence) shows on Until, not under Why.
  assert.match(arrange, /<DateField\b[^>]*error=\{untilShown\}/s);
  assert.match(arrange, /hint=\{panel\.whyHint\}/, 'the Why hint says it’s required (meLayout.test.ts)');
  const asked = fn(coverBits, 'AskedCover');
  assert.match(asked, /<ConfirmButton\b[^>]*label=\{panel\.button\.label\}/s, 'Withdraw request is a ConfirmButton');
  assert.match(asked, /withdrawActingRequest\(panel\.request\.id\)/);
});

test('Me shows a stand-in with no Board tab the request, with Decline', () => {
  assert.match(fn(me, 'MeScreen'), /<StandInPanels panels=\{standInPanels\(me, data, today\)\} \/>/);
  const asked = fn(coverBits, 'StandInRequest');
  assert.match(asked, /<ConfirmButton\b[^>]*label=\{panel\.button\.label\}[^>]*confirmNote=\{panel\.button\.confirmNote\}/s, 'Decline is a ConfirmButton');
  assert.match(asked, /withdrawActingRequest\(panel\.request\.id\)/);
});
