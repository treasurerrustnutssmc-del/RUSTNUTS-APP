import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoStory.testkit';
import * as act from './boardFileActions';
import type { DemoCtx } from './demoActions';
import type { ClubData } from '../domain/types';

const blank: ClubData = { ...DEMO_DATA, boardFiles: [] };
const me = (id: string) => blank.members.find((m) => m.id === id)!;
const NOW = '2026-10-25T01:00:00.000Z';
const ctx = (who: string, data: ClubData = blank): DemoCtx => ({ data, me: me(who), today: '2026-10-25', now: NOW });
const WEST_TREASURER = { chapterId: 'ch-west', role: 'treasurer' as const };

test('board files in the demo: added to a seat, refused for others, then removed', () => {
  const pick = { name: ' Budget ', size: 2000, mimeType: 'application/vnd.ms-excel', uri: 'file:///budget.xls' };
  assert.throws(() => act.addBoardFile(ctx('m-torque'), WEST_TREASURER, pick), /Only whoever holds this seat/);
  assert.throws(() => act.addBoardFile(ctx('m-chook'), WEST_TREASURER, pick), /board members and the NEC/);
  assert.throws(() => act.addBoardFile(ctx('m-sparks'), WEST_TREASURER, { ...pick, name: 'x.zip', mimeType: null }), /Pick a PDF/);
  const added = act.addBoardFile(ctx('m-sparks'), WEST_TREASURER, pick);
  const f = added.data.boardFiles!.find((x) => x.id === added.id)!;
  assert.deepEqual(
    [f.chapterId, f.role, f.path, f.name, f.sizeBytes, f.addedBy, f.addedAt],
    ['ch-west', 'treasurer', 'file:///budget.xls', 'Budget.xls', 2000, 'm-sparks', NOW],
  );
  assert.throws(() => act.removeBoardFile(ctx('m-torque', added.data), added.id), /Only whoever holds this seat/);
  const removed = act.removeBoardFile(ctx('m-rusty', added.data), added.id);
  assert.deepEqual(removed.boardFiles, []);
});

test('the live read becomes board files', () => {
  assert.deepEqual(
    act.toBoardFiles([{
      id: 'b1', chapter_id: null, role: null, path: 'club/info/a.pdf', name: 'A.pdf', size_bytes: '12' as unknown as number,
      added_by: 'm1', added_at: '2026-11-24T01:00:00+00:00',
    }]),
    [{ id: 'b1', chapterId: null, role: null, path: 'club/info/a.pdf', name: 'A.pdf', sizeBytes: 12, addedBy: 'm1', addedAt: '2026-11-24T01:00:00.000Z' }],
  );
  assert.deepEqual(act.toBoardFiles(null), []);
});

test('the demo’s own files say they don’t open', () => {
  assert.equal(act.demoBoardFileUrl('file:///budget.xls'), 'file:///budget.xls');
  assert.throws(() => act.demoBoardFileUrl('demo/club/insurance.pdf'), /demo’s own files/);
});
