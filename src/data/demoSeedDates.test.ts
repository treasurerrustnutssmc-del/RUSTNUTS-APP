// A guard on the demo seed sources. The demo club's dates follow today (demoStory.ts), so a bare
// date literal, a clock read or a date-word in a seed string is how the demo goes stale again: a
// date nobody moves, or words ("Christmas ride", "the 8th", "next week") that the calendar beside
// them contradicts on most days. Each seed file is read as text with its comments left out, and:
// - every ISO date or instant literal is the direct argument of d(), t() or fixed();
// - nothing reads the machine clock;
// - no string names a month, weekday, day of the month, season, holiday, nearby day or year,
//   unless that exact string is on ALLOWED, with the reason it is true on any day;
// - every d() and t() literal comes back unchanged in the story week, by the real path, and no t()
//   literal sits on a Sunday before 4 am Melbourne, where a daylight-saving change would move it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { melbourneHhmm } from '../domain/business';
import { melbourneDate } from '../domain/rides';
import { STORY_ANCHOR, storyDates, weekdayName } from './demoStory';

const SEEDS = [
  'demoData.ts',
  'chat/demoChatData.ts',
  'social/demoSocialData.ts',
  'siteNewsData.ts',
  'enquiriesData.ts',
  'feedbackData.ts',
  'sitePhotosData.ts',
];

/** A string in the source: its text (a template's ${…} parts shown as ${…}), and where it starts. */
interface Literal {
  file: string;
  line: number;
  text: string;
  template: boolean;
  /** The code just before the opening quote, comments left out (for "the direct argument of"). */
  before: string;
  /** The code just after the closing quote. */
  after: string;
}

interface Source {
  file: string;
  /** The source with comments left out: code and strings only. */
  code: string;
  literals: Literal[];
}

/**
 * A small TypeScript lexer, enough for the seed files: comments, '…' and "…" strings, `…`
 * templates with ${…} parts (lexed as code, so their own strings are found too), and regular
 * expression literals (told from division by the character before them).
 */
function lex(file: string, src: string): Source {
  let code = '';
  const literals: Literal[] = [];
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  const lastSignificant = () => code.replace(/\s+$/, '').slice(-1);
  const pending: { start: number; literal: Literal }[] = [];

  function readString(i: number, quote: string): number {
    const start = i;
    let text = '';
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '\n') throw new Error(`${file}:${lineAt(start)}: unterminated string`);
      text += src[i++];
    }
    i++;
    const literal: Literal = { file, line: lineAt(start), text, template: false, before: code, after: '' };
    literals.push(literal);
    code += src.slice(start, i);
    pending.push({ start: code.length, literal });
    return i;
  }

  function readTemplate(i: number): number {
    const start = i;
    const literal: Literal = { file, line: lineAt(start), text: '', template: true, before: code, after: '' };
    literals.push(literal);
    code += '`';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { literal.text += src.slice(i, i + 2); code += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        literal.text += '${…}';
        code += '${';
        i = readCode(i + 2, '}');
        code += '}';
        i++;
        continue;
      }
      literal.text += src[i];
      code += src[i++];
    }
    code += '`';
    pending.push({ start: code.length, literal });
    return i + 1;
  }

  function readRegex(i: number): number {
    const start = i;
    let inClass = false;
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      else if (c === '\n') throw new Error(`${file}:${lineAt(start)}: unterminated regex`);
      i++;
    }
    i++;
    while (/[a-z]/.test(src[i] ?? '')) i++;
    code += src.slice(start, i);
    return i;
  }

  /** Reads code until `close` at depth 0 (or the end); returns the index of `close`. */
  function readCode(i: number, close: string | null): number {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const next = src[i + 1];
      if (close && c === close && depth === 0) return i;
      if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        // Keep the line count: a block comment becomes as many newlines as it held.
        code += src.slice(i, end + 2).replace(/[^\n]/g, '');
        i = end + 2;
        continue;
      }
      if (c === "'" || c === '"') { i = readString(i, c); continue; }
      if (c === '`') { i = readTemplate(i); continue; }
      if (c === '/' && (code.length === 0 || /[(,=:[!&|?{};]/.test(lastSignificant()))) { i = readRegex(i); continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      code += c;
      i++;
    }
    return i;
  }

  readCode(0, null);
  for (const { start, literal } of pending) literal.after = code.slice(start, start + 40);
  return { file, code, literals };
}

const SOURCES: Source[] = SEEDS.map((file) => lex(file, fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')));
const LITERALS = SOURCES.flatMap((s) => s.literals);
const where = (l: Literal) => `${l.file}:${l.line}: ${l.template ? '`' : "'"}${l.text}${l.template ? '`' : "'"}`;

const ISO = /\b(19|20)\d\d-\d\d-\d\d(T[\d:.]+Z)?\b/;
const ISO_ALL = /\b(19|20)\d\d-\d\d-\d\d(T[\d:.]+Z)?\b/g;
const ISO_ONLY = /^(19|20)\d\d-\d\d-\d\d(T[\d:.]+Z)?$/;
/** The call a literal is the direct argument of, if it is one: d, t or fixed (or null). */
function callOf(l: Literal): string | null {
  if (l.template || !/^\s*\)/.test(l.after)) return null;
  return /(?:^|[^\w$])(d|t|fixed)\(\s*$/.exec(l.before)?.[1] ?? null;
}

test('every date literal in the seeds is moved by the story clock or marked fixed history', () => {
  const bare = LITERALS.filter((l) => ISO.test(l.text) && !(ISO_ONLY.test(l.text) && callOf(l))).map(where);
  assert.deepEqual(bare, [], 'wrap a story date in d(…), a story instant in t(…), or mark fixed history with fixed(…)');
});

test('no seed file reads the machine clock', () => {
  const CLOCK: [string, RegExp][] = [
    ['new Date() with no argument', /\bnew Date\(\s*\)/],
    ['new Date with no brackets', /\bnew Date(?!\s*\()/],
    ['Date.now()', /\bDate\.now\s*\(/],
    ['todayIso() with no argument', /\btodayIso\(\s*\)/],
    ['a parameter default that reads the clock', /[(,]\s*[\w$]+\??\s*(:[^=,()]+)?=\s*(new Date|Date\.now|todayIso)\b/],
  ];
  const found: string[] = [];
  for (const { file, code } of SOURCES) {
    code.split('\n').forEach((line, i) => {
      // Strings are code here too, so a word in a string could match: none of the seeds says these.
      for (const [what, pattern] of CLOCK) if (pattern.test(line)) found.push(`${file}:${i + 1}: ${what}: ${line.trim().slice(0, 90)}`);
    });
  }
  // The rule can bite: each pattern finds its case.
  assert.ok(CLOCK.every(([, p], i) => p.test(['new Date()', 'x = new Date;', 'Date.now()', 'todayIso()', '(now = new Date(0))'][i])));
  assert.deepEqual(found, []);
});

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const WEEKDAYS = 'Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday';
const DATE_WORDS: [string, RegExp][] = [
  // A plural counts too ("Tuesdays"): the spec's list has one.
  ['a month name', new RegExp(`\\b(${MONTHS})s?\\b`)],
  ['a weekday name', new RegExp(`\\b(${WEEKDAYS})s?\\b`)],
  ['a day of the month', /\bthe \d{1,2}(st|nd|rd|th)\b/],
  ['a season, holiday or nearby day', /Christmas|Easter|Kris Kringle|summer|winter|spring|autumn|weekend|tonight|tomorrow|yesterday|last night|(last|next) (week|month|year)/i],
  // A year inside a code counts too ("RN2026"): the spec's list has one. Not part of a longer number.
  ['a year', /(?<!\d)20\d\d(?!\d)/],
];

/**
 * The strings that may name a date-word: each is true on any day the demo is opened. The exact
 * string, as it stands in the seed (a template's ${…} parts shown as ${…}). Only the spec's list
 * (docs/superpowers/specs/2026-11-14-demo-dates-follow-today-design.md, section 9).
 */
const BYLAWS_HEAD = `# Sample West Chapter bylaws (demo only)

A made-up sample. West's board publishes the real bylaws.

# Meetings
`;
const ALLOWED: [string, string][] = [
  ['Been riding with the West crew for a few months. Ride a 2019 Street Bob.', 'a bike’s model year never changes'],
  ['Ride a 2019 Street Glide, out Werribee way. Keen for the Sunday runs and a beer after.', 'a bike’s model year; the club rides on Sundays every week'],
  ['Patched in 2020. Moved on in 2025, still drops in for a beer.', 'a bio: years in the member’s past'],
  ['Moved to the Sunshine Coast in 2025. Phones in to North meetings.', 'a bio: a year in the member’s past'],
  ['Black tee with the EST 2019 logo on the back.', 'the club’s founding year, on its logo'],
  ['RN2026', 'the check-in code: a code, not a date, and the Check in screen’s hint is this literal'],
  ['Move board meetings to Tuesdays?', 'a standing weekday, not a date'],
  ['Royal Children’s Hospital Good Friday Appeal', 'the charity’s name'],
  ['Geelong, meeting at the Corio pub on the first Tuesday.', 'a monthly rhythm, true in any month'],
  ['Monthly ride on the third Sunday, out along the Great Ocean Road, joining West for club runs.', 'a monthly rhythm, true in any month'],
  ['The float tin sat with Sparks for more than a week. From next month the Treasurer banks it on the Monday after the meeting.', 'a rule for every meeting; "next month" counts from the answer'],
  ['Bank meeting takings on the Monday after the meeting.', 'a rule for every meeting'],
  [`${BYLAWS_HEAD}West meets on the last Thursday of the month at the clubrooms.`, 'the sample bylaws: a monthly rhythm'],
  ['Meetings move to the last Wednesday.', 'the sample bylaws: a monthly rhythm'],
  [`${BYLAWS_HEAD}West meets on the last Wednesday of the month at the clubrooms. A pre-meeting ride leaves at 6 pm.

# Guests
- Members may bring a guest to an ordinary meeting.
- Tell the Secretary beforehand.`, 'the sample bylaws: a monthly rhythm'],
  ['Sunday run', 'the 2025 season: fixed history, every ride on a Sunday in Melbourne'],
  ['Big 4: Summer send-off', 'the 2025 season: fixed history, in the summer of 2025'],
  ['Big 4: Winter warmer', 'the 2025 season: fixed history'],
  ['Chook’s bike died near Bacchus Marsh on the way home last night. Bringing it back to the clubhouse.', 'a recovery booked for today, the morning after the breakdown'],
  ['G’day all, Ben here. Rode with North last month. Keen for the club lunch ride if there’s room.', 'Ben joined weeks before the message, and both move with the story: true on any day'],
];

/** A string's text with its ISO dates taken out: those are the date-literal rule's business. */
const words = (l: Literal) => l.text.replace(ISO_ALL, '');
const dateWordIn = (l: Literal) => DATE_WORDS.find(([, p]) => p.test(words(l)))?.[0] ?? null;

test('no seed string names a date-word the calendar could contradict', () => {
  const allowed = new Set(ALLOWED.map(([text]) => text));
  const found = LITERALS.filter((l) => !allowed.has(l.text) && dateWordIn(l)).map((l) => `${where(l)} (${dateWordIn(l)})`);
  assert.deepEqual(found, [], 'reword it to something true on any day, or build it from the moved date (demoStory.ts word helpers)');
});

test('every allowed date-word string is still in a seed and still needs its allowance', () => {
  const stale = ALLOWED.filter(([text]) => !LITERALS.some((l) => l.text === text && dateWordIn(l))).map(([text]) => text);
  assert.deepEqual(stale, []);
  assert.equal(new Set(ALLOWED.map(([text]) => text)).size, ALLOWED.length, 'no entry twice');
});

const STORY = storyDates(STORY_ANCHOR);
const moved = (call: string) => LITERALS.filter((l) => callOf(l) === call);

test('every story date and instant comes back unchanged in the story week, by the real path', () => {
  assert.equal(STORY.shiftDays, 0);
  const dates = moved('d');
  const instants = moved('t');
  assert.ok(dates.length > 20 && instants.length > 50, `found ${dates.length} d() and ${instants.length} t() literals`);
  for (const l of dates) {
    assert.match(l.text, /^\d{4}-\d{2}-\d{2}$/, where(l));
    assert.equal(STORY.d(l.text), l.text, where(l));
  }
  for (const l of instants) {
    assert.match(l.text, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, where(l));
    assert.equal(STORY.t(l.text), l.text, where(l));
  }
});

test('no story instant sits on a Sunday before 4 am Melbourne, where daylight saving would move it', () => {
  const early = moved('t').filter((l) => weekdayName(melbourneDate(l.text)) === 'Sunday' && melbourneHhmm(l.text) < '04:00').map(where);
  assert.deepEqual(early, []);
});

test('the lexer finds what the rules look for', () => {
  const sample = lex('sample.ts', [
    "// 'a comment: 2026-01-01 is not code'",
    "const a = d('2026-11-08'), b = t('2026-11-07T21:30:00.000Z'), c = fixed('2019-03-09');",
    "const e = '2026-01-01'; /* 'Christmas' */ const f = x.replace(/'/g, '’');",
    'const g = `Breakfast run on the ${dayOrdinal(d(\'2026-11-08\'))}, see you Sunday`;',
  ].join('\n'));
  assert.deepEqual(sample.literals.map((l) => [l.line, l.text, callOf(l)]), [
    [2, '2026-11-08', 'd'], [2, '2026-11-07T21:30:00.000Z', 't'], [2, '2019-03-09', 'fixed'],
    [3, '2026-01-01', null], [3, '’', null],
    [4, 'Breakfast run on the ${…}, see you Sunday', null], [4, '2026-11-08', 'd'],
  ]);
  assert.equal(dateWordIn(sample.literals[5]), 'a weekday name');
  assert.ok(!sample.code.includes('comment') && !sample.code.includes('Christmas'));
});
