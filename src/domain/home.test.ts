import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import {
  chipLabel, clubCounts, coveredNotice, coveredStepDownNote, coverNote, longTitle, necRows, positionTitles, seatTitle, stepDownNote,
} from './home';
import { ROLE_LABEL, ROLE_SHORT } from './labels';
import type { Chapter, ClubData, Member, Position } from './types';

const chapters: Chapter[] = [
  { id: 'ch-west', slug: 'west', name: 'West', area: '', state: 'VIC' },
  { id: 'ch-north', slug: 'north', name: 'North', area: '', state: 'VIC' },
];
const pos = (id: string, role: Position['role'], chapterId: string | null): Position => ({
  id, memberId: 'm-jeff', chapterId, role, startedOn: '2025-01-01', endedOn: null,
});

test('a role held in two chapters shows once, naming both chapters', () => {
  const titles = positionTitles(
    [pos('a', 'founder', null), pos('b', 'nec_chair', null), pos('c', 'treasurer', 'ch-west'), pos('d', 'treasurer', 'ch-north')],
    chapters,
    'ch-west',
    ROLE_LABEL,
  );
  assert.deepEqual(titles.map((t) => t.text), [ROLE_LABEL.founder, ROLE_LABEL.nec_chair, 'Treasurer (West, North)']);
});

test('a chapter seat always names its chapter, home or not (West Pres, not just Pres)', () => {
  const titles = positionTitles([pos('a', 'secretary', 'ch-west'), pos('b', 'treasurer', 'ch-north')], chapters, 'ch-west', ROLE_LABEL);
  assert.deepEqual(titles.map((t) => t.text), ['Secretary (West)', 'Treasurer (North)']);
  assert.deepEqual(titles.map((t) => t.key), ['a', 'b']);
});

test('one seat names its own chapter, so two Treasurer seats read apart', () => {
  assert.equal(seatTitle(pos('c', 'treasurer', 'ch-west'), chapters, ROLE_LABEL), 'Treasurer (West)');
  assert.equal(seatTitle(pos('d', 'treasurer', 'ch-north'), chapters, ROLE_LABEL), 'Treasurer (North)');
  assert.equal(seatTitle(pos('b', 'nec_chair', null), chapters, ROLE_LABEL), ROLE_LABEL.nec_chair);
});

test('the short Treasurer badge reads as a word, not a cut-off one (TREAS, not TRE)', () => {
  const titles = positionTitles([pos('c', 'treasurer', 'ch-north'), pos('d', 'treasurer', 'ch-west')], chapters, 'ch-west', ROLE_SHORT);
  assert.deepEqual(titles.map((t) => t.text), ['TREAS (North, West)']);
});

const member = (id: string, chapterId: string, status: Member['status'], approval: Member['approval'] = 'approved'): Member => ({
  id, chapterId, fullName: id, roadName: null, status, approval, joinedOn: null, patchedOn: null, fngStartedOn: null,
  bio: null, sharePhone: false, appliedOn: null, onHiatus: false,
});

test('club counts include roster members who have not signed in yet', () => {
  const members = [
    member('jeff', 'ch-west', 'full'),
    member('applicant', 'ch-west', 'introduced', 'pending'),
    member('gone', 'ch-west', 'legacy'),
    member('mum', 'ch-west', 'family'),
  ];
  const counts = clubCounts(chapters, members, [
    { chapterId: 'ch-west', status: 'full', count: 12 },
    { chapterId: 'ch-west', status: 'fng', count: 6 },
    { chapterId: 'ch-west', status: 'nomad', count: 1 },
    { chapterId: 'ch-west', status: 'legacy', count: 3 },
    { chapterId: 'ch-north', status: 'full', count: 4 },
  ]);
  assert.deepEqual(counts.chapters, [
    { id: 'ch-west', name: 'West', count: 20 },
    { id: 'ch-north', name: 'North', count: 4 },
  ]);
  assert.equal(counts.patched, 18, 'Full and Nomad, signed in or not');
  assert.equal(counts.fngs, 6);
  assert.equal(counts.total, 24);
  assert.equal(counts.onApp, 1, 'only Jeff has signed in');
});

test('with no roster (the demo) the counts come from members alone', () => {
  const counts = clubCounts(chapters, [member('a', 'ch-north', 'fng'), member('b', 'ch-west', 'nomad')], []);
  assert.deepEqual(counts.chapters.map((c) => c.count), [1, 1]);
  assert.equal(counts.patched, 1);
  assert.equal(counts.fngs, 1);
  assert.equal(counts.onApp, counts.total);
});

test('club counts split each chapter into Patched, Nomads, FNGs and Legacy, with a club row', () => {
  const members = [
    member('jeff', 'ch-west', 'full'),
    member('kilroy', 'ch-west', 'nomad'),
    member('gone', 'ch-west', 'legacy'),
    member('mum', 'ch-west', 'family'),
    member('applicant', 'ch-north', 'fng', 'pending'),
  ];
  const counts = clubCounts(chapters, members, [
    { chapterId: 'ch-west', status: 'full', count: 12 },
    { chapterId: 'ch-west', status: 'fng', count: 6 },
    { chapterId: 'ch-west', status: 'legacy', count: 4 },
    { chapterId: 'ch-north', status: 'full', count: 4 },
    { chapterId: 'ch-north', status: 'nomad', count: 1 },
    { chapterId: 'ch-north', status: 'fng', count: 2 },
  ]);
  const row = (r: { patched: number; nomads: number; fngs: number; legacy: number }) => [r.patched, r.nomads, r.fngs, r.legacy];
  assert.deepEqual(counts.split.map((r) => [r.name, ...row(r)]), [
    ['West', 13, 1, 6, 5],
    ['North', 4, 1, 2, 0],
  ]);
  assert.deepEqual(row(counts.club), [17, 2, 8, 5], 'the pending applicant is not counted');
});

// Acting titles, the NEC list and the cover copy ----------------------------------------------------

// North: Smokey is President and Jet the VP. Jet covers Smokey until 13/12/2026.
const named = (id: string, roadName: string, chapterId = 'ch-north'): Member => ({ ...member(id, chapterId, 'full'), roadName, fullName: `${roadName} Rider` });
const people = [named('smokey', 'Smokey'), named('jet', 'Jet'), named('crank', 'Crank'), named('rusty', 'Rusty', 'ch-west'), named('spanner', 'Spanner', 'ch-west')];
const seat = (id: string, memberId: string, role: Position['role'], chapterId: string | null = 'ch-north', over: Partial<Position> = {}): Position => ({
  id, memberId, chapterId, role, startedOn: '2025-08-16', endedOn: null, ...over,
});
const smokeyPres = seat('smokey-pres', 'smokey', 'president');
const jetVp = seat('jet-vp', 'jet', 'vice_president');
const cover = (role: Position['role'], covers: string, memberId = 'jet') =>
  seat(`${memberId}-covers-${covers}`, memberId, role, 'ch-north', { startedOn: '2026-11-15', actingUntil: '2026-12-13', covers, actingWhy: 'Away', appointedBy: 'crank' });
const jetCovers = cover('president', 'smokey-pres');
const crankActingTreasurer = seat('crank-acting-tre', 'crank', 'treasurer', 'ch-north', { startedOn: '2026-11-15', actingUntil: '2026-12-13', actingWhy: 'No Treasurer since the ACM' });
const clubOf = (positions: Position[]): ClubData => ({ ...DEMO_DATA, chapters, members: people, positions });

test('positionTitles keeps acting apart: an acting and an elected Treasurer row never merge', () => {
  const titles = positionTitles([pos('w', 'treasurer', 'ch-west'), { ...pos('n', 'treasurer', 'ch-north'), actingUntil: '2026-12-13' }], chapters, 'ch-west', ROLE_LABEL);
  assert.deepEqual(titles, [
    { key: 'w', text: 'Treasurer (West)', until: null },
    { key: 'n', text: 'Acting Treasurer (North)', until: '13/12/2026' },
  ]);
});

test('a normal title has no until date, and short labels get a short Acting word', () => {
  assert.deepEqual(positionTitles([pos('c', 'secretary', 'ch-west')], chapters, 'ch-west', ROLE_LABEL), [{ key: 'c', text: 'Secretary (West)', until: null }]);
  assert.equal(positionTitles([crankActingTreasurer], chapters, 'ch-north', ROLE_SHORT)[0].text, 'ACTING TREAS (North)');
  assert.equal(seatTitle(crankActingTreasurer, chapters, ROLE_LABEL), 'Acting Treasurer (North)');
});

test('a covered holder’s title is unchanged', () => {
  assert.deepEqual(positionTitles([smokeyPres], chapters, 'ch-north', ROLE_LABEL), [{ key: 'smokey-pres', text: 'President (North)', until: null }]);
});

test('longTitle adds the until date; a normal title stays as it is', () => {
  const [acting] = positionTitles([crankActingTreasurer], chapters, 'ch-north', ROLE_LABEL);
  assert.equal(longTitle(acting), 'Acting Treasurer (North) until 13/12/2026');
  assert.equal(longTitle(positionTitles([smokeyPres], chapters, 'ch-north', ROLE_LABEL)[0]), 'President (North)');
});

test('chipLabel spells out an acting seat, and keeps the short form otherwise', () => {
  assert.equal(chipLabel(crankActingTreasurer, chapters), 'ACTING TREASURER (NORTH)');
  assert.equal(chipLabel(smokeyPres, chapters), 'PRES');
  assert.equal(chipLabel(pos('b', 'nec_chair', null), chapters), 'NEC CHAIR');
});

test('chipLabel short: a dense row (the Members list, a chat name) shortens the role but still says Acting', () => {
  // At 360 wide a Members list row has 216 px; ACTING TREASURER (NORTH) needs 229, ACTING TREAS (NORTH) 190.
  assert.equal(chipLabel(crankActingTreasurer, chapters, 'short'), 'ACTING TREAS (NORTH)');
  assert.equal(chipLabel(crankActingTreasurer, chapters, 'long'), 'ACTING TREASURER (NORTH)');
  assert.equal(chipLabel(smokeyPres, chapters, 'short'), 'PRES', 'a full term is already short');
});

test('the NEC list: one row per chapter for whoever casts its vote (11.2)', () => {
  const rustyPres = seat('rusty-pres', 'rusty', 'president', 'ch-west');
  const rustyChair = seat('rusty-chair', 'rusty', 'nec_chair', null);
  assert.deepEqual(necRows(clubOf([rustyPres, smokeyPres, jetVp])), [
    { chapterId: 'ch-west', text: 'Rusty, President (West)' },
    { chapterId: 'ch-north', text: 'Smokey, President (North)' },
  ]);
  assert.deepEqual(necRows(clubOf([smokeyPres, jetVp, jetCovers])), [
    { chapterId: 'ch-north', text: 'Jet, Acting President (North), for Smokey until 13/12/2026' },
  ]);
  const jetActing = seat('jet-acting', 'jet', 'president', 'ch-north', { startedOn: '2026-11-15', actingUntil: '2026-12-13', actingWhy: 'No President since the ACM' });
  assert.deepEqual(necRows(clubOf([jetVp, jetActing])), [{ chapterId: 'ch-north', text: 'Jet, Acting President (North) until 13/12/2026' }]);
  assert.deepEqual(necRows(clubOf([jetVp])), [{ chapterId: 'ch-north', text: 'Jet, Vice President (North)' }], 'the VP fallback');
  const spannerVp = seat('spanner-vp', 'spanner', 'vice_president', 'ch-west');
  assert.deepEqual(necRows(clubOf([rustyPres, rustyChair])), [{ chapterId: 'ch-west', text: 'Rusty, President (West)' }], 'the Chair who is also President, with no VP');
  assert.deepEqual(necRows(clubOf([rustyPres, rustyChair, spannerVp])), [{ chapterId: 'ch-west', text: 'Spanner, Vice President (West)' }], 'the Chair’s chapter votes through its VP');
});

test('coverNote says what moves to the stand-in and what the holder keeps', () => {
  const jet = people.find((m) => m.id === 'jet')!;
  const keep = 'You keep your seat, board vote, approvals and board records.';
  assert.equal(coverNote(smokeyPres, jet, '2026-12-13', clubOf([smokeyPres, jetVp])), `Jet chairs North and casts its NEC vote until 13/12/2026. ${keep} You’re off the NEC until then.`);
  const tre = seat('smokey-tre', 'smokey', 'treasurer');
  assert.equal(coverNote(tre, jet, '2026-12-13', clubOf([tre, jetVp])), `Jet keeps North’s books until 13/12/2026. ${keep}`);
  const sec = seat('smokey-sec', 'smokey', 'secretary');
  assert.equal(coverNote(sec, jet, '2026-12-13', clubOf([sec, jetVp])), `Jet does the Secretary’s duties for North until 13/12/2026. ${keep}`);
  const chair = seat('smokey-chair', 'smokey', 'nec_chair', null);
  assert.ok(!coverNote(smokeyPres, jet, '2026-12-13', clubOf([smokeyPres, chair, jetVp])).includes('off the NEC'), 'the National Chairman stays on the NEC');
});

test('the covered holder’s notice and step-down words', () => {
  assert.equal(
    coveredNotice(smokeyPres, jetCovers, clubOf([smokeyPres, jetVp, jetCovers])),
    'Jet is acting as President (North) until 13/12/2026. Until then Jet chairs and casts North’s NEC vote. You keep your seat and board vote.',
  );
  const tre = seat('smokey-tre', 'smokey', 'treasurer');
  const treCover = cover('treasurer', 'smokey-tre');
  assert.equal(
    coveredNotice(tre, treCover, clubOf([tre, jetVp, treCover])),
    'Jet is acting as Treasurer (North) until 13/12/2026. Until then Jet keeps North’s books. You keep your seat and board vote.',
  );
  const sec = seat('smokey-sec', 'smokey', 'secretary');
  const secCover = cover('secretary', 'smokey-sec');
  assert.equal(
    coveredNotice(sec, secCover, clubOf([sec, jetVp, secCover])),
    'Jet is acting as Secretary (North) until 13/12/2026. Until then Jet does the Secretary’s duties for North. You keep your seat and board vote.',
  );
  assert.equal(
    coveredStepDownNote(jetCovers, clubOf([smokeyPres, jetVp, jetCovers])),
    'This ends Jet’s acting too. If you’re re-elected and still away, arrange a new cover.',
  );
});

test('the step-down note says what else ends with the row', () => {
  const data = clubOf([smokeyPres, jetVp, jetCovers]);
  // The covered holder: the cover rests on his seat.
  assert.equal(stepDownNote(smokeyPres, data), coveredStepDownNote(jetCovers, data));
  // The stand-in: his cover rests on his last board seat in North (left_board).
  assert.equal(stepDownNote(jetVp, data), 'This ends your acting as President (North) for Smokey too.');
  // A cover of another seat rests on his last board seat only: with a Secretary seat as well, it stays.
  const tre = seat('smokey-tre', 'smokey', 'treasurer');
  const treCover = cover('treasurer', 'smokey-tre');
  const jetSec = seat('jet-sec', 'jet', 'secretary');
  assert.equal(stepDownNote(jetVp, clubOf([tre, jetVp, treCover])), 'This ends your acting as Treasurer (North) for Smokey too.');
  assert.equal(stepDownNote(jetVp, clubOf([tre, jetVp, jetSec, treCover])), undefined, 'he keeps a board seat, so the cover stays');
  // A President stint with no vote behind it, a cover or an empty seat, rests on his VP row (8.2).
  assert.equal(stepDownNote(jetVp, clubOf([smokeyPres, jetVp, jetSec, jetCovers])), 'This ends your acting as President (North) for Smokey too.');
  const jetActing = seat('jet-acting', 'jet', 'president', 'ch-north', { startedOn: '2026-11-15', actingUntil: '2026-12-13', actingWhy: 'No President since the ACM' });
  assert.equal(stepDownNote(jetVp, clubOf([jetVp, jetSec, jetActing])), 'This ends your acting as President (North) too.');
  assert.equal(stepDownNote(jetActing, clubOf([jetVp, jetActing])), undefined, 'a stint ends alone');
  assert.equal(stepDownNote(seat('smokey-tg', 'smokey', 'tail_gunner'), data), undefined);
});
