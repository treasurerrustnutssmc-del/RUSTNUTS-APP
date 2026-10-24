import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import * as act from './businessActions';
import { toBusiness } from './businessLive';
import type { DemoCtx } from './demoActions';
import type { ClubData } from '../domain/types';

const me = (id: string) => DEMO_DATA.members.find((m) => m.id === id)!;
const NOW = '2026-10-24T02:00:00.000Z';
const ctx = (who: string, data: ClubData = DEMO_DATA, now = NOW): DemoCtx => ({ data, me: me(who), today: '2026-10-24', now });

test('a meeting is saved trimmed, then its minutes drafted, approved and locked', () => {
  const saved = act.saveMeeting(ctx('m-torque'), {
    id: null, chapterId: 'ch-west', kind: 'general', title: '  November general ', startsAt: '2026-11-03T08:30:00.000Z',
    location: ' ', agenda: [{ title: ' Christmas ride ', notes: ' ' }],
  });
  const m = saved.data.meetings!.find((x) => x.id === saved.id)!;
  assert.equal(m.title, 'November general');
  assert.equal(m.location, null);
  assert.deepEqual(m.agenda, [{ title: 'Christmas ride', notes: null }]);
  assert.equal(m.createdBy, 'm-torque');

  let data = act.saveMinutes(ctx('m-torque', saved.data), saved.id, 'All present.');
  assert.throws(() => act.approveMinutes(ctx('m-torque', data), saved.id), /hasn’t happened yet/);
  data = act.approveMinutes(ctx('m-torque', data, '2026-11-04T00:00:00.000Z'), saved.id);
  const approved = data.meetings!.find((x) => x.id === saved.id)!;
  assert.equal(approved.minutesApprovedBy, 'm-torque');
  assert.throws(() => act.saveMinutes(ctx('m-torque', data), saved.id, 'Changed'), /approved and locked/);
});

test('editing a meeting keeps its minutes', () => {
  const first = act.saveMeeting(ctx('m-torque'), {
    id: null, chapterId: 'ch-west', kind: 'board', title: 'Board', startsAt: '2026-11-03T08:30:00.000Z', location: null, agenda: [],
  });
  const drafted = act.saveMinutes(ctx('m-torque', first.data), first.id, 'Notes');
  const edited = act.saveMeeting(ctx('m-torque', drafted), {
    id: first.id, chapterId: 'ch-west', kind: 'board', title: 'Board (moved)', startsAt: '2026-11-04T08:30:00.000Z', location: null, agenda: [],
  });
  assert.equal(edited.id, first.id);
  const m = edited.data.meetings!.find((x) => x.id === first.id)!;
  assert.equal(m.title, 'Board (moved)');
  assert.equal(m.minutes, 'Notes');
});

test('action items: the owner ticks them off on the Melbourne date', () => {
  const saved = act.saveActionItem(ctx('m-torque'), {
    id: null, chapterId: 'ch-west', meetingId: null, title: ' Book the hall ', ownerId: 'm-spanner', dueOn: '2026-11-20',
  });
  assert.equal(saved.data.actionItems!.find((a) => a.id === saved.id)!.title, 'Book the hall');
  // 14:00 UTC on the 24th is already the 25th in Melbourne.
  const done = act.setActionDone(ctx('m-spanner', saved.data, '2026-10-24T14:00:00.000Z'), saved.id, true);
  assert.equal(done.actionItems!.find((a) => a.id === saved.id)!.doneOn, '2026-10-25');
  const undone = act.setActionDone(ctx('m-torque', done), saved.id, false);
  assert.equal(undone.actionItems!.find((a) => a.id === saved.id)!.doneOn, null);
});

test('a secret vote: the electorate is fixed, ballots carry no voter, and the count comes at closing', () => {
  const opened = act.openVote(ctx('m-torque'), {
    chapterId: 'ch-west', meetingId: null, subjectMemberId: null, question: ' New patch design? ', details: '',
    electorate: 'chapter_board', threshold: 'two_thirds', secret: true, quorum: 3, closesAt: '2026-10-31T02:00:00.000Z',
  });
  let data = opened.data;
  const id = opened.id;
  const vote = () => data.votes!.find((v) => v.id === id)!;
  assert.equal(vote().question, 'New patch design?');
  assert.equal(vote().details, null);
  assert.deepEqual(vote().electorIds, ['m-diesel', 'm-gravel', 'm-rusty', 'm-sparks', 'm-torque']);

  for (const [who, choice] of [['m-torque', 'yes'], ['m-rusty', 'yes'], ['m-diesel', 'no'], ['m-gravel', 'yes'], ['m-sparks', 'abstain']] as const) {
    data = act.castBallot(ctx(who, data), id, choice);
  }
  assert.ok(vote().ballots.every((b) => b.memberId === null), 'no voter on a secret ballot');
  assert.equal(vote().tally, null, 'no count while open');
  data = act.closeVote(ctx('m-torque', data), id, null);
  assert.deepEqual(vote().tally, { yes: 3, no: 1, abstain: 1 });
  assert.equal(vote().result, 'carried');
  assert.ok(vote().closedAt);
});

test('a tie goes to the chair', () => {
  const opened = act.openVote(ctx('m-torque'), {
    chapterId: 'ch-west', meetingId: null, subjectMemberId: null, question: 'Tie?', details: null,
    electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 4, closesAt: '2026-10-31T02:00:00.000Z',
  });
  let data = opened.data;
  for (const [who, choice] of [['m-torque', 'yes'], ['m-rusty', 'no'], ['m-diesel', 'no'], ['m-gravel', 'yes']] as const) {
    data = act.castBallot(ctx(who, data), opened.id, choice);
  }
  const later = '2026-10-31T03:00:00.000Z';
  assert.throws(() => act.closeVote(ctx('m-torque', data, later), opened.id, null), /chair closes it/);
  data = act.closeVote(ctx('m-rusty', data, later), opened.id, 'yes');
  const v = data.votes!.find((x) => x.id === opened.id)!;
  assert.equal(v.result, 'carried');
  assert.equal(v.castingVote, 'yes');
  assert.deepEqual(v.ballots.find((b) => b.memberId === 'm-rusty'), { memberId: 'm-rusty', choice: 'no' }, 'an open vote names its voters');
});

test('the live business read becomes app records', () => {
  const b = toBusiness({
    meetings: [{
      id: 'mt1', chapter_id: 'c1', kind: 'general', title: 'General', starts_at: '2026-11-03T08:30:00+00:00', location: null,
      agenda: [{ title: 'Treasurer', notes: null }], minutes: null, minutes_approved_at: null, minutes_approved_by: null,
      cancelled_at: null, created_by: 'm1',
    }],
    action_items: [{ id: 'a1', meeting_id: 'mt1', chapter_id: 'c1', title: 'Book', owner_id: 'm2', due_on: '2026-11-20', done_on: null }],
    votes: [{
      id: 'v1', chapter_id: null, meeting_id: null, subject_member_id: null, question: 'Q?', details: null,
      electorate: 'club_patched', threshold: 'majority', secret: true, quorum: 3, opened_at: '2026-10-24T02:00:00+00:00',
      closes_at: '2026-10-31T02:00:00+00:00', closed_at: '2026-10-31T03:00:00+00:00', result: 'lost', casting_vote: null,
      created_by: 'm1', tally: { yes: 1, no: 2, abstain: 0 }, elector_ids: ['m1', 'm2', 'm3'], voted_ids: ['m1', 'm2', 'm3'],
      my_voted: true, ballots: [],
    }],
  });
  assert.equal(b.meetings[0].startsAt, '2026-11-03T08:30:00.000Z');
  assert.deepEqual(b.meetings[0].agenda, [{ title: 'Treasurer', notes: null }]);
  assert.equal(b.actionItems[0].ownerId, 'm2');
  assert.equal(b.votes[0].closesAt, '2026-10-31T02:00:00.000Z');
  assert.deepEqual(b.votes[0].tally, { yes: 1, no: 2, abstain: 0 });
  assert.deepEqual(b.votes[0].electorIds, ['m1', 'm2', 'm3']);
  assert.deepEqual(toBusiness(null), { meetings: [], actionItems: [], votes: [] }, 'nothing back is nothing to show');
});
