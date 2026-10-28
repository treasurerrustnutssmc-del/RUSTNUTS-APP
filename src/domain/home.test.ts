import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clubCounts, positionTitles } from './home';
import { ROLE_LABEL } from './labels';
import type { Chapter, Member, Position } from './types';

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

test('a seat in another chapter names that chapter; a home seat does not', () => {
  const titles = positionTitles([pos('a', 'secretary', 'ch-west'), pos('b', 'treasurer', 'ch-north')], chapters, 'ch-west', ROLE_LABEL);
  assert.deepEqual(titles.map((t) => t.text), ['Secretary', 'Treasurer (North)']);
  assert.deepEqual(titles.map((t) => t.key), ['a', 'b']);
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
