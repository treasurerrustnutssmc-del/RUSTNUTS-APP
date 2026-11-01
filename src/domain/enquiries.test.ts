import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_ENQUIRY_EMAIL,
  ENQUIRY_CHAPTERS,
  ENQUIRY_GONE,
  ENQUIRY_HANDLED_ALREADY,
  LONG_ENQUIRY_ABOUT,
  LONG_ENQUIRY_NAME,
  LONG_ENQUIRY_NOTE,
  NO_ENQUIRY_CHAPTER,
  NO_ENQUIRY_NAME,
  NOT_ENQUIRY_READER,
  TOO_MANY_ENQUIRIES,
  cleanEnquiry,
  enquiriesSeenBy,
  enquiryChapterLabel,
  enquiryProblem,
  handleEnquiryProblem,
  mailtoFor,
  type Enquiry,
} from './enquiries';
import type { Member, Position } from './types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west',
  fullName: m.id,
  roadName: null,
  status: 'full',
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  phone: null,
  sharePhone: false,
  bikes: [],
  ...m,
} as Member);
const seat = (memberId: string, role: Position['role'], chapterId: string | null = 'ch-west'): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});

const pres = member({ id: 'pres' });
const nec = member({ id: 'nec', chapterId: 'ch-north' });
const nell = member({ id: 'nell' });
const pending = member({ id: 'pending', approval: 'pending' });
const positions = [seat('pres', 'president'), seat('nec', 'nec_chair', null)];

const enquiry = (e: Partial<Enquiry> & Pick<Enquiry, 'id'>): Enquiry => ({
  name: 'Sam Rider',
  email: 'sam@example.com',
  chapter: 'west',
  about: 'Ride a Street Glide, keen for Sunday runs.',
  createdAt: '2026-11-01T06:00:00Z',
  handledAt: null,
  handledBy: null,
  note: null,
  ...e,
});

test('the form checks happen in order with the same words as the database', () => {
  const ok = { name: 'Sam Rider', email: 'sam@example.com', chapter: 'west', about: '' };
  assert.equal(enquiryProblem(ok), null);
  assert.equal(enquiryProblem({ ...ok, name: '  ' }), NO_ENQUIRY_NAME);
  assert.equal(enquiryProblem({ ...ok, name: 'x'.repeat(81) }), LONG_ENQUIRY_NAME);
  assert.equal(enquiryProblem({ ...ok, email: 'sam' }), BAD_ENQUIRY_EMAIL);
  assert.equal(enquiryProblem({ ...ok, email: 'sam@example' }), BAD_ENQUIRY_EMAIL);
  assert.equal(enquiryProblem({ ...ok, email: `${'s'.repeat(195)}@ex.com` }), BAD_ENQUIRY_EMAIL);
  assert.equal(enquiryProblem({ ...ok, chapter: 'south' }), NO_ENQUIRY_CHAPTER);
  assert.equal(enquiryProblem({ ...ok, about: 'x'.repeat(601) }), LONG_ENQUIRY_ABOUT);
  assert.deepEqual(ENQUIRY_CHAPTERS, ['west', 'north', 'either']);
});

test('cleaning trims, lowercases the email and leaves an empty about as null', () => {
  assert.deepEqual(cleanEnquiry({ name: '  Sam Rider ', email: ' Sam@Example.com ', chapter: 'either', about: '  ' }), {
    name: 'Sam Rider',
    email: 'sam@example.com',
    chapter: 'either',
    about: null,
  });
});

test('a chapter board sees its own chapter and "either"; the NEC sees the lot; others nothing', () => {
  const list = [
    enquiry({ id: 'w', chapter: 'west' }),
    enquiry({ id: 'n', chapter: 'north' }),
    enquiry({ id: 'e', chapter: 'either' }),
  ];
  const chapters = [{ id: 'ch-west', slug: 'west' }, { id: 'ch-north', slug: 'north' }];
  assert.deepEqual(enquiriesSeenBy(pres, positions, chapters, list).map((e) => e.id), ['w', 'e']);
  assert.deepEqual(enquiriesSeenBy(nec, positions, chapters, list).map((e) => e.id), ['w', 'n', 'e']);
  assert.deepEqual(enquiriesSeenBy(nell, positions, chapters, list), []);
  assert.deepEqual(enquiriesSeenBy(null, positions, chapters, list), []);
});

test('open enquiries come first, newest first, then handled ones', () => {
  const list = [
    enquiry({ id: 'old-open', createdAt: '2026-10-01T00:00:00Z' }),
    enquiry({ id: 'done', createdAt: '2026-10-20T00:00:00Z', handledAt: '2026-10-21T00:00:00Z', handledBy: 'pres' }),
    enquiry({ id: 'new-open', createdAt: '2026-10-30T00:00:00Z' }),
  ];
  const chapters = [{ id: 'ch-west', slug: 'west' }];
  assert.deepEqual(enquiriesSeenBy(pres, positions, chapters, list).map((e) => e.id), ['new-open', 'old-open', 'done']);
});

test('handling: board only, must exist, once, with a short note', () => {
  const e = enquiry({ id: 'w' });
  const done = enquiry({ id: 'd', handledAt: '2026-10-21T00:00:00Z', handledBy: 'pres' });
  assert.equal(handleEnquiryProblem(pres, positions, e, ''), null);
  assert.equal(handleEnquiryProblem(pres, positions, e, 'Rang him, coming Sunday'), null);
  assert.equal(handleEnquiryProblem(null, positions, e, ''), 'Sign in first.');
  assert.equal(handleEnquiryProblem(pending, positions, e, ''), 'Only approved members can do that.');
  assert.equal(handleEnquiryProblem(nell, positions, e, ''), NOT_ENQUIRY_READER);
  assert.equal(handleEnquiryProblem(pres, positions, null, ''), ENQUIRY_GONE);
  assert.equal(handleEnquiryProblem(pres, positions, done, ''), ENQUIRY_HANDLED_ALREADY);
  assert.equal(handleEnquiryProblem(pres, positions, e, 'x'.repeat(301)), LONG_ENQUIRY_NOTE);
});

test('the email button opens a reply with a club subject', () => {
  const url = mailtoFor(enquiry({ id: 'w', email: 'sam@example.com', name: 'Sam Rider' }));
  assert.ok(url.startsWith('mailto:sam%40example.com?subject='), url);
  assert.ok(decodeURIComponent(url).includes('Rustnuts SMC'));
});

test('chapter labels and the spam message', () => {
  assert.equal(enquiryChapterLabel('west'), 'West');
  assert.equal(enquiryChapterLabel('north'), 'North');
  assert.equal(enquiryChapterLabel('either'), 'Either chapter');
  assert.equal(TOO_MANY_ENQUIRIES, 'Too many enquiries just now. Try again later, or email the club.');
});
