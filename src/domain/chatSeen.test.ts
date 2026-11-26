import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastOwnMessage, seenBy, seenLine, seenWhen, type SeenRead } from './chatSeen';

const msg = { id: 'x', authorId: 'me', createdAt: '2026-11-26T03:00:00.000Z', removedAt: null };
const names: Record<string, string> = { a: 'Cobra', b: 'Spanner', c: 'Wes', d: 'Nora', e: 'Len' };
const nameOf = (id: string) => names[id] ?? 'Former member';

test('seen is anyone who opened the chat at or after the message; the rest have not seen it yet', () => {
  const reads: SeenRead[] = [
    { memberId: 'a', seenAt: '2026-11-26T03:05:00.000Z' },
    { memberId: 'b', seenAt: '2026-11-26T02:59:59.000Z' }, // opened it just before
    { memberId: 'c', seenAt: null }, // never opened it
    { memberId: 'd', seenAt: '2026-11-26T03:00:00.000Z' }, // the same moment counts
  ];
  const s = seenBy(msg, reads);
  assert.deepEqual(s.seen, [
    { memberId: 'd', at: '2026-11-26T03:00:00.000Z' },
    { memberId: 'a', at: '2026-11-26T03:05:00.000Z' },
  ]);
  assert.deepEqual(s.notYet, ['b', 'c']);
});

test('the author is never on their own list, and times from the database compare as times', () => {
  const reads: SeenRead[] = [
    { memberId: 'me', seenAt: '2026-11-26T04:00:00.000Z' },
    { memberId: 'a', seenAt: '2026-11-26T03:00:00.5+00:00' },
  ];
  const s = seenBy(msg, reads);
  assert.deepEqual(s.seen.map((r) => r.memberId), ['a']);
  assert.deepEqual(s.notYet, []);
});

test('a one-to-one chat says Seen and when, or Not seen yet', () => {
  const today = '2026-11-26';
  assert.equal(seenLine(seenBy(msg, [{ memberId: 'a', seenAt: '2026-11-26T03:05:00.000Z' }]), 'direct', nameOf, today), 'Seen 2:05 pm');
  assert.equal(seenLine(seenBy(msg, [{ memberId: 'a', seenAt: null }]), 'direct', nameOf, today), 'Not seen yet');
});

test('a chat of a few names them; a big one counts; everyone or nobody says so', () => {
  const today = '2026-11-26';
  const at = '2026-11-26T03:05:00.000Z';
  const r = (ids: string[], unseen: string[]): SeenRead[] => [
    ...ids.map((memberId) => ({ memberId, seenAt: at })),
    ...unseen.map((memberId) => ({ memberId, seenAt: null })),
  ];
  assert.equal(seenLine(seenBy(msg, r(['a'], ['b'])), 'group', nameOf, today), 'Seen by Cobra');
  assert.equal(seenLine(seenBy(msg, r(['a', 'b'], ['c'])), 'club', nameOf, today), 'Seen by Cobra and Spanner');
  assert.equal(seenLine(seenBy(msg, r(['a', 'b', 'c'], ['d'])), 'club', nameOf, today), 'Seen by Cobra, Spanner and Wes');
  assert.equal(seenLine(seenBy(msg, r(['a', 'b', 'c', 'd'], ['e'])), 'club', nameOf, today), 'Seen by 4 of 5');
  assert.equal(seenLine(seenBy(msg, r(['a', 'b'], [])), 'board', nameOf, today), 'Seen by everyone');
  assert.equal(seenLine(seenBy(msg, r([], ['a', 'b'])), 'club', nameOf, today), 'Not seen yet');
  // Nobody else reads the chat: nothing to say.
  assert.equal(seenLine(seenBy(msg, []), 'group', nameOf, today), null);
});

test('when someone saw it: the time today, Yesterday and the time, or the date and time', () => {
  const today = '2026-11-26';
  assert.equal(seenWhen('2026-11-26T03:05:00.000Z', today), '2:05 pm');
  assert.equal(seenWhen('2026-11-25T03:05:00.000Z', today), 'Yesterday 2:05 pm');
  assert.equal(seenWhen('2026-11-20T03:05:00.000Z', today), '20/11/2026 2:05 pm');
});

test('the line goes under my newest message that is still there', () => {
  const messages = [
    { id: '1', authorId: 'me', createdAt: '2026-11-26T01:00:00.000Z', removedAt: null },
    { id: '2', authorId: 'a', createdAt: '2026-11-26T02:00:00.000Z', removedAt: null },
    { id: '3', authorId: 'me', createdAt: '2026-11-26T03:00:00.000Z', removedAt: '2026-11-26T03:01:00.000Z' },
  ];
  assert.equal(lastOwnMessage(messages, 'me')?.id, '1');
  assert.equal(lastOwnMessage(messages, 'b'), undefined);
});
