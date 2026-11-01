import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FEEDBACK, demoAnswerFeedback, demoSendFeedback, toFeedback } from './feedbackData';
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from '../domain/feedback';

test('rows from the database become reports', () => {
  const [f] = toFeedback([{
    id: 'f1', member_id: 'm1', member_name: 'Nell Member', member_email: null, kind: 'bug', body: 'Blank map',
    where_in_app: 'Rides', screenshot_path: null, app_version: '0.1.0', build: 'abc', device: 'Android 15',
    status: 'new', reply: null, replied_at: null, created_at: '2026-11-01T00:00:00Z',
  }]);
  assert.deepEqual(f, {
    id: 'f1', memberId: 'm1', memberName: 'Nell Member', memberEmail: null, kind: 'bug', body: 'Blank map',
    whereInApp: 'Rides', screenshotPath: null, appVersion: '0.1.0', build: 'abc', device: 'Android 15',
    status: 'new', reply: null, repliedAt: null, createdAt: '2026-11-01T00:00:00Z',
  });
});

test('the demo has one open and one answered report, with real kinds and statuses', () => {
  assert.equal(DEMO_FEEDBACK.filter((f) => f.status === 'new').length, 1);
  assert.equal(DEMO_FEEDBACK.filter((f) => f.reply !== null).length, 1);
  for (const f of DEMO_FEEDBACK) {
    assert.ok((FEEDBACK_KINDS as readonly string[]).includes(f.kind));
    assert.ok((FEEDBACK_STATUSES as readonly string[]).includes(f.status));
  }
});

test('sending in the demo adds a new report at the front, trimmed', () => {
  const sent = demoSendFeedback(DEMO_FEEDBACK, { id: 'me', name: 'Me Myself' }, { kind: 'idea', body: '  Dark mode  ', whereInApp: ' ', screenshotPath: null }, { appVersion: '0.1.0', build: 'b', device: 'd' }, '2026-11-02T00:00:00Z');
  assert.equal(sent.length, DEMO_FEEDBACK.length + 1);
  assert.equal(sent[0].body, 'Dark mode');
  assert.equal(sent[0].whereInApp, null);
  assert.equal(sent[0].memberId, 'me');
  assert.equal(sent[0].status, 'new');
  assert.equal(sent[0].createdAt, '2026-11-02T00:00:00Z');
});

test('answering in the demo sets the status and keeps the old reply when the new one is empty', () => {
  const a = demoAnswerFeedback(DEMO_FEEDBACK, 'demo-feedback-1', 'looking', ' On it ', '2026-11-02T00:00:00Z');
  const f = a.find((x) => x.id === 'demo-feedback-1')!;
  assert.equal(f.status, 'looking');
  assert.equal(f.reply, 'On it');
  assert.equal(f.repliedAt, '2026-11-02T00:00:00Z');
  const b = demoAnswerFeedback(a, 'demo-feedback-1', 'done', '', '2026-11-03T00:00:00Z');
  const g = b.find((x) => x.id === 'demo-feedback-1')!;
  assert.equal(g.status, 'done');
  assert.equal(g.reply, 'On it');
  assert.equal(g.repliedAt, '2026-11-02T00:00:00Z');
});
