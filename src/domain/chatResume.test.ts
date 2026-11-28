import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstNewMessage } from './chatResume';

const at = (m: number) => new Date(Date.UTC(2026, 10, 28, 1, m)).toISOString();
const msg = (id: string, authorId: string, m: number, removed = false) => ({ id, authorId, createdAt: at(m), removedAt: removed ? at(m + 1) : null });

test('nothing new: no place to open at', () => {
  assert.deepEqual(firstNewMessage([msg('1', 'a', 0)], 'me', 0), null);
});

test('opens at the oldest of the new ones, counting only other people\'s messages that are still there', () => {
  const messages = [
    msg('1', 'a', 0),
    msg('2', 'b', 1), // first new
    msg('3', 'c', 2, true), // removed: not counted
    msg('4', 'a', 3),
    msg('5', 'b', 4),
  ];
  assert.deepEqual(firstNewMessage(messages, 'me', 3), { messageId: '2', complete: true });
});

test('works whatever order the messages come in', () => {
  const messages = [msg('5', 'b', 4), msg('1', 'a', 0), msg('4', 'a', 3)];
  assert.deepEqual(firstNewMessage(messages, 'me', 2), { messageId: '4', complete: true });
});

test('more new than are loaded: the oldest loaded, and says older ones are still to load', () => {
  const messages = [msg('1', 'a', 0), msg('2', 'b', 1)];
  assert.deepEqual(firstNewMessage(messages, 'me', 5), { messageId: '1', complete: false });
});

test('my own messages are never the place to open at', () => {
  const messages = [msg('1', 'me', 0), msg('2', 'me', 1)];
  assert.equal(firstNewMessage(messages, 'me', 1), null);
});
