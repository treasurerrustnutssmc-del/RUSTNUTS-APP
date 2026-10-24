import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import {
  actionItemProblem,
  approveMinutesProblem,
  canSeeActionItem,
  canSeeMeeting,
  canSeeMinutes,
  cancelMeetingProblem,
  minutesDueOn,
  minutesState,
  runsScope,
  saveMeetingProblem,
  saveMinutesProblem,
  setDoneProblem,
  type ActionItemInput,
  type MeetingInput,
} from './meetings';
import type { ActionItem, Meeting } from './types';

const d = DEMO_DATA;
const P = d.positions;
const m = (id: string) => {
  const found = d.members.find((x) => x.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};
// Demo cast: Rusty is West President and National Chairman, Torque the West Secretary, Smokey the
// North President (so on the NEC), Crank the North Road Captain, Spanner a West Tail Gunner (no
// board seat), Rooster Legacy, Dylan an applicant.

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'mt-1', chapterId: 'ch-west', kind: 'board', title: 'November board meeting',
  startsAt: '2026-11-03T08:30:00.000Z', location: 'Clubhouse', agenda: [], minutes: null,
  minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null, createdBy: 'm-torque', ...over,
});

const input = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  id: null, chapterId: 'ch-west', kind: 'board', title: 'November board meeting',
  startsAt: '2026-11-03T08:30:00.000Z', location: null, agenda: [{ title: 'Treasurer’s report', notes: null }], ...over,
});

const item = (over: Partial<ActionItem> = {}): ActionItem => ({
  id: 'ai-1', meetingId: 'mt-1', chapterId: 'ch-west', title: 'Book the hall', ownerId: 'm-spanner',
  dueOn: '2026-11-20', doneOn: null, ...over,
});

const itemInput = (over: Partial<ActionItemInput> = {}): ActionItemInput => ({
  id: null, chapterId: 'ch-west', meetingId: 'mt-1', title: 'Book the hall', ownerId: 'm-spanner', dueOn: null, ...over,
});

const NOW = '2026-10-24T02:00:00.000Z';
const AFTER = '2026-11-04T02:00:00.000Z';

test('a chapter board runs its own chapter; the NEC runs the whole club', () => {
  assert.equal(runsScope(m('m-torque'), 'ch-west', P), true);
  assert.equal(runsScope(m('m-torque'), 'ch-north', P), false);
  assert.equal(runsScope(m('m-torque'), null, P), false);
  assert.equal(runsScope(m('m-smokey'), null, P), true);
  assert.equal(runsScope(m('m-smokey'), 'ch-west', P), true, 'the NEC reaches every chapter');
  assert.equal(runsScope(m('m-spanner'), 'ch-west', P), false);
  assert.equal(runsScope(null, 'ch-west', P), false);
});

test('who sees which meetings and minutes', () => {
  const board = meeting();
  const general = meeting({ kind: 'general', minutes: 'Draft', id: 'mt-2' });
  const nec = meeting({ kind: 'nec', chapterId: null, id: 'mt-3' });
  assert.equal(canSeeMeeting(m('m-spanner'), board, P), false, 'members don’t see board meetings');
  assert.equal(canSeeMeeting(m('m-torque'), board, P), true);
  assert.equal(canSeeMeeting(m('m-crank'), board, P), false, 'nor does another chapter’s board');
  assert.equal(canSeeMeeting(m('m-spanner'), general, P), true);
  assert.equal(canSeeMeeting(m('m-jet'), general, P), true, 'general meetings are open to every chapter');
  assert.equal(canSeeMeeting(m('m-rooster'), general, P), true, 'Legacy members see what members see');
  assert.equal(canSeeMeeting(m('m-dylan'), general, P), false, 'applicants see nothing');
  assert.equal(canSeeMeeting(null, general, P), false);
  assert.equal(canSeeMeeting(m('m-torque'), nec, P), false);
  assert.equal(canSeeMeeting(m('m-smokey'), nec, P), true);

  assert.equal(canSeeMinutes(m('m-spanner'), general, P), false, 'drafts stay with the board');
  assert.equal(canSeeMinutes(m('m-torque'), general, P), true);
  const approved = { ...general, minutesApprovedAt: '2026-11-10T00:00:00.000Z' };
  assert.equal(canSeeMinutes(m('m-spanner'), approved, P), true);
  assert.equal(canSeeMinutes(m('m-spanner'), { ...board, minutesApprovedAt: '2026-11-10T00:00:00.000Z' }, P), false);
});

test('action items are seen by their owner and whoever runs the scope', () => {
  assert.equal(canSeeActionItem(m('m-spanner'), item(), P), true);
  assert.equal(canSeeActionItem(m('m-torque'), item(), P), true);
  assert.equal(canSeeActionItem(m('m-chook'), item(), P), false);
  assert.equal(canSeeActionItem(m('m-crank'), item(), P), false);
});

test('saving a meeting', () => {
  assert.equal(saveMeetingProblem(null, input(), null, d), 'Sign in first.');
  assert.equal(saveMeetingProblem(m('m-dylan'), input(), null, d), 'Only approved members can do that.');
  assert.equal(saveMeetingProblem(m('m-spanner'), input(), null, d), 'Only that chapter’s board can do that.');
  assert.equal(saveMeetingProblem(m('m-torque'), input({ chapterId: null, kind: 'nec' }), null, d), 'Only the NEC can do that.');
  assert.equal(saveMeetingProblem(m('m-torque'), input({ title: '  ' }), null, d), 'Give the meeting a title.');
  assert.equal(saveMeetingProblem(m('m-torque'), input({ startsAt: '' }), null, d), 'Pick a date and time.');
  assert.equal(saveMeetingProblem(m('m-torque'), input({ kind: 'nec' }), null, d), 'That kind of meeting doesn’t fit here.');
  assert.equal(saveMeetingProblem(m('m-smokey'), input({ chapterId: null, kind: 'board' }), null, d), 'That kind of meeting doesn’t fit here.');
  assert.equal(
    saveMeetingProblem(m('m-torque'), input({ agenda: [{ title: '', notes: 'x' }] }), null, d),
    'Each agenda item needs a title.',
  );
  assert.equal(saveMeetingProblem(m('m-torque'), input(), null, d), null);
  assert.equal(saveMeetingProblem(m('m-smokey'), input({ chapterId: null, kind: 'nec' }), null, d), null);
  assert.equal(saveMeetingProblem(m('m-torque'), input({ id: 'mt-1' }), meeting({ cancelledAt: NOW }), d), 'That meeting was cancelled.');
  assert.equal(saveMeetingProblem(m('m-torque'), input({ id: 'mt-9' }), null, d), 'No such meeting.');
  // An existing meeting can't be moved to a chapter the editor doesn't run.
  assert.equal(
    saveMeetingProblem(m('m-crank'), input({ id: 'mt-1', chapterId: 'ch-north' }), meeting(), d),
    'Only that chapter’s board can do that.',
  );
});

test('cancelling a meeting', () => {
  assert.equal(cancelMeetingProblem(m('m-torque'), undefined, d, NOW), 'No such meeting.');
  assert.equal(cancelMeetingProblem(m('m-spanner'), meeting(), d, NOW), 'Only that chapter’s board can do that.');
  assert.equal(cancelMeetingProblem(m('m-torque'), meeting(), d, AFTER), 'That meeting has already started.');
  assert.equal(cancelMeetingProblem(m('m-torque'), meeting({ cancelledAt: NOW }), d, NOW), 'That meeting was cancelled.');
  assert.equal(cancelMeetingProblem(m('m-torque'), meeting(), d, NOW), null);
});

test('writing and approving minutes', () => {
  assert.equal(saveMinutesProblem(m('m-spanner'), meeting(), d), 'Only that chapter’s board can do that.');
  assert.equal(saveMinutesProblem(m('m-torque'), meeting({ cancelledAt: NOW }), d), 'That meeting was cancelled.');
  assert.equal(saveMinutesProblem(m('m-torque'), meeting({ minutesApprovedAt: AFTER }), d), 'Those minutes are approved and locked.');
  assert.equal(saveMinutesProblem(m('m-torque'), meeting(), d), null, 'notes can be drafted ahead of the meeting');

  assert.equal(approveMinutesProblem(m('m-torque'), meeting({ minutes: 'All present.' }), d, NOW), 'The meeting hasn’t happened yet.');
  assert.equal(approveMinutesProblem(m('m-torque'), meeting({ minutes: '   ' }), d, AFTER), 'Write the minutes first.');
  assert.equal(
    approveMinutesProblem(m('m-torque'), meeting({ minutes: 'x', minutesApprovedAt: AFTER }), d, AFTER),
    'Those minutes are approved and locked.',
  );
  assert.equal(approveMinutesProblem(m('m-spanner'), meeting({ minutes: 'x' }), d, AFTER), 'Only that chapter’s board can do that.');
  assert.equal(approveMinutesProblem(m('m-torque'), meeting({ minutes: 'All present.' }), d, AFTER), null);
});

test('minutes fall due 14 Melbourne days after the meeting', () => {
  // 12:30 UTC on 3 Nov is 11:30 pm in Melbourne (AEDT): still the 3rd.
  const late = meeting({ startsAt: '2026-11-03T12:30:00.000Z' });
  assert.equal(minutesDueOn(late), '2026-11-17');
  assert.equal(minutesState(late, '2026-11-03T12:00:00.000Z'), 'upcoming');
  assert.equal(minutesState(late, '2026-11-17T12:00:00.000Z'), 'due', 'due through the 17th');
  assert.equal(minutesState(late, '2026-11-17T13:30:00.000Z'), 'overdue', '18th in Melbourne');
  assert.equal(minutesState({ ...late, minutesApprovedAt: AFTER }, '2026-12-01T00:00:00.000Z'), 'approved');
  assert.equal(minutesState({ ...late, cancelledAt: NOW }, '2026-12-01T00:00:00.000Z'), 'cancelled');
});

test('action items', () => {
  assert.equal(actionItemProblem(m('m-spanner'), itemInput(), d), 'Only that chapter’s board can do that.');
  assert.equal(actionItemProblem(m('m-torque'), itemInput({ title: ' ' }), d), 'Give the action item a title.');
  const pick = 'Pick an approved member of this chapter.';
  assert.equal(actionItemProblem(m('m-torque'), itemInput({ ownerId: '' }), d), pick);
  assert.equal(actionItemProblem(m('m-torque'), itemInput({ ownerId: 'm-jet' }), d), pick, 'North member on a West item');
  assert.equal(actionItemProblem(m('m-torque'), itemInput({ ownerId: 'm-rooster' }), d), pick, 'Legacy');
  assert.equal(actionItemProblem(m('m-torque'), itemInput({ ownerId: 'm-dylan' }), d), pick, 'applicant');
  assert.equal(actionItemProblem(m('m-torque'), itemInput(), d), null);
  assert.equal(actionItemProblem(m('m-smokey'), itemInput({ chapterId: null, meetingId: null, ownerId: 'm-jet' }), d), null);
  assert.equal(actionItemProblem(m('m-torque'), itemInput({ id: 'ai-9' }), d), 'No such action item.');

  assert.equal(setDoneProblem(m('m-torque'), undefined, d), 'No such action item.');
  assert.equal(setDoneProblem(m('m-spanner'), item(), d), null, 'the owner ticks their own');
  assert.equal(setDoneProblem(m('m-torque'), item(), d), null);
  assert.equal(setDoneProblem(m('m-chook'), item(), d), 'Only the owner or the board can tick this off.');
  assert.equal(setDoneProblem(m('m-dylan'), item(), d), 'Only approved members can do that.');
});
