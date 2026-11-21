// The short role names on member chips (SAA, RC, TG...) are deliberate and stay. Members opens with a link to the key, so
// a newcomer is never left guessing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const m = fs.readFileSync(path.resolve(import.meta.dirname, 'members.tsx'), 'utf8');
const screen = m.slice(m.indexOf('export function MembersScreen'), m.indexOf('// One member'));

test('the Members list links to the Club words key, above the list', () => {
  const link = screen.indexOf("navigation.navigate('ClubWords')");
  assert.ok(link > 0, 'link present');
  assert.ok(link < screen.indexOf('{groups.map('), 'above the member list');
});

// Jeff, 21 Nov 2026: simplify the Members tab. The members come first; the club's extras follow as one card.
test('Members: the list first, then More from the club in one card, then the club in numbers', () => {
  const list = screen.indexOf('{groups.map(');
  const more = screen.indexOf('<SectionTitle title={MORE_FROM_CLUB.title}');
  const numbers = screen.indexOf('CLUB_NUMBERS.title');
  assert.ok(list > 0 && more > list && numbers > more, 'list, extras, numbers');
  const card = screen.slice(more, numbers);
  assert.equal(card.match(/<Card/g)?.length, 1, 'one card');
  for (const row of ["navigate('Chapters')", '<HistoryRow', '<WhoCanHelpRow', '<SwapRow', '<BuildsRow', '<BragRow']) assert.ok(card.includes(row), row);
});

// Jeff, 21 Nov 2026: "a question about roles and no answers on the members page". The link reads as a row that
// says what it opens, like Club words on Me, never as a bare question.
test('the Club words link is a row that names what it opens, not a question', () => {
  const link = screen.slice(0, screen.indexOf('{groups.map('));
  assert.ok(!/label="[^"]*\?"/.test(link), 'no question-mark button above the list');
  assert.ok(link.includes('title="Club words"'), 'titled Club words');
  assert.ok(link.includes('<ListRow'), 'a tappable row with a chevron');
});
