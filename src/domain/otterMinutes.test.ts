import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceSessionFor, cleanDraft, draftMinutesProblem, minutesPeople, transcriptProblem, draftPlan, wordCount,
  TRANSCRIPT_MAX, type DraftChoices,
} from './otterMinutes';
import { club, member, session, who } from './stage4.testkit';
import type { ClubData, Meeting } from './types';

// West general meeting, Sat 24/10/2026 7:30 pm Melbourne (08:30Z).
const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'mt-1', chapterId: 'west', kind: 'general', title: 'October meeting', startsAt: '2026-10-24T08:30:00.000Z',
  location: 'The Clubrooms', agenda: [{ title: 'Treasurer’s report', notes: null }], minutes: null, minutesSharedAt: null,
  minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null, createdBy: 'sec', ...over,
});
const AFTER = '2026-10-25T00:00:00.000Z';
const TODAY = '2026-10-25';
const withMeeting = (m: Meeting, over: Partial<ClubData> = {}): ClubData => club({ meetings: [m], ...over });
const LONG = 'Speaker 1  0:00\n' + 'Right, let’s get started. '.repeat(20);

test('a transcript needs some words, can’t be huge, and must be text rather than a Word or PDF file', () => {
  assert.equal(transcriptProblem(''), 'Pick the Otter transcript or paste it in.');
  assert.equal(transcriptProblem('   \n '), 'Pick the Otter transcript or paste it in.');
  assert.equal(transcriptProblem('Speaker 1 0:00 Hi'), 'That’s too short to be a meeting. Check you have the whole transcript.');
  assert.equal(transcriptProblem('x'.repeat(TRANSCRIPT_MAX + 1)), 'That transcript is too long (about 3 hours is the most). Split it in two.');
  assert.equal(transcriptProblem('PK\u0003\u0004' + LONG), 'Export it from Otter as Text (.txt), not Word or PDF.');
  assert.equal(transcriptProblem('%PDF-1.7' + LONG), 'Export it from Otter as Text (.txt), not Word or PDF.');
  assert.equal(transcriptProblem(LONG), null);
});

test('word count', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('  Right, let’s   get\nstarted. '), 4);
});

test('only whoever runs the meeting drafts it, after it starts, until the minutes are confirmed', () => {
  const m = meeting();
  const data = withMeeting(m);
  assert.equal(draftMinutesProblem(null, m, data, AFTER), 'Sign in first.');
  assert.equal(draftMinutesProblem(who(data, 'rider'), m, data, AFTER), 'Only that chapter’s board can do that.');
  assert.equal(draftMinutesProblem(who(data, 'northsec'), m, data, AFTER), 'Only that chapter’s board can do that.');
  assert.equal(draftMinutesProblem(who(data, 'sec'), m, data, AFTER), null);
  assert.equal(draftMinutesProblem(who(data, 'sec'), undefined, data, AFTER), 'No such meeting.');
  assert.equal(draftMinutesProblem(who(data, 'sec'), m, data, '2026-10-24T08:00:00.000Z'), 'The meeting hasn’t happened yet.');
  const cancelled = meeting({ cancelledAt: '2026-10-20T00:00:00.000Z' });
  assert.equal(draftMinutesProblem(who(data, 'sec'), cancelled, withMeeting(cancelled), AFTER), 'That meeting was cancelled.');
  const locked = meeting({ minutes: 'Done', minutesApprovedAt: '2026-10-30T00:00:00.000Z', minutesApprovedBy: 'sec' });
  assert.equal(draftMinutesProblem(who(data, 'sec'), locked, withMeeting(locked), AFTER), 'Those minutes are approved and locked.');
  const whole = meeting({ chapterId: null, kind: 'nec' });
  assert.equal(draftMinutesProblem(who(data, 'sec'), whole, withMeeting(whole), AFTER), 'Only the NEC can do that.');
  assert.equal(draftMinutesProblem(who(data, 'chair'), whole, withMeeting(whole), AFTER), null);
});

test('the people sent: approved members other than Family, plus that chapter’s introduced applicants', () => {
  const data = withMeeting(meeting(), {
    members: [
      ...club().members,
      member('fam', { status: 'family' }),
      member('northapp', { chapterId: 'north', status: 'introduced', approval: 'pending', joinedOn: null }),
      member('gone', { approval: 'declined' as never }),
    ],
  });
  const ids = minutesPeople(meeting(), data).map((p) => p.id);
  assert.ok(ids.includes('rider') && ids.includes('northsec') && ids.includes('applicant') && ids.includes('legacy'));
  assert.ok(!ids.includes('fam'), 'no Family');
  assert.ok(!ids.includes('northapp'), 'another chapter’s applicant');
  assert.ok(!ids.includes('supporterapp'), 'an applicant who isn’t introduced');
  assert.ok(!ids.includes('gone'));
  const whole = minutesPeople(meeting({ chapterId: null, kind: 'nec' }), data).map((p) => p.id);
  assert.ok(!whole.includes('applicant'), 'whole-club meetings: members only');
  const rider = minutesPeople(meeting(), data).find((p) => p.id === 'rider')!;
  assert.deepEqual(rider, { id: 'rider', name: 'rider Rider', roadName: null, chapter: 'West', status: 'full' });
});

test('the draft is cleaned: unknown people unmatched, repeats dropped, bad dates cleared', () => {
  const ids = new Set(['sec', 'rider', 'tre']);
  const draft = cleanDraft(
    {
      minutes: '  MINUTES\nOpened 7:32 pm.  ',
      present: [
        { heard: 'Secretary', memberId: 'sec' },
        { heard: 'Sec again', memberId: 'sec' },
        { heard: 'Bluey', memberId: 'nobody' },
        { heard: '', memberId: null },
      ],
      apologies: [{ heard: 'Tre', memberId: 'tre' }],
      actionItems: [
        { title: 'Book the hall', ownerId: 'rider', ownerHeard: 'Rider', dueOn: '2026-11-10' },
        { title: 'Fix the banner', ownerId: 'ghost', ownerHeard: 'Ghost', dueOn: '10/11/2026' },
        { title: 'Order patches', ownerId: 'rider', ownerHeard: 'Rider', dueOn: '2026-02-30' },
        { title: '  ', ownerId: 'rider', ownerHeard: 'Rider', dueOn: null },
      ],
      checkThese: ['The vote count on the BBQ motion isn’t clear.', '  '],
    },
    ids,
  );
  assert.ok(typeof draft !== 'string');
  if (typeof draft === 'string') return;
  assert.equal(draft.minutes, 'MINUTES\nOpened 7:32 pm.');
  assert.deepEqual(draft.present, [{ heard: 'Secretary', memberId: 'sec' }, { heard: 'Bluey', memberId: null }]);
  assert.deepEqual(draft.apologies, [{ heard: 'Tre', memberId: 'tre' }]);
  assert.deepEqual(draft.actionItems, [
    { title: 'Book the hall', ownerId: 'rider', ownerHeard: 'Rider', dueOn: '2026-11-10' },
    { title: 'Fix the banner', ownerId: null, ownerHeard: 'Ghost', dueOn: null },
    { title: 'Order patches', ownerId: 'rider', ownerHeard: 'Rider', dueOn: null },
  ]);
  assert.deepEqual(draft.checkThese, ['The vote count on the BBQ motion isn’t clear.']);
});

test('a draft that came back out of shape is refused', () => {
  const ids = new Set(['sec']);
  assert.equal(cleanDraft(null, ids), 'The draft didn’t come back properly. Try again.');
  assert.equal(cleanDraft({ minutes: 3 }, ids), 'The draft didn’t come back properly. Try again.');
  assert.equal(cleanDraft({ minutes: '  ', present: [], apologies: [], actionItems: [], checkThese: [] }, ids), 'The draft came back empty. Check the transcript and try again.');
  // Missing lists are treated as empty rather than refusing a usable draft.
  const ok = cleanDraft({ minutes: 'Minutes' }, ids);
  assert.deepEqual(ok, { minutes: 'Minutes', present: [], apologies: [], actionItems: [], checkThese: [] });
});

test('attendance goes to that chapter’s meeting check-in on the meeting’s Melbourne date', () => {
  const m = meeting();
  const ride = session('cs-ride', { kind: 'ride', rideId: 'r-west', heldOn: '2026-10-24' });
  const north = session('cs-north', { chapterId: 'north' });
  const otherDay = session('cs-other', { heldOn: '2026-10-23' });
  const right = session('cs-right');
  assert.equal(attendanceSessionFor(m, withMeeting(m, { checkinSessions: [ride, north, otherDay] })), null);
  assert.equal(attendanceSessionFor(m, withMeeting(m, { checkinSessions: [ride, north, otherDay, right] }))?.id, 'cs-right');
  // A board meeting the same day isn't a meeting attendance counts.
  const board = meeting({ kind: 'board' });
  assert.equal(attendanceSessionFor(board, withMeeting(board, { checkinSessions: [right] })), null);
  // A whole-club meeting has no chapter check-in.
  const whole = meeting({ chapterId: null, kind: 'nec' });
  assert.equal(attendanceSessionFor(whole, withMeeting(whole, { checkinSessions: [right] })), null);
  // 11:30 pm UTC on the 23rd is the 24th in Melbourne.
  const late = meeting({ startsAt: '2026-10-23T23:30:00.000Z' });
  assert.equal(attendanceSessionFor(late, withMeeting(late, { checkinSessions: [right] }))?.id, 'cs-right');
});

test('using the draft: the minutes, ticks not already marked, and action items with a fitting owner', () => {
  const m = meeting();
  const data = withMeeting(m, {
    checkinSessions: [session('cs-right')],
    attendance: [{ sessionId: 'cs-right', memberId: 'rider', checkedInAt: AFTER, markedBy: null }],
  });
  const choices: DraftChoices = {
    minutes: ' Edited minutes ',
    present: ['sec', 'rider', 'tre', 'northsec', 'fam-missing'],
    actionItems: [
      { title: 'Book the hall', ownerId: 'rider', dueOn: '2026-11-10' },
      { title: 'North job', ownerId: 'northsec', dueOn: null },
      { title: 'Legacy job', ownerId: 'legacy', dueOn: null },
    ],
  };
  const plan = draftPlan(who(data, 'sec'), m, choices, data, TODAY);
  assert.equal(plan.minutes, 'Edited minutes');
  assert.equal(plan.sessionId, 'cs-right');
  // rider already ticked; northsec is an approved member (visitors count); unknown ids are skipped.
  assert.deepEqual(plan.markPresent, ['sec', 'tre', 'northsec']);
  assert.deepEqual(plan.actionItems, [
    { id: null, chapterId: 'west', meetingId: 'mt-1', title: 'Book the hall', ownerId: 'rider', dueOn: '2026-11-10' },
  ]);
  assert.deepEqual(plan.skippedActions, ['North job', 'Legacy job']);
  // No check-in: nothing to mark.
  const none = draftPlan(who(data, 'sec'), m, choices, withMeeting(m), TODAY);
  assert.equal(none.sessionId, null);
  assert.deepEqual(none.markPresent, []);
});
