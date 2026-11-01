import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../domain/chat';
import { member } from '../domain/stage4.testkit';
import { demoCatchUp } from './catchUpDemo';

const msg = (id: string, authorId: string, body: string | null, over: Partial<Message> = {}): Message => ({
  id, conversationId: 'c', authorId, body, createdAt: `2026-11-01T0${id}:00:00.000Z`, removedAt: null, replyToId: null, media: [], reactions: [], ...over,
});

test('the demo summary names who talked, any mention of the member, and the latest message', () => {
  const me = member('me', { fullName: 'Tania Walsh', roadName: 'Torque' });
  const members = [me, member('a', { roadName: 'Spanner' }), member('b', { roadName: 'Sparks' })];
  const messages = [
    msg('1', 'a', 'Ride Sunday?'),
    msg('2', 'a', 'Torque can you bring the kit'),
    msg('3', 'b', 'Gone', { removedAt: '2026-11-01T04:00:00.000Z' }),
    msg('4', 'me', 'Yep'),
    msg('5', 'b', 'Coffee at Bacchus Marsh'),
  ];
  const got = demoCatchUp(messages, members, me, 8);
  assert.equal(got.count, 4);
  assert.match(got.summary, /Spanner mentioned you: “Torque can you bring the kit”/);
  assert.match(got.summary, /Mostly Spanner and Sparks talking/);
  assert.match(got.summary, /Latest from Sparks: “Coffee at Bacchus Marsh”/);
  assert.ok(!got.summary.includes('Gone'));
});
