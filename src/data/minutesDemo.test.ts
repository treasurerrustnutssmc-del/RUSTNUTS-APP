import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDraft, transcriptProblem, draftPlan } from '../domain/otterMinutes';
import { DEMO_DATA } from './demoData';
import { demoDraft, sampleTranscript } from './minutesDemo';

const meeting = DEMO_DATA.meetings!.find((m) => m.id === 'mt-2')!;

test('the demo’s sample transcript is long enough to draft from', () => {
  const t = sampleTranscript(meeting, DEMO_DATA);
  assert.equal(transcriptProblem(t), null, t);
  assert.match(t, /Speaker 1/);
});

test('the demo draft survives the same checks a real one does, with a visitor left unmatched', () => {
  const { draft, people } = demoDraft(meeting, DEMO_DATA);
  const cleaned = cleanDraft(draft, new Set(people.map((p) => p.id)));
  assert.deepEqual(cleaned, draft);
  assert.ok(draft.present.some((p) => p.memberId === null && p.heard === 'Bluey'));
  assert.ok(draft.present.filter((p) => p.memberId).length >= 2);
  assert.match(draft.minutes, /OCTOBER GENERAL MEETING/);
  assert.ok(draft.checkThese.length > 0);
  // Every owner is someone who can own an action item in West.
  const me = DEMO_DATA.members.find((m) => m.id === 'm-torque')!;
  const plan = draftPlan(me, meeting, {
    minutes: draft.minutes,
    present: [],
    actionItems: draft.actionItems.map((a) => ({ title: a.title, ownerId: a.ownerId!, dueOn: a.dueOn })),
  }, DEMO_DATA, '2026-10-20');
  assert.deepEqual(plan.skippedActions, []);
  assert.equal(plan.actionItems.length, 2);
});
