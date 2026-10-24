import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message, MessageMedia } from '../../domain/chat';
import { fixtureChat, fixtureData } from '../parityFixture.testkit';
import { feedFrom, listFor, rideWallFrom, rideWallsFrom, sortSummaries, withoutBlocked } from './chatList';
import type { ChatData } from './demoChatActions';

const club = fixtureData();
const as = (key: string) => club.members.find((m) => m.id === key)!;
// A ride a few days off, so its chat is in the list for anyone going.
club.rides = [...club.rides, {
  id: 'soon', title: 'Sunday run', startsAt: '2026-10-26T22:00:00.000Z', endsAt: null, allDay: false, location: null, notes: null,
  category: 'west', cancelledAt: null,
}];
club.rsvps = [{ rideId: 'soon', memberId: 'spanner', answer: 'going', updatedAt: '2026-10-20T00:00:00.000Z' }];

function chatWith(extra: Partial<ChatData> = {}): ChatData {
  const base = fixtureChat();
  return {
    ...base,
    conversations: [...base.conversations, { id: 'ride:soon', kind: 'ride', chapterId: null, rideId: 'soon', committee: null, pinnedMessageId: null, memberIds: [] }],
    ...extra,
  };
}

const photo = (messageId: string, position = 0, kind: MessageMedia['kind'] = 'photo'): MessageMedia => ({
  id: `${messageId}-${position}`, messageId, kind, path: `p/${messageId}-${position}.jpg`, posterPath: null, width: 4, height: 3, durationMs: null, position,
});
const msg = (id: string, conversationId: string, authorId: string, createdAt: string, over: Partial<Message> = {}): Message => ({
  id, conversationId, authorId, body: id, createdAt, removedAt: null, replyToId: null, media: [], reactions: [], ...over,
});

test('the list holds the chats you can read, and ride chats only for rides you’re coming to', () => {
  const ids = listFor(chatWith(), club, as('spanner'), '2026-10-24').map((s) => s.conversation.id);
  assert.deepEqual(ids, ['club', 'chapter:west', 'ride:soon', 'direct:gravel:spanner']);
  const crank = listFor(chatWith(), club, as('crank'), '2026-10-24').map((s) => s.conversation.id);
  assert.deepEqual(crank, ['club', 'chapter:north', 'board:north', 'committee:ride'], 'a Road Captain sits at the big table and on the ride committee; no ride chat without an answer');
  assert.deepEqual(listFor(chatWith(), club, as('dylan'), '2026-10-24'), [], 'an applicant gets nothing');
});

test('the list shows the newest message and counts what others wrote since you last read', () => {
  const chat = chatWith({ reads: [{ conversationId: 'club', memberId: 'spanner', readAt: '2026-10-24T00:00:30.000Z' }] });
  const clubChat = listFor(chat, club, as('spanner'), '2026-10-24').find((s) => s.conversation.id === 'club')!;
  assert.equal(clubChat.last?.id, 'club-gone', 'removed ones still show as the last message');
  assert.equal(clubChat.last?.removed, true);
  assert.equal(clubChat.unread, 1, 'Crank’s message after the read; not the removed one, not Rusty’s before it');
  assert.equal(clubChat.title, 'Whole club');
});

test('writing in a chat counts as having read it', () => {
  const base = chatWith();
  const chat = { ...base, messages: [...base.messages, msg('club-me', 'club', 'spanner', '2026-10-24T00:09:00.000Z')] };
  const clubChat = listFor(chat, club, as('spanner'), '2026-10-24').find((s) => s.conversation.id === 'club')!;
  assert.equal(clubChat.unread, 0, 'everything before your own message is read');
});

test('someone you blocked doesn’t count, and isn’t shown', () => {
  const chat = chatWith({ blocks: [{ blockerId: 'spanner', blockedId: 'crank' }] });
  const clubChat = listFor(chat, club, as('spanner'), '2026-10-24').find((s) => s.conversation.id === 'club')!;
  assert.equal(clubChat.last?.id, 'club-hello');
  assert.equal(clubChat.unread, 1);
  assert.deepEqual(withoutBlocked(chat.messages, chat.blocks, 'spanner').map((m) => m.authorId).includes('crank'), false);
});

test('private chats come last, the busiest first', () => {
  const sorted = sortSummaries([
    { conversation: { id: 'd1', kind: 'direct', chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [] }, title: 'A', ride: null, unread: 0,
      last: { id: 'x', authorId: 'a', body: 'x', createdAt: '2026-10-01T00:00:00.000Z', removed: false, mediaCount: 0 } },
    { conversation: { id: 'd2', kind: 'direct', chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [] }, title: 'B', ride: null, unread: 0,
      last: { id: 'y', authorId: 'a', body: 'y', createdAt: '2026-10-02T00:00:00.000Z', removed: false, mediaCount: 0 } },
    { conversation: { id: 'club', kind: 'club', chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [] }, title: 'Whole club', ride: null, unread: 0, last: null },
  ]);
  assert.deepEqual(sorted.map((s) => s.conversation.id), ['club', 'd2', 'd1']);
});

test('the photo feed: newest first, whole messages, never private chats, GIFs, removed messages or blocked people', () => {
  const chat = chatWith({
    messages: [
      msg('a', 'club', 'rusty', '2026-10-24T01:00:00.000Z', { media: [photo('a', 0), photo('a', 1)] }),
      msg('b', 'chapter:west', 'spanner', '2026-10-24T02:00:00.000Z', { media: [photo('b')] }),
      msg('c', 'direct:rusty:torque', 'rusty', '2026-10-24T03:00:00.000Z', { media: [photo('c')] }),
      msg('d', 'club', 'crank', '2026-10-24T04:00:00.000Z', { media: [photo('d', 0, 'gif')] }),
      msg('e', 'club', 'crank', '2026-10-24T05:00:00.000Z', { media: [photo('e')], removedAt: '2026-10-24T06:00:00.000Z' }),
      msg('f', 'chapter:north', 'crank', '2026-10-24T07:00:00.000Z', { media: [photo('f')] }),
      msg('g', 'club', 'gravel', '2026-10-24T08:00:00.000Z', { media: [photo('g')] }),
    ],
    blocks: [{ blockerId: 'torque', blockedId: 'gravel' }],
  });
  const feed = feedFrom(chat, club, as('torque'));
  assert.deepEqual(feed.map((f) => f.id), ['b-0', 'a-0', 'a-1']);
  assert.deepEqual(feed[0], { ...photo('b'), conversationId: 'chapter:west', authorId: 'spanner', createdAt: '2026-10-24T02:00:00.000Z' });
  assert.deepEqual(feedFrom(chat, club, as('torque'), undefined, 1).map((f) => f.id), ['b-0'], 'a page');
  assert.deepEqual(feedFrom(chat, club, as('torque'), '2026-10-24T02:00:00.000Z', 1).map((f) => f.id), ['a-0', 'a-1'], 'older, a whole message');
});

test('ride walls: rides with photos, newest ride first, each with its newest photo as the cover', () => {
  const chat = chatWith({
    messages: [
      msg('a', 'ride:soon', 'rusty', '2026-10-27T01:00:00.000Z', { media: [photo('a')] }),
      msg('b', 'ride:soon', 'spanner', '2026-10-27T02:00:00.000Z', { media: [photo('b'), photo('b', 1)] }),
      msg('c', 'ride:past-club', 'rusty', '2020-01-01T02:00:00.000Z', { media: [photo('c')] }),
      msg('d', 'ride:future-west', 'rusty', '2026-10-27T03:00:00.000Z', { body: 'no photos' }),
    ],
  });
  const walls = rideWallsFrom(chat, club, as('crank'));
  assert.deepEqual(walls.map((w) => [w.ride.id, w.count, w.cover?.id]), [['soon', 3, 'b-0'], ['past-club', 1, 'c-0']]);
  const wall = rideWallFrom(chat, club, as('crank'), 'soon');
  assert.equal(wall.chatId, 'ride:soon');
  assert.deepEqual(wall.media.map((m) => m.id), ['b-0', 'b-1', 'a-0']);
  assert.throws(() => rideWallFrom(chat, club, as('crank'), 'nope'), /No such ride\./);
  assert.throws(() => rideWallFrom(chat, club, as('dylan'), 'soon'), /Only approved members can do that\./);
});
