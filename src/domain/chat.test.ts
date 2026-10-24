import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canModerate,
  chatTitle,
  dayLabel,
  directProblem,
  findLinks,
  groupMessages,
  mediaProblem,
  postProblem,
  reactProblem,
  readProblem,
  removeProblem,
  rideChatListed,
  type Conversation,
  type Message,
  type PickedMedia,
} from './chat';
import type { ClubData, Member, Position, Ride } from './types';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Name ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

const seat = (id: string, memberId: string, chapterId: string | null, role: Position['role']): Position => ({
  id, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});

const westie = member('westie');
const secretary = member('secretary'); // West board
const northie = member('northie', { chapterId: 'ch-north' });
const northPres = member('northpres', { chapterId: 'ch-north' }); // on the NEC
const legacy = member('legacy', { status: 'legacy' });
const applicant = member('applicant', { status: 'introduced', approval: 'pending' });

const data: ClubData = {
  chapters: [
    { id: 'ch-west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
    { id: 'ch-north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
  ],
  members: [westie, secretary, northie, northPres, legacy, applicant],
  privates: [], bikes: [], registrations: [], emergencyContacts: [],
  positions: [seat('p1', 'secretary', 'ch-west', 'secretary'), seat('p2', 'northpres', 'ch-north', 'president')],
  rides: [], rsvps: [],
};

const chat = (over: Partial<Conversation> & Pick<Conversation, 'kind'>): Conversation => ({
  id: `c-${over.kind}`, chapterId: null, rideId: null, memberIds: [], ...over,
});
const club = chat({ kind: 'club' });
const west = chat({ kind: 'chapter', id: 'c-west', chapterId: 'ch-west' });
const north = chat({ kind: 'chapter', id: 'c-north', chapterId: 'ch-north' });
const rideChat = chat({ kind: 'ride', rideId: 'r-1' });
const direct = chat({ kind: 'direct', memberIds: ['westie', 'northie'] });

const message = (over: Partial<Message> = {}): Message => ({
  id: 'msg-1', conversationId: 'c-club', authorId: 'westie', body: 'G’day', createdAt: '2026-11-01T00:00:00.000Z',
  removedAt: null, media: [], reactions: [], ...over,
});

test('every approved member reads the whole-club and ride chats; nobody else does', () => {
  for (const m of [westie, northie, legacy, member('fam', { status: 'family' })]) {
    assert.equal(readProblem(m, club, data), null, m.id);
    assert.equal(readProblem(m, rideChat, data), null, m.id);
  }
  assert.equal(readProblem(applicant, club, data), 'Only approved members can do that.');
  assert.equal(readProblem(member('gone', { approval: 'suspended' }), club, data), 'Only approved members can do that.');
  assert.equal(readProblem(null, club, data), 'Sign in first.');
  assert.equal(readProblem(westie, undefined, data), 'No such chat.');
});

test('a chapter chat is for its own members and the NEC', () => {
  assert.equal(readProblem(westie, west, data), null);
  assert.equal(readProblem(northPres, west, data), null, 'a sitting president is on the NEC');
  assert.equal(readProblem(northie, west, data), 'That chat is for West chapter members.');
  assert.equal(readProblem(westie, north, data), 'That chat is for North chapter members.');
});

test('a private chat is for its two people only', () => {
  assert.equal(readProblem(westie, direct, data), null);
  assert.equal(readProblem(northie, direct, data), null);
  assert.equal(readProblem(northPres, direct, data), 'That’s a private chat.', 'not even the NEC');
});

test('what a message needs', () => {
  assert.equal(postProblem(westie, club, '  \n ', 0, data), 'Write something or add a photo.');
  assert.equal(postProblem(westie, club, '', 1, data), null, 'a photo on its own is fine');
  assert.equal(postProblem(westie, club, 'x'.repeat(4000), 0, data), null);
  assert.equal(postProblem(westie, club, 'x'.repeat(4001), 0, data), 'Keep it under 4,000 characters.');
  assert.equal(postProblem(westie, club, 'pics', 10, data), null);
  assert.equal(postProblem(westie, club, 'pics', 11, data), 'Up to 10 photos or videos at a time.');
  assert.equal(postProblem(northie, west, 'hi', 0, data), 'That chat is for West chapter members.');
});

test('who can remove a message', () => {
  const mine = message({ authorId: 'westie' });
  const theirs = message({ authorId: 'northie' });
  assert.equal(removeProblem(westie, club, mine, data), null, 'your own, always');
  assert.equal(removeProblem(westie, club, theirs, data), 'You can only remove your own messages.');
  assert.equal(removeProblem(secretary, west, theirs, data), null, 'chapter board in its own chat');
  assert.equal(removeProblem(secretary, club, theirs, data), null, 'any board member in the whole-club chat');
  assert.equal(removeProblem(secretary, rideChat, theirs, data), null, 'and in ride chats');
  assert.equal(removeProblem(secretary, north, theirs, data), 'That chat is for North chapter members.');
  assert.equal(removeProblem(northPres, west, theirs, data), null, 'the NEC anywhere');
  assert.equal(removeProblem(westie, direct, message({ authorId: 'northie' }), data), 'You can only remove your own messages.');
  assert.equal(removeProblem(westie, club, undefined, data), 'No such message.');
  assert.equal(removeProblem(westie, club, message({ removedAt: '2026-11-01T01:00:00.000Z' }), data), 'That message was removed.');
  assert.equal(canModerate(northPres, direct, data), false, 'nobody moderates a private chat');
});

test('reactions come from the set, on messages still there', () => {
  assert.equal(reactProblem(westie, club, message(), '🍺', data), null);
  assert.equal(reactProblem(westie, club, message(), '🙂', data), 'Pick one of the reactions.');
  assert.equal(reactProblem(westie, club, message({ removedAt: '2026-11-01T01:00:00.000Z' }), '🔥', data), 'That message was removed.');
  assert.equal(reactProblem(northie, west, message(), '🔥', data), 'That chat is for West chapter members.');
});

test('who you can start a private chat with', () => {
  assert.equal(directProblem(westie, northie), null);
  assert.equal(directProblem(westie, westie), 'You can’t message yourself.');
  assert.equal(directProblem(westie, applicant), 'They’re not an approved member.');
  assert.equal(directProblem(westie, undefined), 'That member no longer exists.');
  assert.equal(directProblem(applicant, westie), 'Only approved members can do that.');
  assert.equal(directProblem(null, westie), 'Sign in first.');
});

test('a ride chat sits in your list from a week before to three days after, if you’re coming', () => {
  const ride: Ride = {
    id: 'r-1', title: 'Coffee run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: '2026-11-09T13:00:00.000Z', allDay: true,
    location: null, notes: null, category: 'west', cancelledAt: null,
  };
  // Starts 8 Nov Melbourne; an all-day end at midnight after 9 Nov means its last day is 9 Nov.
  assert.equal(rideChatListed(ride, 'going', '2026-11-01'), true, 'start minus 7 days');
  assert.equal(rideChatListed(ride, 'going', '2026-10-31'), false);
  assert.equal(rideChatListed(ride, 'maybe', '2026-11-12'), true, 'last day plus 3');
  assert.equal(rideChatListed(ride, 'maybe', '2026-11-13'), false);
  assert.equal(rideChatListed(ride, 'no', '2026-11-08'), false);
  assert.equal(rideChatListed(ride, null, '2026-11-08'), false);
});

test('day labels in Melbourne time', () => {
  assert.equal(dayLabel('2026-11-07T23:30:00.000Z', '2026-11-08'), 'Today', '10:30 am on the 8th in Melbourne');
  assert.equal(dayLabel('2026-11-07T01:00:00.000Z', '2026-11-08'), 'Yesterday');
  assert.equal(dayLabel('2026-11-06T01:00:00.000Z', '2026-11-08'), '06/11/2026');
});

test('messages group by Melbourne day, then by sender within five minutes', () => {
  const at = (id: string, authorId: string, createdAt: string) => message({ id, authorId, createdAt });
  const groups = groupMessages(
    [
      at('d', 'westie', '2026-11-07T13:30:00.000Z'), // 8 Nov, 12:30 am Melbourne
      at('a', 'westie', '2026-11-07T01:00:00.000Z'),
      at('b', 'westie', '2026-11-07T01:05:00.000Z'), // exactly 5 minutes: same run
      at('c', 'westie', '2026-11-07T01:10:01.000Z'), // over 5 minutes: new run
      at('e', 'northie', '2026-11-07T13:31:00.000Z'),
    ],
    '2026-11-08',
  );
  assert.deepEqual(groups.map((g) => g.day), ['Yesterday', 'Today']);
  assert.deepEqual(groups[0].runs.map((r) => r.messages.map((m) => m.id)), [['a', 'b'], ['c']]);
  assert.deepEqual(groups[1].runs.map((r) => [r.authorId, r.messages.map((m) => m.id)]), [['westie', ['d']], ['northie', ['e']]]);
});

test('links in a message are found, without the punctuation after them', () => {
  assert.deepEqual(findLinks('see https://x.au/a, ok'), [
    { text: 'see ', url: null },
    { text: 'https://x.au/a', url: 'https://x.au/a' },
    { text: ', ok', url: null },
  ]);
  assert.deepEqual(findLinks('www.rustnutssmc.com.au.'), [
    { text: 'www.rustnutssmc.com.au', url: 'https://www.rustnutssmc.com.au' },
    { text: '.', url: null },
  ]);
  assert.deepEqual(findLinks('no links here'), [{ text: 'no links here', url: null }]);
});

test('photos and videos that can go in', () => {
  const picked = (over: Partial<PickedMedia>): PickedMedia => ({
    uri: 'file:///x', kind: 'photo', width: 4000, height: 3000, durationMs: null, fileSize: 6_000_000, mimeType: 'image/jpeg', ...over,
  });
  assert.equal(mediaProblem(picked({})), null, 'a big photo is fine, it gets resized');
  assert.equal(mediaProblem(picked({ kind: 'photo', fileSize: 80 * 1024 * 1024 })), null);
  assert.equal(mediaProblem(picked({ kind: 'video', durationMs: 60_000, mimeType: 'video/mp4' })), null);
  assert.equal(mediaProblem(picked({ kind: 'video', durationMs: 60_001, mimeType: 'video/mp4' })), 'Videos can be up to 60 seconds.');
  assert.equal(
    mediaProblem(picked({ kind: 'video', durationMs: 10_000, fileSize: 50 * 1024 * 1024 + 1, mimeType: 'video/mp4' })),
    'That file is over 50 MB.',
  );
  assert.equal(mediaProblem(picked({ mimeType: 'application/pdf' })), 'Only photos and videos can go in.');
});

test('chat names', () => {
  const ride: Ride = {
    id: 'r-1', title: 'Coffee run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: null, allDay: false,
    location: null, notes: null, category: 'west', cancelledAt: null,
  };
  assert.equal(chatTitle(club, westie, data), 'Whole club');
  assert.equal(chatTitle(west, westie, data), 'West chapter');
  assert.equal(chatTitle(rideChat, westie, data, ride), 'Coffee run');
  assert.equal(chatTitle(direct, westie, data), 'northie', 'the other person, by road name');
  assert.equal(chatTitle(direct, northie, data), 'westie');
});
