import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemFromPayload, NOTHING_TO_SHARE, sharedDraft, waitingShareNote, type SharedItem } from './shareIn';

const photo = (n: number): SharedItem => ({ kind: 'image', value: `file:///p${n}.jpg`, uri: `file:///p${n}.jpg`, mimeType: 'image/jpeg', size: 1000 });
const video: SharedItem = { kind: 'video', value: 'file:///v.mov', uri: 'file:///v.mov', mimeType: 'video/quicktime', size: 5000 };

test('words and a link come across as the message, one per line, without repeats', () => {
  const draft = sharedDraft([
    { kind: 'text', value: 'Check this out', uri: null, mimeType: 'text/plain', size: null },
    { kind: 'website', value: 'https://example.com/ride', uri: null, mimeType: null, size: null },
    { kind: 'text', value: 'https://example.com/ride', uri: null, mimeType: 'text/plain', size: null },
  ]);
  assert.equal(draft.text, 'Check this out\nhttps://example.com/ride');
  assert.deepEqual(draft.media, []);
  assert.deepEqual(draft.notes, []);
});

test('photos and videos become attachments', () => {
  const draft = sharedDraft([photo(1), video]);
  assert.equal(draft.text, '');
  assert.deepEqual(draft.media, [
    { uri: 'file:///p1.jpg', kind: 'photo', mimeType: 'image/jpeg', fileSize: 1000 },
    { uri: 'file:///v.mov', kind: 'video', mimeType: 'video/quicktime', fileSize: 5000 },
  ]);
});

test('only the first 10 photos and videos come across', () => {
  const draft = sharedDraft(Array.from({ length: 12 }, (_, i) => photo(i)));
  assert.equal(draft.media.length, 10);
  assert.equal(draft.media[9]?.uri, 'file:///p9.jpg');
  assert.deepEqual(draft.notes, ['Only the first 10 photos and videos came across.']);
});

test('files and voice notes are left out, and say so', () => {
  const draft = sharedDraft([
    photo(1),
    { kind: 'file', value: 'file:///a.pdf', uri: 'file:///a.pdf', mimeType: 'application/pdf', size: 10 },
    { kind: 'audio', value: 'file:///a.m4a', uri: 'file:///a.m4a', mimeType: 'audio/mp4', size: 10 },
  ]);
  assert.equal(draft.media.length, 1);
  assert.deepEqual(draft.notes, ['Files and voice notes can’t go in a chat, so they were left out.']);
});

test('a long text is cut to 4,000 characters', () => {
  const draft = sharedDraft([{ kind: 'text', value: '🏍'.repeat(4005), uri: null, mimeType: 'text/plain', size: null }]);
  assert.equal([...draft.text].length, 4000);
  assert.deepEqual(draft.notes, ['That was too long for one message, so it was cut to 4,000 characters.']);
});

test('blank text and photos without an address are skipped', () => {
  const draft = sharedDraft([
    { kind: 'text', value: '   \n ', uri: null, mimeType: 'text/plain', size: null },
    { kind: 'image', value: '', uri: null, mimeType: 'image/png', size: null },
  ]);
  assert.equal(draft.text, '');
  assert.deepEqual(draft.media, []);
});

test('the empty message names what can be shared', () => {
  assert.equal(NOTHING_TO_SHARE, 'Nothing here can go in a chat. Share photos, videos, links or words.');
});

test('the phone’s payload becomes a shared item', () => {
  const base = { contentUri: null, contentType: null, contentMimeType: null, originalName: null, contentSize: null };
  assert.deepEqual(
    itemFromPayload({ ...base, value: 'content://media/1', shareType: 'image', mimeType: 'image/*', contentUri: 'file:///c/1.jpg', contentType: 'image', contentMimeType: 'image/jpeg', contentSize: 99 }),
    { kind: 'image', value: 'content://media/1', uri: 'file:///c/1.jpg', mimeType: 'image/jpeg', size: 99 },
  );
  // A link that couldn't be looked up (no signal) still comes across as a link.
  assert.deepEqual(itemFromPayload({ ...base, value: 'https://x.au', shareType: 'url' }), { kind: 'website', value: 'https://x.au', uri: null, mimeType: null, size: null });
  assert.equal(itemFromPayload({ ...base, value: 'hi', shareType: 'text', mimeType: 'text/plain' }).kind, 'text');
});

test('a shared link stays the link the member shared, whatever the page turns out to be', () => {
  const base = { contentUri: null, contentType: null, contentMimeType: null, originalName: null, contentSize: null };
  const pic = itemFromPayload({ ...base, value: 'https://x.au/pic.jpg', shareType: 'url', contentUri: 'https://x.au/pic.jpg', contentType: 'image', contentMimeType: 'image/jpeg', contentSize: 5 });
  const pdf = itemFromPayload({ ...base, value: 'https://x.au/a.pdf', shareType: 'url', contentUri: 'https://x.au/a.pdf', contentType: 'file', contentMimeType: 'application/pdf' });
  const moved = itemFromPayload({ ...base, value: 'https://x.au/r', shareType: 'url', contentUri: 'https://login.x.au/?next=r', contentType: 'website' });
  const draft = sharedDraft([pic, pdf, moved]);
  assert.equal(draft.text, 'https://x.au/pic.jpg\nhttps://x.au/a.pdf\nhttps://x.au/r');
  assert.deepEqual(draft.media, []);
  assert.deepEqual(draft.notes, []);
});

test('two photos the phone saved under one name come across once, and say so', () => {
  const same: SharedItem = { kind: 'image', value: 'FullSizeRender.jpg', uri: 'file:///group/FullSizeRender.jpg', mimeType: 'image/jpeg', size: 10 };
  const draft = sharedDraft([same, { ...same }, photo(2)]);
  assert.deepEqual(draft.media.map((m) => m.uri), ['file:///group/FullSizeRender.jpg', 'file:///p2.jpg']);
  assert.deepEqual(draft.notes, ['Two of those had the same name, so only one came across. Share the other on its own.']);
});

// Shared in before the app can take it: a note says why nothing opened, and what happens next.
test('a share made while signed out says to sign in first, and that it opens after', () => {
  const note = waitingShareNote('signedOut');
  assert.equal(note.title, 'Sign in first');
  assert.match(note.text, /opens once you’re signed in/);
});

test('an applicant or a member waiting for approval is told chats open once the club says yes', () => {
  for (const stage of ['applying', 'pending'] as const) {
    const note = waitingShareNote(stage);
    assert.match(note.title, /approved/);
    assert.match(note.text, /club/);
  }
});

test('a family account is told only members can share into club chats', () => {
  const note = waitingShareNote('family');
  assert.match(note.title, /[Ff]amily/);
  assert.match(note.text, /[Oo]nly members/);
});

test('every note is plain sentences, with no straight apostrophes', () => {
  for (const stage of ['signedOut', 'applying', 'pending', 'family'] as const) {
    const { title, text } = waitingShareNote(stage);
    assert.ok(title.length > 0 && title.length <= 40, `${stage} title fits one line`);
    assert.ok(text.endsWith('.'), `${stage} text is a sentence`);
    assert.doesNotMatch(title + text, /'/, `${stage} uses curly apostrophes`);
  }
});
