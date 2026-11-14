// Family chat (docs/superpowers/specs/2026-11-03-family-chat-design.md): the demo's side of what
// supabase/tests/family_chat_test.sql checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotAllowedError } from './clubContext';
import { acceptPostingRules, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoStory.testkit';
import type { ChatData } from './chat/demoChatActions';
import type { Conversation } from '../domain/chat';
import { listFor } from './chat/chatList';
import { forFamily } from './familyData';

const today = '2026-11-03';
const ctx = (id: string, change: Record<string, unknown> = {}): DemoCtx => {
  const data = { ...DEMO_DATA, members: DEMO_DATA.members.map((m) => (m.id === id ? { ...m, ...change } : m)) };
  return { data, me: data.members.find((m) => m.id === id)!, today, now: `${today}T01:00:00.000Z` };
};

test('Family agree to the club rules for chats and posts, like members', () => {
  const after = acceptPostingRules(ctx('m-kerry', { postingRulesAcceptedOn: null }));
  assert.equal(after.members.find((m) => m.id === 'm-kerry')!.postingRulesAcceptedOn, today);
  assert.throws(() => acceptPostingRules(ctx('m-josh')), NotAllowedError, 'pending Family can’t');
});

// demoChatData pulls in the demo's pictures, which node can't load, so the chats are written out here.
const conv = (id: string, over: Partial<Conversation> & Pick<Conversation, 'kind'>): Conversation => ({
  id, chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [], ...over,
});
const chats: ChatData = {
  conversations: [
    conv('club', { kind: 'club' }), conv('family', { kind: 'family' }), conv('chapter:ch-west', { kind: 'chapter', chapterId: 'ch-west' }),
    conv('nec', { kind: 'nec' }), conv('direct:m-rusty:m-spanner', { kind: 'direct', memberIds: ['m-rusty', 'm-spanner'] }),
  ],
  messages: [], reads: [], blocks: [], reports: [],
};

test('members list the Family chat after the whole club; Family see it and nothing else', () => {
  const kerry = DEMO_DATA.members.find((m) => m.id === 'm-kerry')!;
  const theirs = listFor(chats, forFamily(DEMO_DATA, kerry), kerry, today);
  assert.deepEqual(theirs.map((s) => s.conversation.kind), ['family']);
  assert.equal(theirs[0].title, 'Family');
  const rusty = DEMO_DATA.members.find((m) => m.id === 'm-rusty')!;
  const kinds = listFor(chats, DEMO_DATA, rusty, today).map((s) => s.conversation.kind);
  assert.deepEqual(kinds.slice(0, 2), ['club', 'family'], 'right after the whole club');
});

test('in the demo, Family block someone from the Family chat by the chat’s names', async () => {
  const { setBlock } = await import('./chat/demoChatActions');
  const kerry = DEMO_DATA.members.find((m) => m.id === 'm-kerry')!;
  const club = forFamily(DEMO_DATA, kerry);
  const after = setBlock({ chat: chats, club, me: kerry, now: `${today}T01:00:00.000Z` }, 'm-spanner', true);
  assert.deepEqual(after.blocks, [{ blockerId: 'm-kerry', blockedId: 'm-spanner' }]);
});
