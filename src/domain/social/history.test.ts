import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_HISTORY_DATE,
  BAD_YEAR,
  ENTRY_GONE,
  ENTRY_OFF,
  ENTRY_OFF_ALREADY,
  HONOUR_GONE,
  HONOUR_NO_NAME,
  HONOUR_OFF,
  HONOUR_OFF_ALREADY,
  NO_HONOUR_WHO,
  NO_SUCH_MEMBER,
  NO_TITLE,
  NOT_KEEPER,
  archiveEntryProblem,
  archiveHonourProblem,
  cleanEntry,
  cleanHonour,
  founders,
  historyDateLabel,
  historyProblem,
  honourProblem,
  honoursFor,
  pastOfficeHolders,
  timeline,
  yearsLabel,
  type HistoryEntry,
  type HistoryInput,
  type Honour,
  type HonourInput,
} from './history';
import type { Member, Position } from '../types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west',
  fullName: m.id,
  roadName: null,
  status: 'full',
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  bio: null,
  sharePhone: false,
  appliedOn: null,
  onHiatus: false,
  ...m,
});
const pos = (id: string, memberId: string, role: Position['role'], chapterId: string | null, startedOn: string, endedOn: string | null = null): Position => ({
  id, memberId, role, chapterId, startedOn, endedOn,
});

const boss = member({ id: 'boss', fullName: 'Bob Boss' });
const plain = member({ id: 'plain' });
const positions = [pos('p1', 'boss', 'president', 'ch-west', '2025-01-01')];
const today = '2026-10-27';

const entryIn = (over: Partial<HistoryInput> = {}): HistoryInput => ({
  id: null, happenedOn: '2019-03-09', precision: 'day', title: 'First ride', story: '', ...over,
});
const entry = (over: Partial<HistoryEntry> & Pick<HistoryEntry, 'id'>): HistoryEntry => ({
  happenedOn: '2020-01-01', precision: 'year', title: 'X', story: null, addedBy: 'boss', archivedAt: null, ...over,
});
const honourIn = (over: Partial<HonourInput> = {}): HonourInput => ({
  id: null, memberId: 'plain', name: '', honour: 'Life member', year: 2024, note: '', ...over,
});
const honour = (over: Partial<Honour> & Pick<Honour, 'id'>): Honour => ({
  memberId: 'plain', name: null, honour: 'Life member', year: 2024, note: null, addedBy: 'boss', archivedAt: null, ...over,
});

test('the board keeps timeline entries, trimmed', () => {
  assert.equal(historyProblem(boss, entryIn(), [], positions, today), null);
  assert.deepEqual(cleanEntry(entryIn({ title: ' First ride ', story: '  ' })), {
    happenedOn: '2019-03-09', precision: 'day', title: 'First ride', story: null,
  });
});

test('timeline refusals, in the database order', () => {
  assert.equal(historyProblem(null, entryIn(), [], positions, today), 'Sign in first.');
  assert.equal(historyProblem(member({ id: 'boss', approval: 'pending' }), entryIn(), [], positions, today), 'Only approved members can do that.');
  assert.equal(historyProblem(plain, entryIn(), [], positions, today), NOT_KEEPER);
  const entries = [entry({ id: 'e1' }), entry({ id: 'e2', archivedAt: '2026-01-01T00:00:00Z' })];
  assert.equal(historyProblem(boss, entryIn({ id: 'nope' }), entries, positions, today), ENTRY_GONE);
  assert.equal(historyProblem(boss, entryIn({ id: 'e2' }), entries, positions, today), ENTRY_OFF);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '2019-02-30' }), [], positions, today), BAD_HISTORY_DATE);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '' }), [], positions, today), BAD_HISTORY_DATE);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '2026-10-28' }), [], positions, today), BAD_HISTORY_DATE);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '2026-10-27' }), [], positions, today), null);
  assert.equal(historyProblem(boss, entryIn({ precision: 'week' as never }), [], positions, today), BAD_HISTORY_DATE);
  assert.equal(historyProblem(boss, entryIn({ title: '  ' }), [], positions, today), NO_TITLE);
  assert.equal(historyProblem(boss, entryIn({ title: 'x'.repeat(81) }), [], positions, today), 'Keep the title to 80 characters at most.');
  assert.equal(historyProblem(boss, entryIn({ story: 's'.repeat(1001) }), [], positions, today), 'Keep the story to 1,000 characters at most.');
  // The date comes before the title.
  assert.equal(historyProblem(boss, entryIn({ happenedOn: 'x', title: '' }), [], positions, today), BAD_HISTORY_DATE);
});

test('taking an entry off: the board, once', () => {
  const entries = [entry({ id: 'e1' }), entry({ id: 'e2', archivedAt: '2026-01-01T00:00:00Z' })];
  assert.equal(archiveEntryProblem(boss, 'e1', entries, positions), null);
  assert.equal(archiveEntryProblem(plain, 'e1', entries, positions), NOT_KEEPER);
  assert.equal(archiveEntryProblem(boss, 'e2', entries, positions), ENTRY_OFF_ALREADY);
  assert.equal(archiveEntryProblem(boss, 'nope', entries, positions), ENTRY_GONE);
});

test('honours: a member or a typed name, the honour, a year from 2019', () => {
  const members = [boss, plain];
  assert.equal(honourProblem(boss, honourIn(), [], members, positions, today), null);
  assert.equal(honourProblem(boss, honourIn({ memberId: null, name: 'Old Mate' }), [], members, positions, today), null);
  assert.equal(honourProblem(plain, honourIn(), [], members, positions, today), NOT_KEEPER);
  const honours = [honour({ id: 'h1' }), honour({ id: 'h2', archivedAt: '2026-01-01T00:00:00Z' })];
  assert.equal(honourProblem(boss, honourIn({ id: 'nope' }), honours, members, positions, today), HONOUR_GONE);
  assert.equal(honourProblem(boss, honourIn({ id: 'h2' }), honours, members, positions, today), HONOUR_OFF);
  assert.equal(honourProblem(boss, honourIn({ memberId: null, name: '  ' }), [], members, positions, today), NO_HONOUR_WHO);
  assert.equal(honourProblem(boss, honourIn({ memberId: 'plain', name: 'Also' }), [], members, positions, today), NO_HONOUR_WHO);
  assert.equal(honourProblem(boss, honourIn({ memberId: 'ghost' }), [], members, positions, today), NO_SUCH_MEMBER);
  assert.equal(honourProblem(boss, honourIn({ memberId: null, name: 'n'.repeat(81) }), [], members, positions, today), 'Keep the name to 80 characters at most.');
  assert.equal(honourProblem(boss, honourIn({ honour: ' ' }), [], members, positions, today), HONOUR_NO_NAME);
  assert.equal(honourProblem(boss, honourIn({ honour: 'h'.repeat(61) }), [], members, positions, today), 'Keep the honour to 60 characters at most.');
  assert.equal(honourProblem(boss, honourIn({ year: 2018 }), [], members, positions, today), BAD_YEAR);
  assert.equal(honourProblem(boss, honourIn({ year: 2027 }), [], members, positions, today), BAD_YEAR);
  assert.equal(honourProblem(boss, honourIn({ year: 2020.5 }), [], members, positions, today), BAD_YEAR);
  assert.equal(honourProblem(boss, honourIn({ year: 2026 }), [], members, positions, today), null);
  assert.equal(honourProblem(boss, honourIn({ note: 'n'.repeat(301) }), [], members, positions, today), 'Keep the note to 300 characters at most.');
  assert.deepEqual(cleanHonour(honourIn({ memberId: null, name: ' Old Mate ', honour: ' Life member ', note: ' ' })), {
    memberId: null, name: 'Old Mate', honour: 'Life member', year: 2024, note: null,
  });
});

test('taking an honour off: the board, once', () => {
  const honours = [honour({ id: 'h1' }), honour({ id: 'h2', archivedAt: '2026-01-01T00:00:00Z' })];
  assert.equal(archiveHonourProblem(boss, 'h1', honours, positions), null);
  assert.equal(archiveHonourProblem(plain, 'h1', honours, positions), NOT_KEEPER);
  assert.equal(archiveHonourProblem(boss, 'h2', honours, positions), HONOUR_OFF_ALREADY);
  assert.equal(archiveHonourProblem(boss, 'nope', honours, positions), HONOUR_GONE);
});

test('the timeline: the founding first, then oldest first, by year, nothing taken off', () => {
  const ps = [pos('f1', 'boss', 'founder', null, '2019-03-09'), pos('f2', 'plain', 'founder', null, '2019-04-01')];
  const entries = [
    entry({ id: 'b', happenedOn: '2021-06-01', precision: 'month', title: 'First Big 4' }),
    entry({ id: 'a', happenedOn: '2019-05-11', precision: 'day', title: 'First ride' }),
    entry({ id: 'c', happenedOn: '2021-01-01', precision: 'year', title: 'North chapter' }),
    entry({ id: 'gone', happenedOn: '2020-01-01', archivedAt: '2026-01-01T00:00:00Z' }),
  ];
  const years = timeline(entries, ps);
  assert.deepEqual(
    years.map((y) => [y.year, y.entries.map((e) => e.id)]),
    [
      [2019, ['founded', 'a']],
      [2021, ['c', 'b']],
    ],
  );
  assert.equal(years[0].entries[0].title, 'The club is founded');
  assert.equal(years[0].entries[0].happenedOn, '2019-03-09');
  assert.deepEqual(timeline([], []), []);
});

test('date labels by precision', () => {
  assert.equal(historyDateLabel({ happenedOn: '2019-03-09', precision: 'day' }), '09/03/2019');
  assert.equal(historyDateLabel({ happenedOn: '2019-03-09', precision: 'month' }), 'March 2019');
  assert.equal(historyDateLabel({ happenedOn: '2019-03-09', precision: 'year' }), '2019');
});

test('founders and past office holders come from the positions', () => {
  const members = [boss, plain, member({ id: 'ann', fullName: 'Ann' })];
  const ps = [
    pos('f1', 'plain', 'founder', null, '2019-03-09'),
    pos('f2', 'boss', 'founder', null, '2019-03-09'),
    pos('n1', 'boss', 'president', 'ch-west', '2019-03-09', '2023-08-19'),
    pos('n2', 'ann', 'president', 'ch-west', '2023-08-19', '2025-08-16'),
    pos('n3', 'ann', 'treasurer', 'ch-west', '2020-01-01', '2020-12-31'),
    pos('now', 'boss', 'president', 'ch-west', '2025-08-16'),
  ];
  assert.deepEqual(founders(members, ps).map((m) => m.id), ['boss', 'plain']);
  const past = pastOfficeHolders(members, ps);
  assert.deepEqual(
    past.map((g) => [g.role, g.holders.map((h) => [h.member?.id ?? null, yearsLabel(h.startedOn, h.endedOn)])]),
    [
      ['president', [['ann', '2023 to 2025'], ['boss', '2019 to 2023']]],
      ['treasurer', [['ann', '2020']]],
    ],
  );
});

test('honours shown: not taken off, newest year first', () => {
  const list = [honour({ id: 'a', year: 2022 }), honour({ id: 'b', year: 2025 }), honour({ id: 'c', archivedAt: 'x' })];
  assert.deepEqual(honoursFor(list).map((h) => h.id), ['b', 'a']);
});

test('edge cases: emoji count as one, leap days, year one, keeping a member who has left', () => {
  assert.equal(historyProblem(boss, entryIn({ title: '🏍'.repeat(80) }), [], positions, today), null);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '2020-02-29' }), [], positions, today), null);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '2021-02-29' }), [], positions, today), BAD_HISTORY_DATE);
  assert.equal(historyProblem(boss, entryIn({ happenedOn: '0000-06-01' }), [], positions, today), BAD_HISTORY_DATE);
  assert.equal(honourProblem(boss, honourIn({ memberId: null, name: 'n'.repeat(80) }), [], [boss], positions, today), null);
  const honours = [honour({ id: 'h1', memberId: 'gone' })];
  assert.equal(honourProblem(boss, honourIn({ id: 'h1', memberId: 'gone' }), honours, [boss], positions, today), null);
  assert.equal(honourProblem(boss, honourIn({ id: 'h1', memberId: 'ghost' }), honours, [boss], positions, today), NO_SUCH_MEMBER);
});
