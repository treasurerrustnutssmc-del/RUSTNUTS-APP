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
  assert.throws(() => act.shareMinutes(ctx('m-torque', data), saved.id), /hasn’t happened yet/);
  data = act.shareMinutes(ctx('m-torque', data, '2026-11-04T00:00:00.000Z'), saved.id);
  assert.equal(data.meetings!.find((x) => x.id === saved.id)!.minutesSharedAt, '2026-11-04T00:00:00.000Z', 'the draft is out (10.8)');
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
    chapterId: 'ch-west', meetingId: null, subjectMemberId: null, subjectRole: null, question: ' New patch design? ', details: '',
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

test('a patch vote records only its result (4.9)', () => {
  let data = DEMO_DATA;
  for (const who of ['m-chook', 'm-gravel', 'm-spanner', 'm-sparks']) data = act.castBallot(ctx(who, data), 'v-1', 'yes');
  data = act.closeVote(ctx('m-torque', data), 'v-1', null);
  const v = data.votes!.find((x) => x.id === 'v-1')!;
  assert.equal(v.result, 'carried', 'all seven said yes');
  assert.equal(v.tally, null, 'no count kept');
  assert.deepEqual(v.ballots, [], 'no ballots kept');
});

test('a removal vote of the chapter’s Full Members keeps its count; only a patch vote hides it (9.3, 4.9)', () => {
  const opened = act.openVote(ctx('m-torque'), {
    chapterId: 'ch-west', meetingId: null, subjectMemberId: 'm-diesel', subjectRole: 'road_captain', question: 'Remove Diesel as Road Captain? (9.3)',
    details: null, electorate: 'chapter_patched', threshold: 'two_thirds', secret: false, quorum: 3, closesAt: '2026-10-31T02:00:00.000Z',
  });
  let data = opened.data;
  const electors = data.votes!.find((v) => v.id === opened.id)!.electorIds;
  assert.equal(electors.length, 7, 'every West Full Member, Diesel included');
  for (const who of electors) data = act.castBallot(ctx(who, data), opened.id, who === 'm-diesel' ? 'no' : 'yes');
  data = act.closeVote(ctx('m-torque', data), opened.id, null);
  const v = data.votes!.find((x) => x.id === opened.id)!;
  assert.equal(v.result, 'carried', 'six of seven');
  assert.deepEqual(v.tally, { yes: 6, no: 1, abstain: 0 }, 'the count is kept');
  assert.equal(v.ballots.length, 7);
});

test('an NEC vote on bringing someone back keeps its count and ballots (5.6)', () => {
  const opened = act.openVote(ctx('m-rusty'), {
    chapterId: null, meetingId: null, subjectMemberId: 'm-rooster', subjectRole: null, question: 'Bring Rooster back?', details: null,
    electorate: 'nec', threshold: 'majority', secret: false, quorum: 1, closesAt: '2026-10-31T02:00:00.000Z',
  });
  let data = opened.data;
  const electors = data.votes!.find((v) => v.id === opened.id)!.electorIds;
  for (const who of electors) data = act.castBallot(ctx(who, data), opened.id, 'yes');
  data = act.closeVote(ctx('m-rusty', data), opened.id, null);
  const v = data.votes!.find((x) => x.id === opened.id)!;
  assert.equal(v.result, 'carried');
  assert.deepEqual(v.tally, { yes: electors.length, no: 0, abstain: 0 });
  assert.equal(v.ballots.length, electors.length);
});

test('a tie goes to the chair', () => {
  const opened = act.openVote(ctx('m-torque'), {
    chapterId: 'ch-west', meetingId: null, subjectMemberId: null, subjectRole: null, question: 'Tie?', details: null,
    electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 4, closesAt: '2026-10-31T02:00:00.000Z',
  });
  let data = opened.data;
  for (const [who, choice] of [['m-torque', 'yes'], ['m-rusty', 'no'], ['m-diesel', 'no'], ['m-gravel', 'yes']] as const) {
    data = act.castBallot(ctx(who, data), opened.id, choice);
  }
  const later = '2026-10-31T03:00:00.000Z';
  assert.throws(() => act.closeVote(ctx('m-torque', data, later), opened.id, null), /casting vote or lets it fall/);
  const declined = act.closeVote(ctx('m-rusty', data, later), opened.id, 'decline').votes!.find((x) => x.id === opened.id)!;
  assert.deepEqual([declined.result, declined.castingVote], ['lost', null], 'the chair declines to cast (9.10)');
  data = act.closeVote(ctx('m-rusty', data, later), opened.id, 'yes');
  const v = data.votes!.find((x) => x.id === opened.id)!;
  assert.equal(v.result, 'carried');
  assert.equal(v.castingVote, 'yes');
  assert.deepEqual(v.ballots.find((b) => b.memberId === 'm-rusty'), { memberId: 'm-rusty', choice: 'no' }, 'an open vote names its voters');
});

test('a national vote with voters from one chapter of two has no quorum (10.6)', () => {
  const open = () => act.openVote(ctx('m-rusty'), {
    chapterId: null, meetingId: null, subjectMemberId: null, subjectRole: null, question: 'Spend the kitty?', details: null,
    electorate: 'club_patched', threshold: 'majority', secret: false, quorum: 4, closesAt: '2026-10-31T02:00:00.000Z',
  });
  const later = '2026-10-31T03:00:00.000Z';
  // Four West voters: over the quorum, but North stayed home.
  let opened = open();
  let data = opened.data;
  for (const who of ['m-torque', 'm-rusty', 'm-diesel', 'm-gravel']) data = act.castBallot(ctx(who, data), opened.id, 'yes');
  data = act.closeVote(ctx('m-rusty', data, later), opened.id, null);
  let v = data.votes!.find((x) => x.id === opened.id)!;
  assert.equal(v.result, 'no_quorum');
  assert.deepEqual(v.tally, { yes: 4, no: 0, abstain: 0 }, 'the count is still kept');
  // One North voter is representation enough.
  opened = open();
  data = opened.data;
  for (const who of ['m-torque', 'm-rusty', 'm-diesel', 'm-jet']) data = act.castBallot(ctx(who, data), opened.id, 'yes');
  data = act.closeVote(ctx('m-rusty', data, later), opened.id, null);
  v = data.votes!.find((x) => x.id === opened.id)!;
  assert.equal(v.result, 'carried');
});

test('a tie on a vote about a member is lost, with no casting vote (10.7)', () => {
  // West gets a Vice President, so the NEC has two votes and can tie.
  const westVp: ClubData = {
    ...DEMO_DATA,
    positions: [...DEMO_DATA.positions, { id: 'p-vp', memberId: 'm-gravel', chapterId: 'ch-west', role: 'vice_president', startedOn: '2026-01-01', endedOn: null }],
  };
  const opened = act.openVote(ctx('m-rusty', westVp), {
    chapterId: null, meetingId: null, subjectMemberId: 'm-rooster', subjectRole: null, question: 'Bring Rooster back?', details: null,
    electorate: 'nec', threshold: 'majority', secret: false, quorum: 2, closesAt: '2026-10-31T02:00:00.000Z',
  });
  let data = opened.data;
  assert.deepEqual(data.votes!.find((x) => x.id === opened.id)!.electorIds, ['m-gravel', 'm-smokey']);
  data = act.castBallot(ctx('m-gravel', data), opened.id, 'yes');
  data = act.castBallot(ctx('m-smokey', data), opened.id, 'no');
  assert.throws(() => act.closeVote(ctx('m-rusty', data), opened.id, 'yes'), /No casting vote on a vote about a member/);
  data = act.closeVote(ctx('m-rusty', data), opened.id, null);
  const v = data.votes!.find((x) => x.id === opened.id)!;
  assert.deepEqual([v.result, v.castingVote], ['lost', null]);
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
      id: 'v1', chapter_id: null, meeting_id: null, subject_member_id: null, subject_role: 'nec_auditor', question: 'Q?', details: null,
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
  assert.equal(b.votes[0].subjectRole, 'nec_auditor');
  assert.deepEqual(toBusiness(null), { meetings: [], actionItems: [], votes: [] }, 'nothing back is nothing to show');
});
