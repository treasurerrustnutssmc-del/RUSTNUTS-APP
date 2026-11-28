import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastOwnMessage, readTags, seenBy, seenLine, seenWhen, withOwnPosts, type SeenRead } from './chatSeen';

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
  // Most recently in the chat first.
  assert.deepEqual(s.seen, [
    { memberId: 'a', at: '2026-11-26T03:05:00.000Z' },
    { memberId: 'd', at: '2026-11-26T03:00:00.000Z' },
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

test('a one-to-one chat says Seen or Not seen yet (their last look is no time to pin on the message)', () => {
  const today = '2026-11-26';
  assert.equal(seenLine(seenBy(msg, [{ memberId: 'a', seenAt: '2026-11-26T03:05:00.000Z' }]), 'direct', nameOf, today), 'Seen');
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

test('Messenger-style tags: each person sits under the last message they have seen, latest look first', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 26, 3, m)).toISOString();
  const messages = [
    { id: '1', authorId: 'me', createdAt: at(0), removedAt: null },
    { id: '2', authorId: 'a', createdAt: at(10), removedAt: null },
    { id: '3', authorId: 'me', createdAt: at(20), removedAt: at(21) }, // removed: tags skip back past it
    { id: '4', authorId: 'b', createdAt: at(30), removedAt: null },
  ];
  const reads: SeenRead[] = [
    { memberId: 'a', seenAt: at(12) }, // saw 1 and 2 (2 is a's own)
    { memberId: 'c', seenAt: at(25) }, // saw up to 3, which is removed: tag under 2
    { memberId: 'b', seenAt: at(30) }, // saw everything (posted the last one)
    { memberId: 'd', seenAt: at(15) }, // also under 2, but looked later than a
    { memberId: 'e', seenAt: null }, // never opened it: no tag
    { memberId: 'f', seenAt: '2026-11-25T00:00:00.000Z' }, // before anything loaded: no tag
  ];
  const tags = readTags(messages, reads);
  // b's last seen is b's own post, and a's is a's own: no tag for either.
  assert.deepEqual(Object.fromEntries(tags), { '2': ['c', 'd'] });
});

test('no tags without reads or messages', () => {
  assert.equal(readTags([], [{ memberId: 'a', seenAt: '2026-11-26T03:00:00.000Z' }]).size, 0);
  assert.equal(readTags([{ id: '1', authorId: 'me', createdAt: '2026-11-26T03:00:00.000Z', removedAt: null }], []).size, 0);
});

test('a newer post than their last look counts as seen up to it (the look is fetched less often than messages)', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 26, 3, m)).toISOString();
  const messages = [
    { id: '1', authorId: 'me', createdAt: at(0), removedAt: null },
    { id: '2', authorId: 'a', createdAt: at(10), removedAt: null },
  ];
  const reads = withOwnPosts([{ memberId: 'a', seenAt: at(1) }, { memberId: 'b', seenAt: null }, { memberId: 'c', seenAt: at(20) }], messages);
  assert.deepEqual(reads, [{ memberId: 'a', seenAt: at(10) }, { memberId: 'b', seenAt: null }, { memberId: 'c', seenAt: at(20) }]);
  // a's tag would have sat under 1, above a's own post; now there's none, and 1 counts as seen by a.
  assert.deepEqual(Object.fromEntries(readTags(messages, reads)), { '2': ['c'] });
  assert.deepEqual(seenBy(messages[0], reads).seen.map((r) => r.memberId), ['c', 'a']);
});

test('tags: a look at exactly a message\'s time counts, and every tag is kept for the +N count', () => {
  const t = '2026-11-26T03:00:00.000Z';
  const messages = [{ id: '1', authorId: 'me', createdAt: t, removedAt: null }];
  const reads = Array.from({ length: 9 }, (_, i) => ({ memberId: `m${i}`, seenAt: t }));
  assert.equal(readTags(messages, reads).get('1')?.length, 9);
});
