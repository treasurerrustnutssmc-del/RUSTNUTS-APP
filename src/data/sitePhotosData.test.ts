import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_SITE_PHOTO_CREW, demoAddPhoto, demoSitePhotos } from './sitePhotosData';

// Jeff's call (2 Nov 2026): an editor's tick alone puts any club chat photo up; the poster gets a
// heads-up and can take it down, but isn't asked first.
test('a pick goes live at once, whoever posted the photo', () => {
  const now = '2026-11-02T03:00:00.000Z';
  const base = { source: 'chat' as const, mediaId: 'mm-1', bucket: 'chat-media' as const, path: 'demo/coast-road.jpg', width: 1200, height: 900, caption: null };
  const theirs = demoAddPhoto([], { ...base, postedBy: 'm-sparks' }, 'm-torque', now)[0];
  assert.equal(theirs.status, 'live');
  assert.equal(theirs.decidedAt, now);
  const mine = demoAddPhoto([], { ...base, postedBy: 'm-torque' }, 'm-torque', now)[0];
  assert.equal(mine.status, 'live');
});

test('the demo samples are all live or taken down, and the crew is Torque and Jet', () => {
  assert.deepEqual([...new Set(demoSitePhotos('m-torque', (path) => `mm-${path}`).map((p) => p.status))].sort(), ['live', 'removed']);
  assert.deepEqual(DEMO_SITE_PHOTO_CREW.map((c) => c.memberId), ['m-torque', 'm-jet']);
});
