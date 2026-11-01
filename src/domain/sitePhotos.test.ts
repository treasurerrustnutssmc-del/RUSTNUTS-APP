import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MessageMedia } from './chat';
import {
  answerProblem, ASK_ANSWERED, CAPTION_MAX, cleanCaption, CREW_ALREADY, CREW_NOT_MEMBER, CREW_ON_HIATUS, crewProblem, editorListOrder,
  isSitePhotoEditor, LONG_CAPTION, managesSitePhotoCrew, myAsks, NO_CONSENT_TICK, NOT_A_PHOTO, NOT_CREW_MANAGER, NOT_ON_CREW,
  NOT_PHOTO_EDITOR, NOT_PHOTO_REMOVER, NOT_YOUR_ASK, PHOTO_ALREADY_PICKED, PHOTO_GONE, PHOTO_REMOVED_ALREADY, PHOTOS_SHOWN,
  pickGoesLive, pickProblem, PRIVATE_PHOTO, publicSitePhotos, removeProblem, uploadProblem, type PickablePhoto, type SitePhoto,
  type SitePhotoCrew,
} from './sitePhotos';
import { club, member, who } from './stage4.testkit';
import type { ClubData } from './types';

/** The stage 4 club plus smo (West Social Media Officer), crew1 (on the crew) and snap (a member whose photo gets picked). */
function data(): ClubData {
  const base = club();
  return {
    ...base,
    members: [...base.members, member('smo'), member('crew1'), member('snap'), member('hiatus', { onHiatus: true })],
    positions: [...base.positions, { id: 'p-smo', memberId: 'smo', chapterId: 'west', role: 'social_media_officer', startedOn: '2025-01-01', endedOn: null }],
  };
}
const crew: SitePhotoCrew[] = [{ memberId: 'crew1', addedBy: 'smo', addedAt: '2026-10-01T00:00:00.000Z' }];
const media = (id: string, kind: MessageMedia['kind'] = 'photo'): MessageMedia => ({
  id, messageId: `msg-${id}`, kind, path: `club/${id}.jpg`, posterPath: null, width: 1200, height: 900, durationMs: null, position: 0,
});
const chatPhoto = (id: string, authorId = 'snap', over: Partial<PickablePhoto> = {}): PickablePhoto => ({ media: media(id), chatKind: 'club', authorId, ...over });
const photo = (id: string, over: Partial<SitePhoto> = {}): SitePhoto => ({
  id, source: 'chat', mediaId: `m-${id}`, bucket: 'chat-media', path: `club/${id}.jpg`, width: 1200, height: 900, caption: null,
  postedBy: 'snap', pickedBy: 'smo', pickedAt: '2026-10-20T00:00:00.000Z', status: 'live', decidedAt: null, removedAt: null, ...over,
});
const ok = { caption: 'Black Spur, spring run', consent: true };

test('who edits and who runs the crew: the SMO and NEC run it, crew members edit, nobody else', () => {
  const d = data();
  assert.equal(managesSitePhotoCrew(who(d, 'smo'), d.positions), true);
  assert.equal(managesSitePhotoCrew(who(d, 'chair'), d.positions), true);
  assert.equal(managesSitePhotoCrew(who(d, 'crew1'), d.positions), false);
  assert.equal(managesSitePhotoCrew(who(d, 'sec'), d.positions), false);
  assert.equal(isSitePhotoEditor(who(d, 'smo'), d.positions, crew), true);
  assert.equal(isSitePhotoEditor(who(d, 'chair'), d.positions, crew), true);
  assert.equal(isSitePhotoEditor(who(d, 'crew1'), d.positions, crew), true);
  assert.equal(isSitePhotoEditor(who(d, 'crew1'), d.positions, []), false);
  assert.equal(isSitePhotoEditor(who(d, 'sec'), d.positions, crew), false);
  assert.equal(isSitePhotoEditor(null, d.positions, crew), false);
});

test('picking a chat photo: refusals in order, own photo goes live, someone else’s waits', () => {
  const d = data();
  const smo = who(d, 'smo');
  const list = [photo('p1', { mediaId: 'taken' }), photo('p2', { mediaId: 'freed', status: 'removed', removedAt: '2026-10-21T00:00:00.000Z' })];
  assert.equal(pickProblem(null, d.positions, crew, chatPhoto('a'), list, ok), 'Sign in first.');
  assert.equal(pickProblem(who(d, 'applicant'), d.positions, crew, chatPhoto('a'), list, ok), 'Only approved members can do that.');
  assert.equal(pickProblem(who(d, 'sec'), d.positions, crew, chatPhoto('a'), list, ok), NOT_PHOTO_EDITOR);
  assert.equal(pickProblem(smo, d.positions, crew, undefined, list, ok), PHOTO_GONE);
  assert.equal(pickProblem(smo, d.positions, crew, { ...chatPhoto('v'), media: media('v', 'video') }, list, ok), NOT_A_PHOTO);
  assert.equal(pickProblem(smo, d.positions, crew, chatPhoto('a', 'snap', { chatKind: 'direct' }), list, ok), PRIVATE_PHOTO);
  assert.equal(pickProblem(smo, d.positions, crew, chatPhoto('taken'), list, ok), PHOTO_ALREADY_PICKED);
  assert.equal(pickProblem(smo, d.positions, crew, chatPhoto('a'), list, { ...ok, consent: false }), NO_CONSENT_TICK);
  assert.equal(pickProblem(smo, d.positions, crew, chatPhoto('a'), list, { ...ok, caption: 'x'.repeat(CAPTION_MAX + 1) }), LONG_CAPTION);
  assert.equal(pickProblem(smo, d.positions, crew, chatPhoto('a'), list, ok), null);
  // A photo taken down once can go up again; the crew can pick too.
  assert.equal(pickProblem(who(d, 'crew1'), d.positions, crew, chatPhoto('freed'), list, { caption: '  ', consent: true }), null);
  assert.equal(pickGoesLive(smo, chatPhoto('a', 'smo')), true);
  assert.equal(pickGoesLive(smo, chatPhoto('a', 'snap')), false);
  assert.equal(cleanCaption('  Spring run  '), 'Spring run');
  assert.equal(cleanCaption('   '), null);
});

test('uploading from the phone: editors only, with the tick', () => {
  const d = data();
  assert.equal(uploadProblem(who(d, 'rider'), d.positions, crew, ok), NOT_PHOTO_EDITOR);
  assert.equal(uploadProblem(who(d, 'crew1'), d.positions, crew, { ...ok, consent: false }), NO_CONSENT_TICK);
  assert.equal(uploadProblem(who(d, 'chair'), d.positions, crew, ok), null);
});

test('answering an ask: only the poster, only while it waits', () => {
  const d = data();
  const waiting = photo('w', { status: 'waiting' });
  assert.equal(answerProblem(null, waiting), 'Sign in first.');
  assert.equal(answerProblem(who(d, 'snap'), undefined), PHOTO_GONE);
  assert.equal(answerProblem(who(d, 'smo'), waiting), NOT_YOUR_ASK);
  assert.equal(answerProblem(who(d, 'snap'), photo('l')), ASK_ANSWERED);
  assert.equal(answerProblem(who(d, 'snap'), waiting), null);
  assert.deepEqual(myAsks(who(d, 'snap'), [photo('l'), waiting, photo('w2', { status: 'waiting', postedBy: 'rider' })]).map((p) => p.id), ['w']);
  assert.deepEqual(myAsks(null, [waiting]), []);
});

test('taking down: any editor or the poster, once', () => {
  const d = data();
  assert.equal(removeProblem(who(d, 'rider'), d.positions, crew, photo('l')), NOT_PHOTO_REMOVER);
  assert.equal(removeProblem(who(d, 'smo'), d.positions, crew, undefined), PHOTO_GONE);
  assert.equal(removeProblem(who(d, 'snap'), d.positions, crew, photo('l')), null);
  assert.equal(removeProblem(who(d, 'crew1'), d.positions, crew, photo('l')), null);
  assert.equal(removeProblem(who(d, 'chair'), d.positions, crew, photo('l', { status: 'waiting' })), null);
  assert.equal(removeProblem(who(d, 'smo'), d.positions, crew, photo('l', { status: 'removed', removedAt: '2026-10-21T00:00:00.000Z' })), PHOTO_REMOVED_ALREADY);
});

test('the crew: the SMO or NEC adds approved members not on hiatus, and takes them off', () => {
  const d = data();
  const smo = who(d, 'smo');
  assert.equal(crewProblem(who(d, 'crew1'), d.positions, crew, who(d, 'rider'), true), NOT_CREW_MANAGER);
  assert.equal(crewProblem(smo, d.positions, crew, undefined, true), CREW_NOT_MEMBER);
  assert.equal(crewProblem(smo, d.positions, crew, who(d, 'applicant'), true), CREW_NOT_MEMBER);
  assert.equal(crewProblem(smo, d.positions, crew, who(d, 'hiatus'), true), CREW_ON_HIATUS);
  assert.equal(crewProblem(smo, d.positions, crew, who(d, 'crew1'), true), CREW_ALREADY);
  assert.equal(crewProblem(smo, d.positions, crew, who(d, 'rider'), true), null);
  assert.equal(crewProblem(who(d, 'chair'), d.positions, crew, who(d, 'fng'), true), null);
  assert.equal(crewProblem(smo, d.positions, crew, who(d, 'rider'), false), NOT_ON_CREW);
  assert.equal(crewProblem(smo, d.positions, crew, who(d, 'crew1'), false), null);
});

test('the editor’s list order and the website’s list', () => {
  const list = [
    photo('old-live', { pickedAt: '2026-10-01T00:00:00.000Z' }),
    photo('gone', { status: 'removed', removedAt: '2026-10-22T00:00:00.000Z' }),
    photo('ask', { status: 'waiting', pickedAt: '2026-10-25T00:00:00.000Z' }),
    photo('no', { status: 'declined', pickedAt: '2026-10-24T00:00:00.000Z' }),
    photo('new-live', { pickedAt: '2026-10-23T00:00:00.000Z', source: 'upload', bucket: 'site-media', mediaId: null, caption: 'Big 4' }),
  ];
  assert.deepEqual(editorListOrder(list).map((p) => p.id), ['new-live', 'old-live', 'ask', 'no', 'gone']);
  const pub = publicSitePhotos(list, (p) => p.pickedAt);
  assert.deepEqual(pub.map((p) => p.id), ['new-live', 'old-live']);
  assert.deepEqual(Object.keys(pub[0]).sort(), ['bucket', 'caption', 'height', 'id', 'path', 'taken_at', 'width']);
  const many = Array.from({ length: PHOTOS_SHOWN + 5 }, (_, i) => photo(`p${String(i).padStart(3, '0')}`, { pickedAt: `2026-0${1 + (i % 9)}-01T00:00:00.000Z` }));
  assert.equal(publicSitePhotos(many, (p) => p.pickedAt).length, PHOTOS_SHOWN);
});
