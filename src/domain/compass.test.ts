import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import { compassFor } from './compass';
import type { Position } from './types';

const d = DEMO_DATA;
const m = (id: string) => d.members.find((x) => x.id === id)!;

test('a member wears the compass of their chapter', () => {
  assert.equal(compassFor(m('m-spanner'), d), 'west');
  assert.equal(compassFor({ ...m('m-spanner'), chapterId: 'ch-north' }, d), 'north');
});

test('a sitting President still wears their own chapter, not national', () => {
  assert.ok(d.positions.some((p) => p.memberId === 'm-smokey' && p.role === 'president' && p.endedOn === null), 'Smokey is North President');
  assert.equal(compassFor(m('m-smokey'), d), 'north');
});

test('the NEC officers wear the national compass', () => {
  assert.equal(compassFor(m('m-rusty'), d), 'national', 'National Chairman');
  for (const role of ['nec_secretary', 'nec_auditor'] as const) {
    const positions: Position[] = [
      ...d.positions,
      { id: 'x', memberId: 'm-spanner', chapterId: null, role, startedOn: '2026-01-01', endedOn: null },
    ];
    assert.equal(compassFor(m('m-spanner'), { ...d, positions }), 'national', role);
  }
});

test('a finished NEC term goes back to the chapter compass', () => {
  const positions = d.positions.map((p) => (p.memberId === 'm-rusty' && p.role === 'nec_chair' ? { ...p, endedOn: '2026-08-15' } : p));
  assert.equal(compassFor(m('m-rusty'), { ...d, positions }), 'west');
});

test('a chapter with no compass patch yet gets the plain disc', () => {
  const chapters = [...d.chapters, { id: 'ch-east', slug: 'east', name: 'East', area: 'Eastern Melbourne', state: 'VIC' }];
  assert.equal(compassFor({ ...m('m-spanner'), chapterId: 'ch-east' }, { ...d, chapters }), 'plain');
});
