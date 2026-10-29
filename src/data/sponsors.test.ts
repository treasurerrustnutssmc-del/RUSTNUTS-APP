import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_SPONSOR_KEEPER, SPONSOR_OFF_ALREADY, type SponsorInput } from '../domain/sponsors';
import type { Member, Position } from '../domain/types';
import { DEMO_SPONSORS, demoArchiveSponsor, demoSaveSponsor, saveSponsorArgs, toSponsors } from './sponsorsData';

const member = (id: string): Member => ({
  id,
  chapterId: 'ch-west',
  fullName: id,
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
});
const positions: Position[] = [{ id: 'p1', memberId: 'boss', role: 'treasurer', chapterId: 'ch-west', startedOn: '2025-01-01', endedOn: null }];
const boss = member('boss');
const input = (over: Partial<SponsorInput> = {}): SponsorInput => ({
  id: null, name: ' Tyre Shed ', blurb: '', url: '', deal: '', logoPath: null, chapterId: null, ...over,
});
const ctx = { me: boss, positions, chapterIds: ['ch-west'] };

test('the demo sponsors are clearly made up', () => {
  assert.ok(DEMO_SPONSORS.length > 0);
  for (const s of DEMO_SPONSORS) assert.match(s.name, /^Demo: /);
});

test('the demo adds, changes and takes off sponsors by the same rules', () => {
  const added = demoSaveSponsor([], ctx, input(), 'new-1');
  assert.equal(added.id, 'new-1');
  assert.equal(added.list[0].name, 'Tyre Shed');
  assert.equal(added.list[0].addedBy, 'boss');

  const changed = demoSaveSponsor(added.list, ctx, input({ id: 'new-1', deal: '10% off' }), 'unused');
  assert.equal(changed.id, 'new-1');
  assert.equal(changed.list.length, 1);
  assert.equal(changed.list[0].deal, '10% off');

  assert.throws(() => demoSaveSponsor([], { ...ctx, me: member('plain') }, input(), 'x'), { message: NOT_SPONSOR_KEEPER });

  const off = demoArchiveSponsor(changed.list, ctx, 'new-1', '2026-10-29T00:00:00Z');
  assert.equal(off[0].archivedAt, '2026-10-29T00:00:00Z');
  assert.throws(() => demoArchiveSponsor(off, ctx, 'new-1', 'now'), { message: SPONSOR_OFF_ALREADY });
});

test('live rows become sponsors, and a save sends what the database expects', () => {
  assert.deepEqual(
    toSponsors([
      { id: 's1', name: 'Tyre Shed', blurb: null, url: 'https://t.example', deal: '10% off', logo_path: 'm/a.png', chapter_id: null, added_by: null, archived_at: null },
    ]),
    [{ id: 's1', name: 'Tyre Shed', blurb: null, url: 'https://t.example', deal: '10% off', logoPath: 'm/a.png', chapterId: null, addedBy: '', archivedAt: null }],
  );
  assert.deepEqual(saveSponsorArgs(input({ id: 's1', chapterId: 'ch-west' }), 'm/b.png'), {
    p_id: 's1', p_name: ' Tyre Shed ', p_blurb: '', p_url: '', p_deal: '', p_logo_path: 'm/b.png', p_chapter: 'ch-west',
  });
});
