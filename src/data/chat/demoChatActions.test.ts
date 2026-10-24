import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureChat, fixtureData } from '../parityFixture.testkit';
import {
  markRead,
  openDirect,
  pinMessage,
  removeMessage,
  reportMessage,
  resolveReport,
  rideChat,
  sendMessage,
  setBlock,
  toggleReaction,
  type ChatCtx,
} from './demoChatActions';

const NOW = '2026-10-24T01:00:00.000Z';

function ctxAs(key: string | null): ChatCtx {
  const club = fixtureData();
  return { chat: fixtureChat(), club, me: club.members.find((m) => m.id === key) ?? null, now: NOW };
}

test('sending trims the words, keeps the GIFs in order and marks the chat read for the sender', () => {
  const ctx = ctxAs('spanner');
  const gif = (n: number) => ({ kind: 'gif' as const, path: `https://media1.giphy.com/media/${n}.gif`, posterPath: null, width: 200, height: 150, durationMs: null });
  const { chat, id } = sendMessage(ctx, 'club', '  G’day  ', [gif(1), gif(2)]);
  const sent = chat.messages.find((m) => m.id === id)!;
  assert.equal(sent.body, 'G’day');
  assert.equal(sent.authorId, 'spanner');
  assert.deepEqual(sent.media.map((m) => [m.path, m.position]), [['https://media1.giphy.com/media/1.gif', 0], ['https://media1.giphy.com/media/2.gif', 1]]);
  assert.equal(chat.reads.find((r) => r.conversationId === 'club' && r.memberId === 'spanner')?.readAt, NOW);
  assert.throws(() => sendMessage(ctx, 'chapter:north', 'hi', []), /That chat is for North chapter members\./);
});

test('a reply has to be to a message in the same chat', () => {
  const ctx = ctxAs('spanner');
  assert.equal(sendMessage(ctx, 'club', 'yep', [], 'club-hello').chat.messages.at(-1)?.replyToId, 'club-hello');
  assert.throws(() => sendMessage(ctx, 'club', 'yep', [], 'west-hello'), /No such message\./);
});

test('removing blanks the words and photos, and takes away reactions, the pin and open reports', () => {
  let ctx = ctxAs('torque');
  ctx = { ...ctx, chat: toggleReaction(ctx, 'west-hello', '🔥') };
  ctx = { ...ctx, chat: pinMessage(ctx, 'chapter:west', 'west-hello') };
  ctx = { ...ctx, chat: reportMessage(ctx, 'west-hello', 'too loud').chat };
  const chat = removeMessage(ctx, 'west-hello');
  const gone = chat.messages.find((m) => m.id === 'west-hello')!;
  assert.equal(gone.body, null);
  assert.deepEqual(gone.media, []);
  assert.deepEqual(gone.reactions, []);
  assert.equal(gone.removedAt, NOW);
  assert.equal(chat.conversations.find((c) => c.id === 'chapter:west')?.pinnedMessageId, null);
  assert.equal(chat.reports.find((r) => r.messageId === 'west-hello')?.outcome, 'removed');
});

test('a reaction goes on and comes off again', () => {
  const ctx = ctxAs('spanner');
  const on = toggleReaction(ctx, 'club-hello', '🍺');
  assert.deepEqual(on.messages.find((m) => m.id === 'club-hello')?.reactions, [{ messageId: 'club-hello', memberId: 'spanner', emoji: '🍺' }]);
  const off = toggleReaction({ ...ctx, chat: on }, 'club-hello', '🍺');
  assert.deepEqual(off.messages.find((m) => m.id === 'club-hello')?.reactions, []);
});

test('a private chat is made once for each pair, from either side', () => {
  const first = openDirect(ctxAs('spanner'), 'crank');
  const again = openDirect({ ...ctxAs('crank'), chat: first.chat }, 'spanner');
  assert.equal(again.id, first.id);
  assert.equal(again.chat.conversations.filter((c) => c.kind === 'direct').length, first.chat.conversations.filter((c) => c.kind === 'direct').length);
  assert.deepEqual([...first.chat.conversations.find((c) => c.id === first.id)!.memberIds].sort(), ['crank', 'spanner']);
  assert.equal(openDirect(ctxAs('rusty'), 'torque').id, 'direct:rusty:torque', 'an existing one');
});

test('a ride’s chat is there from the ride', () => {
  assert.equal(rideChat(ctxAs('crank'), 'future-west').id, 'ride:future-west');
  assert.throws(() => rideChat(ctxAs('crank'), 'nope'), /No such ride\./);
});

test('blocking is yours to set and unset', () => {
  const ctx = ctxAs('rusty');
  const on = setBlock(ctx, 'crank', true);
  assert.deepEqual(on.blocks.filter((b) => b.blockerId === 'rusty'), [{ blockerId: 'rusty', blockedId: 'crank' }]);
  assert.deepEqual(setBlock({ ...ctx, chat: on }, 'crank', true).blocks.filter((b) => b.blockerId === 'rusty').length, 1, 'once');
  assert.equal(setBlock({ ...ctx, chat: on }, 'crank', false).blocks.filter((b) => b.blockerId === 'rusty').length, 0);
});

test('a report goes to the chat’s moderators, who remove the message or let it stand', () => {
  const reported = reportMessage(ctxAs('spanner'), 'club-crank', 'not on');
  const report = reported.chat.reports.find((r) => r.id === reported.id)!;
  assert.equal(report.body, 'Fair dinkum');
  assert.throws(() => resolveReport({ ...ctxAs('gravel'), chat: reported.chat }, report.id, false), /Only moderators can do that\./);
  const dismissed = resolveReport({ ...ctxAs('rusty'), chat: reported.chat }, report.id, false);
  assert.equal(dismissed.reports.find((r) => r.id === report.id)?.outcome, 'dismissed');
  assert.equal(dismissed.messages.find((m) => m.id === 'club-crank')?.removedAt, null, 'the message stays');
  assert.throws(() => resolveReport({ ...ctxAs('rusty'), chat: dismissed }, report.id, true), /That report was already dealt with\./);
  assert.throws(() => resolveReport(ctxAs('rusty'), 'nope', true), /No such report\./);
});

test('marking a chat read needs a chat you can read', () => {
  const chat = markRead(ctxAs('spanner'), 'chapter:west');
  assert.equal(chat.reads.find((r) => r.conversationId === 'chapter:west' && r.memberId === 'spanner')?.readAt, NOW);
  assert.throws(() => markRead(ctxAs('crank'), 'chapter:west'), /That chat is for West chapter members\./);
});
