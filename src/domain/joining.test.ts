import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideApplicationProblem, fngDue, fngOutcomeStatus, fngReviewProblem, introProgress, votesProblem } from './joining';
import { club, member, session, who } from './stage4.testkit';
import type { MemberDecision, Votes } from './types';

const none: Votes = { for: null, against: null, abstained: null };

const review = (memberId: string, atMonths: number, decidedOn: string): MemberDecision => ({
  id: `d-${atMonths}`, memberId, kind: 'fng_review', atMonths, outcome: 'continue', status: null,
  votesFor: null, votesAgainst: null, votesAbstained: null, note: null, decidedOn, recordedBy: 'sec',
});

test('introduction phase: three months, two meetings and a member ride, counted from when they asked', () => {
  const sessions = [
    session('m-before', { heldOn: '2026-06-20' }),
    session('m1', { heldOn: '2026-07-15' }),
    session('m2', { heldOn: '2026-08-19' }),
    session('r1', { kind: 'ride', rideId: 'r-west', heldOn: '2026-09-06' }),
  ];
  const went = (ids: string[]) => ids.map((sessionId) => ({ sessionId, memberId: 'applicant', checkedInAt: '2026-07-15T09:00:00.000Z', markedBy: 'sec' }));

  const early = introProgress(who(club(), 'applicant'), club({ checkinSessions: sessions, attendance: went(['m-before', 'm1']) }), '2026-08-01');
  assert.equal(early.startedOn, '2026-07-01');
  assert.equal(early.endsOn, '2026-10-01');
  assert.equal(early.daysLeft, 61);
  assert.equal(early.meetings, 1, 'a meeting before they asked doesn’t count');
  assert.equal(early.rides, 0);
  assert.deepEqual([early.timeDone, early.meetingsDone, early.ridesDone, early.ready], [false, false, false, false]);

  const done = introProgress(who(club(), 'applicant'), club({ checkinSessions: sessions, attendance: went(['m1', 'm2', 'r1']) }), '2026-10-01');
  assert.equal(done.daysLeft, 0);
  assert.deepEqual([done.timeDone, done.meetingsDone, done.ridesDone, done.ready], [true, true, true, true]);
});

test('the due FNG review: the latest one missed, otherwise the next one coming', () => {
  const fng = (start: string) => member('f', { status: 'fng', fngStartedOn: start });
  assert.deepEqual(fngDue(fng('2026-10-24'), [], '2026-10-24'), { atMonths: 6, date: '2027-04-24', overdue: false });
  assert.deepEqual(fngDue(fng('2026-03-24'), [], '2026-10-24'), { atMonths: 6, date: '2026-09-24', overdue: true });
  assert.deepEqual(fngDue(fng('2025-02-24'), [], '2026-10-24'), { atMonths: 18, date: '2026-08-24', overdue: true }, '20 months in');
  assert.deepEqual(fngDue(fng('2026-03-24'), [review('f', 6, '2026-09-30')], '2026-10-24'), { atMonths: 9, date: '2026-12-24', overdue: false });
  assert.deepEqual(fngDue(fng('2025-02-24'), [review('f', 12, '2026-02-24')], '2026-10-24'), { atMonths: 18, date: '2026-08-24', overdue: true });
  // The review's own day isn't overdue yet.
  assert.deepEqual(fngDue(fng('2026-04-24'), [], '2026-10-24'), { atMonths: 6, date: '2026-10-24', overdue: false });
  // Another member's review doesn't count.
  assert.deepEqual(fngDue(fng('2026-03-24'), [review('other', 6, '2026-09-30')], '2026-10-24')?.atMonths, 6);
  assert.equal(fngDue(member('x', { status: 'full', fngStartedOn: '2025-01-01' }), [], '2026-10-24'), null);
  assert.equal(fngDue(member('x', { status: 'fng', fngStartedOn: null }), [], '2026-10-24'), null);
});

test('vote counts', () => {
  assert.equal(votesProblem(none), null);
  assert.equal(votesProblem({ for: 5, against: 0, abstained: 1 }), null);
  assert.equal(votesProblem({ for: -1, against: 0, abstained: 0 }), 'Vote counts can’t be negative.');
  assert.equal(votesProblem({ for: 1.5, against: 0, abstained: 0 }), 'Vote counts can’t be negative.');
});

test('deciding an application', () => {
  const data = club();
  const sec = who(data, 'sec');
  const applicant = who(data, 'applicant');
  assert.equal(decideApplicationProblem(sec, applicant, 'fng', { for: 6, against: 0, abstained: 0 }, data), null);
  assert.equal(decideApplicationProblem(sec, applicant, null, none, data), null);
  assert.equal(decideApplicationProblem(who(data, 'northsec'), applicant, 'fng', none, data), 'Only the West board can approve this applicant.');
  assert.equal(decideApplicationProblem(who(data, 'northsec'), applicant, null, none, data), 'Only that chapter’s board can decline this applicant.');
  assert.equal(decideApplicationProblem(sec, who(data, 'rider'), 'fng', none, data), 'This person isn’t waiting for approval.');
  assert.equal(decideApplicationProblem(sec, who(data, 'rider'), null, none, data), 'This person isn’t waiting for approval.');
  assert.equal(decideApplicationProblem(sec, applicant, 'full', none, data), 'Let them in as Introduced, FNG, Supporter or Family.');
  assert.equal(decideApplicationProblem(sec, applicant, 'fng', { for: -2, against: 0, abstained: 0 }, data), 'Vote counts can’t be negative.');
  assert.equal(decideApplicationProblem(null, applicant, 'fng', none, data), 'Only the West board can approve this applicant.');
});

test('recording an FNG review', () => {
  const data = club(); // fng started 2026-04-24: the 6-month review falls due today
  const sec = who(data, 'sec');
  const fng = who(data, 'fng');
  const today = '2026-10-24';
  assert.equal(fngReviewProblem(sec, fng, 6, 'continue', none, data, today), null);
  assert.equal(fngReviewProblem(sec, fng, 6, 'patch', { for: 9, against: 0, abstained: 1 }, data, today), null);
  assert.equal(fngReviewProblem(sec, fng, 6, 'not_continuing', none, data, today), null);
  assert.equal(fngReviewProblem(null, fng, 6, 'continue', none, data, today), 'Sign in first.');
  assert.equal(fngReviewProblem(fng, fng, 6, 'continue', none, data, today), 'You can’t record your own review.');
  assert.equal(fngReviewProblem(who(data, 'rider'), fng, 6, 'continue', none, data, today), 'Only that chapter’s board can record this review.');
  assert.equal(fngReviewProblem(who(data, 'northsec'), fng, 6, 'continue', none, data, today), 'Only that chapter’s board can record this review.');
  assert.equal(fngReviewProblem(sec, who(data, 'rider'), 6, 'continue', none, data, today), 'They’re not an FNG.');
  assert.equal(fngReviewProblem(sec, fng, 9, 'continue', none, data, today), 'Record the review that’s due.');
  assert.equal(fngReviewProblem(sec, fng, 6, 'continue', none, data, '2026-09-23'), 'That review isn’t due yet.');
  assert.equal(fngReviewProblem(sec, fng, 6, 'continue', none, data, '2026-09-24'), null, 'up to 30 days early is fine');
  assert.equal(fngReviewProblem(sec, fng, 6, 'continue', { for: 1, against: -1, abstained: 0 }, data, today), 'Vote counts can’t be negative.');
  const unanimous = 'Full membership needs a unanimous vote: at least one for and none against.';
  assert.equal(fngReviewProblem(sec, fng, 6, 'patch', none, data, today), unanimous);
  assert.equal(fngReviewProblem(sec, fng, 6, 'patch', { for: 8, against: 1, abstained: 0 }, data, today), unanimous);
  assert.equal(fngReviewProblem(sec, fng, 6, 'patch', { for: 0, against: 0, abstained: 3 }, data, today), unanimous);
});

test('what each review outcome makes them', () => {
  assert.equal(fngOutcomeStatus('continue'), 'fng');
  assert.equal(fngOutcomeStatus('patch'), 'full');
  assert.equal(fngOutcomeStatus('not_continuing'), 'supporter');
});
