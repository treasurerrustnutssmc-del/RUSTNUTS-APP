import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_BUILD_PHOTO,
  BUILD_EMPTY,
  BUILD_TAKEN_DOWN_ALREADY,
  NO_BIKE,
  NO_UPDATE,
  NOT_BIKE_OWNER,
  NOT_POSTER_OR_BOARD,
  NOT_PROJECT,
  TOO_MANY_BUILD_PHOTOS,
  bikeLabel,
  buildPostProblem,
  buildTakeDownProblem,
  buildsFor,
  cleanBuildPost,
  type BuildUpdate,
} from './builds';
import type { Bike, Member, Position } from '../types';

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

const me = member({ id: 'me' });
const other = member({ id: 'other' });
const boss = member({ id: 'boss' });
const president: Position = { id: 'p1', memberId: 'boss', role: 'president', chapterId: 'ch-west', startedOn: '2025-01-01', endedOn: null };

const bike = (b: Partial<Bike> & Pick<Bike, 'id' | 'memberId'>): Bike => ({
  make: 'Honda', model: 'CB750', year: 1978, nickname: null, isProject: true, ...b,
});
const bikes = [bike({ id: 'mine', memberId: 'me' }), bike({ id: 'theirs', memberId: 'other' }), bike({ id: 'road', memberId: 'me', isProject: false })];

const update = (u: Partial<BuildUpdate> & Pick<BuildUpdate, 'id' | 'bikeId' | 'authorId'>): BuildUpdate => ({
  body: 'Carbs off', photos: [], postedAt: '2026-10-20T01:00:00Z', takenDownAt: null, ...u,
});

const post = (over: Partial<{ bikeId: string; body: string; photos: { path: string; width: number; height: number }[] }> = {}) => ({
  bikeId: 'mine', body: 'Stripped the carbs.', photos: [], ...over,
});

test('the owner posts on a project bike, trimmed', () => {
  assert.equal(buildPostProblem(me, post(), bikes, []), null);
  assert.deepEqual(cleanBuildPost(post({ body: '  Done  ' })), { bikeId: 'mine', body: 'Done', photos: [] });
  assert.equal(cleanBuildPost(post({ body: '   ' })).body, null);
});

test('refusals, in the database order', () => {
  assert.equal(buildPostProblem(null, post(), bikes, []), 'Sign in first.');
  assert.equal(buildPostProblem(member({ id: 'me', approval: 'pending' }), post(), bikes, []), 'Only approved members can do that.');
  assert.equal(buildPostProblem(me, post({ bikeId: 'nope' }), bikes, []), NO_BIKE);
  assert.equal(buildPostProblem(me, post({ bikeId: 'theirs' }), bikes, []), NOT_BIKE_OWNER);
  assert.equal(buildPostProblem(me, post({ bikeId: 'road' }), bikes, []), NOT_PROJECT);
  assert.equal(buildPostProblem(me, post({ body: '  ' }), bikes, []), BUILD_EMPTY);
  assert.equal(buildPostProblem(me, post({ body: 'x'.repeat(2001) }), bikes, []), 'Keep it to 2,000 characters at most.');
  assert.equal(buildPostProblem(me, post({ body: 'x'.repeat(2000) }), bikes, []), null);
  const five = Array.from({ length: 5 }, (_, i) => ({ path: `me/${i}.jpg`, width: 1, height: 1 }));
  assert.equal(buildPostProblem(me, post({ photos: five }), bikes, []), TOO_MANY_BUILD_PHOTOS);
  // Photos alone are fine.
  assert.equal(buildPostProblem(me, post({ body: '', photos: five.slice(0, 1) }), bikes, []), null);
  // The bike checks come before the words.
  assert.equal(buildPostProblem(me, post({ bikeId: 'theirs', body: '' }), bikes, []), NOT_BIKE_OWNER);
});

test('photos: your own folder, not on another update, not twice', () => {
  const p = (path: string) => ({ path, width: 1, height: 1 });
  assert.equal(buildPostProblem(me, post({ photos: [p('other/a.jpg')] }), bikes, []), BAD_BUILD_PHOTO);
  assert.equal(buildPostProblem(me, post({ photos: [p('me/a.jpg'), p('me/a.jpg')] }), bikes, []), BAD_BUILD_PHOTO);
  const used = [update({ id: 'u1', bikeId: 'mine', authorId: 'me', photos: [p('me/a.jpg')], takenDownAt: '2026-10-21T00:00:00Z' })];
  assert.equal(buildPostProblem(me, post({ photos: [p('me/a.jpg')] }), bikes, used), BAD_BUILD_PHOTO);
});

test('taking down: whoever posted it or the board, once', () => {
  const updates = [update({ id: 'u1', bikeId: 'mine', authorId: 'me' }), update({ id: 'u2', bikeId: 'mine', authorId: 'me', takenDownAt: '2026-10-21T00:00:00Z' })];
  assert.equal(buildTakeDownProblem(me, 'u1', updates, []), null);
  assert.equal(buildTakeDownProblem(boss, 'u1', updates, [president]), null);
  assert.equal(buildTakeDownProblem(other, 'u1', updates, []), NOT_POSTER_OR_BOARD);
  assert.equal(buildTakeDownProblem(me, 'u2', updates, []), BUILD_TAKEN_DOWN_ALREADY);
  assert.equal(buildTakeDownProblem(me, 'nope', updates, []), NO_UPDATE);
  assert.equal(buildTakeDownProblem(null, 'u1', updates, []), 'Sign in first.');
});

test('the builds a member sees: latest first, only what is up, nothing blocked or suspended', () => {
  const suspended = member({ id: 'sus', approval: 'suspended' });
  const blocked = member({ id: 'blk' });
  const allBikes = [...bikes, bike({ id: 'sus-bike', memberId: 'sus' }), bike({ id: 'blk-bike', memberId: 'blk' }), bike({ id: 'quiet', memberId: 'other' })];
  const updates = [
    update({ id: 'a', bikeId: 'theirs', authorId: 'other', postedAt: '2026-10-01T00:00:00Z' }),
    update({ id: 'b', bikeId: 'theirs', authorId: 'other', postedAt: '2026-10-25T00:00:00Z' }),
    update({ id: 'c', bikeId: 'mine', authorId: 'me', postedAt: '2026-10-10T00:00:00Z' }),
    update({ id: 'd', bikeId: 'mine', authorId: 'me', postedAt: '2026-10-26T00:00:00Z', takenDownAt: '2026-10-27T00:00:00Z' }),
    update({ id: 'e', bikeId: 'sus-bike', authorId: 'sus' }),
    update({ id: 'f', bikeId: 'blk-bike', authorId: 'blk' }),
    // Still shown once a bike stops being a project.
    update({ id: 'g', bikeId: 'road', authorId: 'me', postedAt: '2026-09-01T00:00:00Z' }),
  ];
  const seen = buildsFor(me, [me, other, suspended, blocked], allBikes, updates, [{ blockerId: 'blk', blockedId: 'me' }]);
  assert.deepEqual(
    seen.map((b) => [b.bike.id, b.updates.map((u) => u.id)]),
    [
      ['theirs', ['b', 'a']],
      ['mine', ['c']],
      ['road', ['g']],
    ],
  );
  assert.deepEqual(buildsFor(null, [me], allBikes, updates, []), []);
  assert.deepEqual(buildsFor(member({ id: 'p', approval: 'pending' }), [me], allBikes, updates, []), []);
});

test('a bike is named by its nickname, or make and model', () => {
  assert.equal(bikeLabel(bike({ id: 'x', memberId: 'me', nickname: 'The Resurrection' })), 'The Resurrection');
  assert.equal(bikeLabel(bike({ id: 'x', memberId: 'me' })), '1978 Honda CB750');
  assert.equal(bikeLabel(bike({ id: 'x', memberId: 'me', year: null })), 'Honda CB750');
});
