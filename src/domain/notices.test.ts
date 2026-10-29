import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTICE_BOARD_ONLY,
  NOTICE_CLOSED,
  NOTICE_DAYS,
  closeNoticeProblem,
  giveNoticeProblem,
  noticeRecordFrom,
  openNoticesOf,
  respondProblem,
} from './notices';
import { club, member, who } from './stage4.testkit';
import type { StatusNotice } from './types';

const today = '2026-10-24';
const notice = (id: string, over: Partial<StatusNotice> = {}): StatusNotice => ({
  id, memberId: 'rider', chapterId: 'west', about: 'attendance', record: 'Meetings 2 of 6', proposal: 'Move to Supporter',
  givenOn: '2026-10-01', respondBy: '2026-10-15', givenBy: 'sec', response: '', respondedAt: null,
  outcome: null, outcomeNote: '', closedOn: null, closedBy: null, ...over,
});
const input = (over: Partial<{ about: string; record: string; proposal: string; respondBy: string }> = {}) => ({
  about: 'attendance', record: 'Meetings 2 of 6 (needs 5)', proposal: 'Move to Supporter', respondBy: '2026-11-07', ...over,
});

test('the board gives notice with at least 14 days to respond (5.5)', () => {
  const data = club({ members: [...club().members, member('sup', { status: 'supporter' })] });
  const sec = who(data, 'sec');
  assert.equal(NOTICE_DAYS, 14);
  assert.equal(giveNoticeProblem(sec, 'rider', input(), data, today), null);
  assert.equal(giveNoticeProblem(sec, 'fng', input({ about: 'dues' }), data, today), null);
  assert.equal(giveNoticeProblem(sec, 'sup', input(), data, today), null);
  assert.equal(giveNoticeProblem(sec, 'ghost', input(), data, today), 'That member no longer exists.');
  assert.equal(giveNoticeProblem(who(data, 'northsec'), 'rider', input(), data, today), NOTICE_BOARD_ONLY);
  assert.equal(giveNoticeProblem(who(data, 'rider'), 'tre', input(), data, today), NOTICE_BOARD_ONLY);
  assert.equal(giveNoticeProblem(null, 'rider', input(), data, today), NOTICE_BOARD_ONLY);
  assert.equal(giveNoticeProblem(sec, 'sec', input(), data, today), 'Someone else on the board has to give you notice.');
  assert.equal(giveNoticeProblem(sec, 'legacy', input(), data, today), 'Notice is for FNGs, Full Members, Nomads and Supporters.');
  assert.equal(giveNoticeProblem(sec, 'applicant', input(), data, today), 'Notice is for FNGs, Full Members, Nomads and Supporters.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ about: 'vibes' }), data, today), 'Say what it’s about: attendance or dues.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ record: '  ' }), data, today), 'Set out the record.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ record: 'x'.repeat(2001) }), data, today), 'Keep the record under 2000 characters.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ proposal: '' }), data, today), 'Say what’s proposed.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ proposal: 'x'.repeat(501) }), data, today), 'Keep the proposal under 500 characters.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ respondBy: '2026-02-30' }), data, today), 'Pick a real date.');
  assert.equal(giveNoticeProblem(sec, 'rider', input({ respondBy: '2026-11-06' }), data, today), 'Give them at least 14 days to respond (5.5).');
  const open = club({ statusNotices: [notice('n1')] });
  assert.equal(giveNoticeProblem(who(open, 'sec'), 'rider', input(), open, today), 'They already have an open notice about that.');
  assert.equal(giveNoticeProblem(who(open, 'sec'), 'rider', input({ about: 'dues' }), open, today), null);
  const closed = club({ statusNotices: [notice('n1', { outcome: 'withdrawn', closedOn: '2026-10-10', closedBy: 'sec' })] });
  assert.equal(giveNoticeProblem(who(closed, 'sec'), 'rider', input(), closed, today), null);
});

test('only the member replies, while it’s open', () => {
  const data = club({ statusNotices: [notice('n1'), notice('n2', { outcome: 'decided', closedOn: '2026-10-20', closedBy: 'sec' })] });
  assert.equal(respondProblem(who(data, 'rider'), 'n1', 'I was in hospital in August.', data), null);
  assert.equal(respondProblem(who(data, 'rider'), 'nope', 'Hi', data), 'No such notice.');
  assert.equal(respondProblem(who(data, 'sec'), 'n1', 'Hi', data), 'Only the member can reply to their notice.');
  assert.equal(respondProblem(null, 'n1', 'Hi', data), 'Only the member can reply to their notice.');
  assert.equal(respondProblem(who(data, 'rider'), 'n2', 'Hi', data), NOTICE_CLOSED);
  assert.equal(respondProblem(who(data, 'rider'), 'n1', ' ', data), 'Write your reply.');
  assert.equal(respondProblem(who(data, 'rider'), 'n1', 'x'.repeat(2001), data), 'Keep your reply under 2000 characters.');
});

test('the board withdraws any time, and decides only after the respond-by date', () => {
  const data = club({
    statusNotices: [notice('due', { respondBy: '2026-10-23' }), notice('waiting', { respondBy: '2026-10-24' }), notice('shut', { outcome: 'withdrawn', closedOn: '2026-10-20' })],
  });
  const sec = who(data, 'sec');
  assert.equal(closeNoticeProblem(sec, 'due', 'decided', '', data, today), null);
  assert.equal(closeNoticeProblem(sec, 'waiting', 'decided', '', data, today), 'The board decides after 24/10/2026 (5.5).');
  assert.equal(closeNoticeProblem(sec, 'waiting', 'withdrawn', 'Exemption granted', data, today), null);
  assert.equal(closeNoticeProblem(sec, 'nope', 'withdrawn', '', data, today), 'No such notice.');
  assert.equal(closeNoticeProblem(who(data, 'northsec'), 'due', 'decided', '', data, today), 'Only their chapter’s board can do that.');
  assert.equal(closeNoticeProblem(sec, 'shut', 'withdrawn', '', data, today), NOTICE_CLOSED);
  assert.equal(closeNoticeProblem(sec, 'due', 'maybe' as 'decided', '', data, today), 'Pick withdrawn or decided.');
  assert.equal(closeNoticeProblem(sec, 'due', 'decided', 'x'.repeat(501), data, today), 'Keep the note under 500 characters.');
  const own = club({ statusNotices: [notice('mine', { memberId: 'sec' })] });
  assert.equal(closeNoticeProblem(who(own, 'sec'), 'mine', 'withdrawn', '', own, today), 'Someone else on the board has to do that.');
});

test('open notices, newest first', () => {
  const data = club({
    statusNotices: [notice('a', { givenOn: '2026-09-01' }), notice('b', { givenOn: '2026-10-01', about: 'dues' }), notice('c', { outcome: 'withdrawn', closedOn: '2026-10-02' })],
  });
  assert.deepEqual(openNoticesOf('rider', data).map((n) => n.id), ['b', 'a']);
  assert.deepEqual(openNoticesOf('sec', data), []);
});

test('the record is filled in from where they stand', () => {
  const text = noticeRecordFrom({
    kind: 'full', from: '2026-08-01', onHiatus: false,
    lines: [
      { key: 'meetings', label: 'Monthly meetings · 80%', attended: 2, held: 3, needed: 3, upcoming: 0, state: 'behind' },
      { key: 'big4', label: 'Big 4 rides', attended: 0, held: 1, needed: 2, upcoming: 1, state: 'to_go' },
    ],
  });
  assert.equal(text, 'Since 01/08/2026:\nMonthly meetings · 80%: 2 of 3 (needs 3)\nBig 4 rides: 0 (needs 2, 1 still to come)');
});

test('an FNG’s Big 4 line reads as a share of those held (4.6)', () => {
  const text = noticeRecordFrom({
    kind: 'fng', from: '2026-07-01', onHiatus: false,
    lines: [
      { key: 'meetings', label: 'Monthly meetings · 50%', attended: 2, held: 3, needed: 2, upcoming: 0, state: 'met' },
      { key: 'big4', label: 'Big 4 rides · 50%', attended: 1, held: 3, needed: 2, upcoming: 0, state: 'behind' },
    ],
  });
  assert.equal(text, 'Since 01/07/2026:\nMonthly meetings · 50%: 2 of 3 (needs 2)\nBig 4 rides · 50%: 1 of 3 (needs 2)');
  const none = noticeRecordFrom({
    kind: 'fng', from: '2026-07-01', onHiatus: false,
    lines: [{ key: 'big4', label: 'Big 4 rides · 50%', attended: 0, held: 0, needed: 0, upcoming: 0, state: 'none' }],
  });
  assert.equal(none, 'Since 01/07/2026:\nBig 4 rides · 50%: none held yet');
});
