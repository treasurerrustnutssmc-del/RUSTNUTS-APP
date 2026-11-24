import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addProblem, albumChoices, approveProblem, BAD_GALLERY_UPLOAD, canAddToGallery, CLUB_LIFE, GALLERY_GONE, GALLERY_MAX,
  GALLERY_REMOVED_ALREADY, NO_FILES, NOT_GALLERY_REMOVER, NOT_WAITING, removeProblem, TOO_MANY, WEBSITE_NEEDS_CONSENT,
  albumLabel, type GalleryItem, type GalleryInput,
} from './gallery';
import { LONG_CAPTION, NOT_PHOTO_EDITOR, type SitePhotoCrew } from './sitePhotos';
import { club, member, ride as rideOf, who } from './stage4.testkit';
import type { ClubData, Ride } from './types';

function data(): ClubData {
  const base = club();
  return {
    ...base,
    members: [...base.members, member('smo'), member('snap'), member('fam', { status: 'family' }), member('pend', { approval: 'pending' })],
    positions: [...base.positions, { id: 'p-smo', memberId: 'smo', chapterId: 'west', role: 'social_media_officer', startedOn: '2025-01-01', endedOn: null }],
  };
}
const crew: SitePhotoCrew[] = [];
const input = (over: Partial<GalleryInput> = {}): GalleryInput => ({ rideId: null, caption: '', websiteOk: false, consent: false, count: 2, ...over });
const item = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  id: 'g1', uploadedBy: 'snap', rideId: null, kind: 'photo', path: 'gallery/snap/a.jpg', posterPath: null, width: 1200, height: 900,
  durationMs: null, caption: null, websiteOk: true, websiteDeclinedAt: null, onWebsite: false, createdAt: '2026-11-20T00:00:00.000Z', removedAt: null, ...over,
});
const ride = (id: string, startsAt: string): Ride => rideOf(id, { title: `Ride ${id}`, startsAt });

test('approved members can add to the gallery; family, pending and nobody cannot', () => {
  const d = data();
  assert.equal(canAddToGallery(who(d, 'snap')), true);
  assert.equal(canAddToGallery(who(d, 'fam')), false);
  assert.equal(canAddToGallery(who(d, 'pend')), false);
  assert.equal(canAddToGallery(null), false);
});

test('adding checks in the database order: signed in, approved, files, how many, ride, caption, website tick', () => {
  const d = data();
  const rides = [ride('r1', '2026-11-21T00:00:00.000Z')];
  assert.equal(addProblem(null, input(), rides), 'Sign in first.');
  assert.equal(addProblem(who(d, 'pend'), input(), rides), 'Only approved members can do that.');
  assert.equal(addProblem(who(d, 'fam'), input(), rides), 'Only approved members can do that.');
  assert.equal(addProblem(who(d, 'snap'), input({ count: 0 }), rides), NO_FILES);
  assert.equal(addProblem(who(d, 'snap'), input({ count: GALLERY_MAX + 1 }), rides), TOO_MANY);
  assert.equal(addProblem(who(d, 'snap'), input({ rideId: 'nope' }), rides), 'No such ride.');
  assert.equal(addProblem(who(d, 'snap'), input({ caption: 'x'.repeat(121) }), rides), LONG_CAPTION);
  assert.equal(addProblem(who(d, 'snap'), input({ websiteOk: true }), rides), WEBSITE_NEEDS_CONSENT);
  assert.equal(addProblem(who(d, 'snap'), input({ websiteOk: true, consent: true, rideId: 'r1' }), rides), null);
  assert.equal(addProblem(who(d, 'snap'), input({ caption: '   ' + 'x'.repeat(120) + '  ' }), rides), null);
});

test('taking down: the member who added it or the website photo crew', () => {
  const d = data();
  assert.equal(removeProblem(who(d, 'snap'), d.positions, crew, item()), null);
  assert.equal(removeProblem(who(d, 'smo'), d.positions, crew, item()), null);
  assert.equal(removeProblem(who(d, 'rider'), d.positions, crew, item()), NOT_GALLERY_REMOVER);
  assert.equal(removeProblem(who(d, 'snap'), d.positions, crew, undefined), GALLERY_GONE);
  assert.equal(removeProblem(who(d, 'snap'), d.positions, crew, item({ removedAt: '2026-11-21T00:00:00.000Z' })), GALLERY_REMOVED_ALREADY);
});

test('approving for the website: editors only, and only while it waits', () => {
  const d = data();
  assert.equal(approveProblem(who(d, 'snap'), d.positions, crew, item(), ''), NOT_PHOTO_EDITOR);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, item(), ''), null);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, undefined, ''), GALLERY_GONE);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, item({ websiteOk: false }), ''), NOT_WAITING);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, item({ websiteDeclinedAt: '2026-11-21T00:00:00.000Z' }), ''), NOT_WAITING);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, item({ onWebsite: true }), ''), NOT_WAITING);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, item({ removedAt: '2026-11-21T00:00:00.000Z' }), ''), GALLERY_GONE);
  assert.equal(approveProblem(who(d, 'smo'), d.positions, crew, item(), 'x'.repeat(121)), LONG_CAPTION);
});

test('album choices: rides from the last 30 days up to today, newest first, then Club life', () => {
  const rides = [
    ride('old', '2026-10-01T00:00:00.000Z'),
    ride('a', '2026-11-01T00:00:00.000Z'),
    ride('b', '2026-11-20T00:00:00.000Z'),
    ride('later', '2026-12-01T00:00:00.000Z'),
  ];
  assert.deepEqual(albumChoices(rides, '2026-11-24').map((r) => r.id), ['b', 'a']);
  assert.equal(albumLabel(null, rides), CLUB_LIFE);
  assert.equal(albumLabel('b', rides), 'Ride b');
  assert.equal(albumLabel('gone', rides), CLUB_LIFE);
});

test('the upload message matches the database', () => {
  assert.equal(BAD_GALLERY_UPLOAD, 'That file didn’t upload properly. Try again.');
});
