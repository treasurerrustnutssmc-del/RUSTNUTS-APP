import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_FEEDBACK_KIND,
  BAD_FEEDBACK_STATUS,
  FEEDBACK_GONE,
  FEEDBACK_PER_DAY,
  LONG_FEEDBACK,
  LONG_FEEDBACK_REPLY,
  LONG_FEEDBACK_WHERE,
  NO_FEEDBACK,
  NOT_FEEDBACK_KEEPER,
  TOO_MUCH_FEEDBACK,
  answerFeedbackProblem,
  deviceLine,
  feedbackKindLabel,
  feedbackMailto,
  feedbackSeenBy,
  feedbackStatusLabel,
  isFeedbackKeeper,
  sendFeedbackProblem,
  type Feedback,
} from './feedback';
import type { Member, Position } from './types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member =>
  ({
    chapterId: 'ch-west',
    fullName: m.id,
    roadName: null,
    status: 'full',
    approval: 'approved',
    joinedOn: null,
    patchedOn: null,
    fngStartedOn: null,
    bio: null,
    sharePhone: false,
    appliedOn: null,
    onHiatus: false,
    ...m,
  }) as Member;
const seat = (memberId: string, role: Position['role'], chapterId: string | null = 'ch-west'): Position => ({
  id: `p-${memberId}-${role}`,
  memberId,
  chapterId,
  role,
  startedOn: '2025-01-01',
  endedOn: null,
});

const jeff = member({ id: 'jeff' });
const roger = member({ id: 'roger' });
const chair = member({ id: 'chair', chapterId: 'ch-north' });
const nell = member({ id: 'nell' });
const fam = member({ id: 'fam', status: 'family' });
const pending = member({ id: 'pending', approval: 'pending' });
const positions = [
  seat('jeff', 'treasurer'),
  seat('roger', 'president'),
  seat('chair', 'nec_chair', null),
  { ...seat('nell', 'treasurer', 'ch-north'), endedOn: '2025-06-30' },
];

const report = (f: Partial<Feedback> & Pick<Feedback, 'id'>): Feedback => ({
  memberId: 'nell',
  memberName: 'Nell',
  memberEmail: null,
  kind: 'bug',
  body: 'The map is blank',
  whereInApp: null,
  screenshotPath: null,
  appVersion: '0.1.0',
  build: 'abc',
  device: 'Android 15 · SM-S938B',
  status: 'new',
  reply: null,
  repliedAt: null,
  createdAt: '2026-11-01T01:00:00Z',
  ...f,
});

test('keepers: a sitting Treasurer or NEC officer, not other board, ended seats, Family or applicants', () => {
  assert.equal(isFeedbackKeeper(jeff, positions), true);
  assert.equal(isFeedbackKeeper(chair, positions), true);
  assert.equal(isFeedbackKeeper(roger, positions), false);
  assert.equal(isFeedbackKeeper(nell, positions), false);
  assert.equal(isFeedbackKeeper(member({ id: 'jeff', status: 'family' }), positions), false);
  assert.equal(isFeedbackKeeper(member({ id: 'jeff', approval: 'pending' }), positions), false);
  assert.equal(isFeedbackKeeper(null, positions), false);
});

test('sending: the refusals in order, with the same words as the database', () => {
  const ok = { kind: 'bug', body: 'The map is blank', whereInApp: '', sentToday: 0 };
  assert.equal(sendFeedbackProblem(null, ok), 'Sign in first.');
  assert.equal(sendFeedbackProblem(pending, ok), 'Only approved members can do that.');
  assert.equal(sendFeedbackProblem(nell, { ...ok, kind: '' }), BAD_FEEDBACK_KIND);
  assert.equal(sendFeedbackProblem(nell, { ...ok, kind: 'rant' }), BAD_FEEDBACK_KIND);
  assert.equal(sendFeedbackProblem(nell, { ...ok, body: '  ' }), NO_FEEDBACK);
  assert.equal(sendFeedbackProblem(nell, { ...ok, body: 'x'.repeat(1001) }), LONG_FEEDBACK);
  assert.equal(sendFeedbackProblem(nell, { ...ok, whereInApp: 'x'.repeat(61) }), LONG_FEEDBACK_WHERE);
  assert.equal(sendFeedbackProblem(nell, { ...ok, sentToday: FEEDBACK_PER_DAY }), TOO_MUCH_FEEDBACK);
  assert.equal(sendFeedbackProblem(nell, { ...ok, sentToday: FEEDBACK_PER_DAY - 1 }), null);
  assert.equal(sendFeedbackProblem(nell, ok), null);
  // Family use the app too, so they can report on it.
  assert.equal(sendFeedbackProblem(fam, ok), null);
});

test('who sees what: a sender their own, a keeper the lot, in Board order', () => {
  const list = [
    report({ id: 'a', status: 'done', createdAt: '2026-11-01T05:00:00Z' }),
    report({ id: 'b', status: 'new', createdAt: '2026-11-01T01:00:00Z' }),
    report({ id: 'c', memberId: 'roger', status: 'looking', createdAt: '2026-11-01T03:00:00Z' }),
    report({ id: 'd', status: 'new', createdAt: '2026-11-01T02:00:00Z' }),
    report({ id: 'e', memberId: 'roger', status: 'new', createdAt: '2026-10-30T02:00:00Z' }),
  ];
  const ids = (l: Feedback[]) => l.map((f) => f.id).join(',');
  assert.equal(ids(feedbackSeenBy(jeff, positions, list)), 'd,b,e,c,a');
  assert.equal(ids(feedbackSeenBy(nell, positions, list)), 'd,b,a');
  assert.equal(ids(feedbackSeenBy(roger, positions, list)), 'e,c');
  assert.equal(ids(feedbackSeenBy(null, positions, list)), '');
});

test('answering: keepers only, a real report, a known status, a short reply', () => {
  const open = report({ id: 'a' });
  assert.equal(answerFeedbackProblem(null, positions, open, 'done', ''), 'Sign in first.');
  assert.equal(answerFeedbackProblem(pending, positions, open, 'done', ''), 'Only approved members can do that.');
  assert.equal(answerFeedbackProblem(roger, positions, open, 'done', ''), NOT_FEEDBACK_KEEPER);
  assert.equal(answerFeedbackProblem(jeff, positions, null, 'done', ''), FEEDBACK_GONE);
  assert.equal(answerFeedbackProblem(jeff, positions, open, 'fixed', ''), BAD_FEEDBACK_STATUS);
  assert.equal(answerFeedbackProblem(jeff, positions, open, 'done', 'x'.repeat(601)), LONG_FEEDBACK_REPLY);
  assert.equal(answerFeedbackProblem(jeff, positions, open, 'looking', 'On it.'), null);
  assert.equal(answerFeedbackProblem(chair, positions, open, 'done', ''), null);
});

test('labels, the device line and the email button', () => {
  assert.equal(feedbackKindLabel('bug'), 'Something’s wrong');
  assert.equal(feedbackKindLabel('idea'), 'An idea');
  assert.equal(feedbackKindLabel('other'), 'Other');
  assert.equal(feedbackStatusLabel('new'), 'New');
  assert.equal(feedbackStatusLabel('looking'), 'Looking into it');
  assert.equal(feedbackStatusLabel('done'), 'Done');
  assert.equal(deviceLine({ appVersion: '0.1.0', build: '3f2a9c1d-aaaa', device: 'Android 15 · SM-S938B' }), 'v0.1.0 · update 3f2a9c1d · Android 15 · SM-S938B');
  assert.equal(deviceLine({ appVersion: '0.1.0', build: 'embedded', device: '' }), 'v0.1.0 · embedded');
  assert.equal(deviceLine({ appVersion: '', build: '', device: '' }), 'unknown');
  const f = report({ id: 'a', memberName: 'Nell', memberEmail: 'nell@example.com' });
  assert.equal(feedbackMailto(f), 'mailto:nell%40example.com?subject=Your%20Rustnuts%20app%20feedback&body=Hi%20Nell%2C%0A%0A');
  assert.equal(feedbackMailto({ ...f, memberEmail: null }), null);
});
