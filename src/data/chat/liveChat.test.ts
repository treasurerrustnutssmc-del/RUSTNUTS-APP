import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../../domain/chat';
import { goneMedia, mergeMessages, toFeedItem, toMessage, toReport, toRide, toSummaryParts, uploadName, voiceUploadType } from './liveChat';

const rideRow = {
  id: 'r1', title: 'Coffee run', starts_at: '2026-11-07T21:30:00+00:00', ends_at: null, all_day: false,
  location: 'Laverton', notes: null, category: 'west', cancelled_at: null,
} as const;

test('a message row becomes a message, its photos in order and reactions attached', () => {
  const m = toMessage({
    id: 'm1', conversation_id: 'c1', author_id: 'a1', body: 'G’day', reply_to_id: null,
    created_at: '2026-10-24T01:00:00.5+00:00', removed_at: null,
    message_media: [
      { id: 'x2', message_id: 'm1', kind: 'video', path: 'c1/v.mp4', poster_path: 'c1/p.jpg', width: 1080, height: 1920, duration_ms: 12000, position: 1 },
      { id: 'x1', message_id: 'm1', kind: 'photo', path: 'c1/a.jpg', poster_path: null, width: 2048, height: 1536, duration_ms: null, position: 0 },
    ],
    message_reactions: [{ message_id: 'm1', member_id: 'a2', emoji: '🍺' }],
  });
  assert.equal(m.createdAt, '2026-10-24T01:00:00.500Z');
  assert.deepEqual(m.media.map((x) => [x.id, x.posterPath, x.durationMs]), [['x1', null, null], ['x2', 'c1/p.jpg', 12000]]);
  assert.deepEqual(m.reactions, [{ messageId: 'm1', memberId: 'a2', emoji: '🍺' }]);
});

test('a removed message keeps no words or photos, whatever comes back', () => {
  const m = toMessage({
    id: 'm1', conversation_id: 'c1', author_id: 'a1', body: 'oops', reply_to_id: null, created_at: '2026-10-24T01:00:00Z',
    removed_at: '2026-10-24T02:00:00Z', message_media: [], message_reactions: [],
  });
  assert.equal(m.body, null);
  assert.equal(m.removedAt, '2026-10-24T02:00:00.000Z');
});

test('a chat-list entry gives its chat, ride, last message and unread count', () => {
  const parts = toSummaryParts({
    id: 'c1', kind: 'ride', chapter_id: null, ride_id: 'r1', committee: null, pinned_message_id: null, member_ids: [],
    ride: rideRow, unread: 3,
    last: { id: 'm9', author_id: 'a1', body: null, created_at: '2026-10-24T01:00:00+00:00', removed: false, media_count: 2 },
  });
  assert.deepEqual(parts.conversation, { id: 'c1', kind: 'ride', chapterId: null, rideId: 'r1', committee: null, pinnedMessageId: null, memberIds: [] });
  assert.equal(parts.ride?.startsAt, '2026-11-07T21:30:00.000Z');
  assert.deepEqual(parts.last, { id: 'm9', authorId: 'a1', body: null, createdAt: '2026-10-24T01:00:00.000Z', removed: false, mediaCount: 2, voice: false });
  assert.equal(parts.unread, 3);
});

test('a chat-list entry says when its newest message is a voice note', () => {
  const entry = (last: Record<string, unknown>) =>
    toSummaryParts({
      id: 'c1', kind: 'club', chapter_id: null, ride_id: null, committee: null, pinned_message_id: null, member_ids: [], ride: null, unread: 0,
      last: { id: 'm9', author_id: 'a1', body: null, created_at: '2026-10-24T01:00:00+00:00', removed: false, media_count: 1, ...last },
    } as Parameters<typeof toSummaryParts>[0]);
  assert.equal(entry({ voice: true }).last?.voice, true);
  assert.equal(entry({ voice: false }).last?.voice, false);
  assert.equal(entry({}).last?.voice, false, 'a database without voice notes yet');
});

test('a voice note uploads as the type it was recorded in', () => {
  assert.equal(voiceUploadType({ uri: 'file:///rec/abc.m4a', mimeType: null }), 'audio/mp4', 'a phone');
  assert.equal(voiceUploadType({ uri: 'blob:https://x/1', mimeType: 'audio/webm;codecs=opus' }), 'audio/webm', 'Chrome');
  assert.equal(voiceUploadType({ uri: 'blob:https://x/2', mimeType: 'audio/mp4' }), 'audio/mp4', 'Safari');
  assert.equal(voiceUploadType({ uri: 'file:///rec/abc.3gp', mimeType: null }), null);
  assert.match(uploadName('c1', 'audio/mp4'), /^c1\/[0-9a-f]{32}\.m4a$/);
  assert.match(uploadName('c1', 'audio/webm'), /^c1\/[0-9a-f]{32}\.webm$/);
});

test('a ride from the database', () => {
  assert.deepEqual(toRide({ ...rideRow, cancelled_at: '2026-11-01T00:00:00+00:00' }), {
    id: 'r1', title: 'Coffee run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: null, allDay: false, location: 'Laverton', notes: null,
    category: 'west', cancelledAt: '2026-11-01T00:00:00.000Z',
  });
});

test('a feed item and a report', () => {
  const f = toFeedItem({
    id: 'x1', message_id: 'm1', conversation_id: 'c1', kind: 'photo', path: 'c1/a.jpg', poster_path: null, width: 4, height: 3,
    duration_ms: null, position: 0, author_id: 'a1', created_at: '2026-10-24T01:00:00+00:00',
  });
  assert.equal(f.authorId, 'a1');
  assert.equal(f.createdAt, '2026-10-24T01:00:00.000Z');
  const r = toReport({
    id: 'rep', reason: null, created_at: '2026-10-24T03:00:00+00:00', reporter_id: 'a2',
    message: { id: 'm1', conversation_id: 'c1', author_id: 'a1', body: 'rude', media_count: 0, created_at: '2026-10-24T01:00:00+00:00' },
    chat: { id: 'c1', kind: 'club', chapter_id: null, ride_id: null, committee: null },
  });
  assert.equal(r.message.body, 'rude');
  assert.equal(r.message.voice, null, 'no voice note, or a database without them yet');
  assert.equal(r.conversation.kind, 'club');
  const v = toReport({
    id: 'rep', reason: null, created_at: '2026-10-24T03:00:00+00:00', reporter_id: 'a2',
    message: { id: 'm1', conversation_id: 'c1', author_id: 'a1', body: null, media_count: 1, created_at: '2026-10-24T01:00:00+00:00', voice: { path: 'c1/a.m4a', duration_ms: 8400 } },
    chat: { id: 'c1', kind: 'club', chapter_id: null, ride_id: null, committee: null },
  });
  assert.deepEqual(v.message.voice, { path: 'c1/a.m4a', durationMs: 8400 });
});

const message = (id: string, createdAt: string, body = id): Message => ({
  id, conversationId: 'c1', authorId: 'a1', body, createdAt, removedAt: null, replyToId: null, media: [], reactions: [],
});

test('merging keeps one copy of each message, the newer copy winning, oldest first', () => {
  const have = [message('a', '2026-10-24T01:00:00.000Z'), message('b', '2026-10-24T02:00:00.000Z')];
  const merged = mergeMessages(have, [message('c', '2026-10-24T03:00:00.000Z'), message('b', '2026-10-24T02:00:00.000Z', 'edited')]);
  assert.deepEqual(merged.map((m) => [m.id, m.body]), [['a', 'a'], ['b', 'edited'], ['c', 'c']]);
  assert.deepEqual(mergeMessages(merged, [message('z', '2026-10-23T00:00:00.000Z')]).map((m) => m.id), ['z', 'a', 'b', 'c'], 'older pages go first');
});

test('the files of a message that has just been removed, so their addresses are thrown away', () => {
  const photo = { id: 'p', messageId: 'b', kind: 'video' as const, path: 'c1/v.mp4', posterPath: 'c1/s.jpg', width: 1, height: 1, durationMs: 1, position: 0 };
  const have = [message('a', '2026-10-24T01:00:00.000Z'), { ...message('b', '2026-10-24T02:00:00.000Z'), media: [photo] }];
  const removed = { ...message('b', '2026-10-24T02:00:00.000Z'), body: null, removedAt: '2026-10-24T03:00:00.000Z' };
  assert.deepEqual(goneMedia(have, [removed]), ['c1/v.mp4', 'c1/s.jpg']);
  assert.deepEqual(goneMedia(have, [message('b', '2026-10-24T02:00:00.000Z')]), [], 'still there');
});

test('an upload lands in its chat’s folder with a fresh name and the right ending', () => {
  const name = uploadName('c1', 'image/jpeg');
  assert.match(name, /^c1\/[0-9a-f]{32}\.jpg$/);
  assert.notEqual(uploadName('c1', 'image/jpeg'), name);
  assert.match(uploadName('c1', 'video/quicktime'), /\.mov$/);
  assert.match(uploadName('c1', 'video/mp4'), /\.mp4$/);
});
