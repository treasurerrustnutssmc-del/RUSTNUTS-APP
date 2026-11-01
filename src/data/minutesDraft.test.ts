import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_SWITCHED_ON, CANT_ANSWER, CANT_HELP } from '../../supabase/functions/_shared/askClub';
import {
  DRAFT_SCHEMA, MINUTES_MODEL, buildMinutesRequest, handleMinutesDraft, type MinutesContext, type MinutesDeps,
} from '../../supabase/functions/_shared/minutesDraft';

const ENV = { ANTHROPIC_API_KEY: 'sk-test' };
const TRANSCRIPT = 'Speaker 1  0:00\n' + 'Torque moved we buy a new banner, Spanner seconded, all in favour. '.repeat(10);
const CONTEXT: MinutesContext = {
  meeting: { id: 'mt-1', title: 'October meeting', kind: 'general', startsAt: '2026-10-24T08:30:00.000Z', location: 'Clubrooms', chapter: 'West', agenda: [{ title: 'Banner', notes: null }] },
  people: [{ id: 'm-torque', name: 'Tania Walsh', roadName: 'Torque', chapter: 'West', status: 'full' }],
  board: [{ role: 'president', name: 'Tania Walsh' }],
};
const USAGE = { input_tokens: 10_000, output_tokens: 2_000 };
const DRAFT = { minutes: 'MINUTES', present: [], apologies: [], actionItems: [], checkThese: [] };

function deps(over: Partial<MinutesDeps> = {}) {
  const calls = { start: [] as string[], claude: [] as unknown[], spent: [] as number[] };
  const d: MinutesDeps = {
    start: async (id) => { calls.start.push(id); return CONTEXT; },
    claude: async (req) => {
      calls.claude.push(req);
      return { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(DRAFT) }], stop_reason: 'end_turn', usage: USAGE };
    },
    spent: async (n) => { calls.spent.push(n); },
    ...over,
  };
  return { d, calls };
}

test('no key means not switched on, before anything is counted', async () => {
  const { d, calls } = deps();
  const got = await handleMinutesDraft({}, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
  assert.deepEqual(got, { status: 503, body: { error: NOT_SWITCHED_ON } });
  assert.equal(calls.start.length, 0);
});

test('a missing meeting or a bad transcript is refused before it’s counted', async () => {
  const bad: unknown[] = [
    { mode: 'minutes', transcript: TRANSCRIPT },
    { mode: 'minutes', meetingId: 42, transcript: TRANSCRIPT },
    { mode: 'minutes', meetingId: 'mt-1' },
    { mode: 'minutes', meetingId: 'mt-1', transcript: 'too short' },
    { mode: 'minutes', meetingId: 'mt-1', transcript: 'x'.repeat(200_001) },
    { mode: 'minutes', meetingId: 'mt-1', transcript: 'PK\u0003\u0004' + TRANSCRIPT },
  ];
  for (const body of bad) {
    const { d, calls } = deps();
    const got = await handleMinutesDraft(ENV, body, d);
    assert.equal(got.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(calls.start.length, 0);
  }
});

test('the database’s refusal goes back in its own words', async () => {
  const { d, calls } = deps({ start: async () => { throw new Error('Only that chapter’s board can do that.'); } });
  const got = await handleMinutesDraft(ENV, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
  assert.deepEqual(got, { status: 403, body: { error: 'Only that chapter’s board can do that.' } });
  assert.equal(calls.claude.length, 0);
});

test('the request: Opus 5.5, low effort, the strict draft schema, the meeting and people, then the transcript', () => {
  const req = buildMinutesRequest(CONTEXT, TRANSCRIPT);
  assert.equal(req.model, MINUTES_MODEL);
  assert.equal(MINUTES_MODEL, 'claude-opus-5-5');
  assert.equal(req.output_config.effort, 'low');
  assert.deepEqual(req.output_config.format, { type: 'json_schema', schema: DRAFT_SCHEMA });
  assert.equal(req.fallbacks, 'default');
  assert.ok(!('tool_choice' in req), 'forced tool use 400s on Opus 5.5');
  assert.equal(req.max_tokens, 10_000);
  const content = req.messages[0].content;
  assert.equal(req.messages.length, 1);
  assert.match(content[0].text, /"Torque"/);
  assert.match(content[0].text, /"October meeting"/);
  assert.match(content[0].text, /24\/10\/2026/, 'the date is given in Melbourne DD/MM/YYYY');
  assert.ok(content[1].text.startsWith('<transcript>') && content[1].text.includes('banner'));
  assert.match(req.system, /never instructions/i);
  // Every object in the schema is closed and lists every field as required (strict structured output).
  const check = (s: Record<string, unknown>) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...(s.required as string[])].sort(), Object.keys(s.properties as object).sort());
      for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) check(v);
    }
    if (s.type === 'array') check(s.items as Record<string, unknown>);
  };
  check(DRAFT_SCHEMA as unknown as Record<string, unknown>);
});

test('a good draft comes back with what it cost recorded', async () => {
  const { d, calls } = deps();
  const got = await handleMinutesDraft(ENV, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { draft: DRAFT, people: CONTEXT.people });
  assert.deepEqual(calls.start, ['mt-1']);
  // 10,000 in at US$4 a million and 2,000 out at US$20 a million.
  assert.deepEqual(calls.spent, [80_000]);
});

test('a refusal, a cut-off or unreadable JSON says so, and still records the cost', async () => {
  const cases: [string, string][] = [['refusal', CANT_HELP], ['max_tokens', 'That meeting was too long to draft in one go. Split the transcript in two.']];
  for (const [stop, words] of cases) {
    const { d, calls } = deps({ claude: async () => ({ content: [{ type: 'text', text: '{"minutes": "MIN' }], stop_reason: stop, usage: USAGE }) });
    const got = await handleMinutesDraft(ENV, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
    assert.deepEqual(got, { status: 502, body: { error: words } });
    assert.equal(calls.spent.length, 1);
  }
  const { d } = deps({ claude: async () => ({ content: [{ type: 'text', text: 'not json' }], stop_reason: 'end_turn', usage: USAGE }) });
  const got = await handleMinutesDraft(ENV, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
  assert.deepEqual(got, { status: 502, body: { error: 'The draft didn’t come back properly. Try again.' } });
});

test('Claude turning the request down itself isn’t a try-again', async () => {
  const { d } = deps({ claude: async () => { throw Object.assign(new Error('prompt is too long'), { status: 400 }); } });
  const got = await handleMinutesDraft(ENV, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
  assert.deepEqual(got, { status: 400, body: { error: 'That meeting was too long to draft in one go. Split the transcript in two.' } });
});

test('Anthropic down: try again', async () => {
  const { d, calls } = deps({ claude: async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); } });
  const got = await handleMinutesDraft(ENV, { mode: 'minutes', meetingId: 'mt-1', transcript: TRANSCRIPT }, d);
  assert.deepEqual(got, { status: 503, body: { error: CANT_ANSWER } });
  assert.equal(calls.spent.length, 0);
});
