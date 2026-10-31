import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiMessage } from '../../supabase/functions/_shared/askClub';
import { DEMO_FALLBACK, demoReply } from './assistantDemo';
import { BEFORE, planningClub, who } from '../domain/planning.testkit';

const data = planningClub();
const ctx = { me: who(data, 'rider'), data, now: BEFORE };
const ask = (text: string, earlier: ApiMessage[] = []): ApiMessage[] => [...earlier, { role: 'user', content: [{ type: 'text', text: '<club_snapshot>\n{}\n</club_snapshot>' }, { type: 'text', text }] }];

test('the demo answers the next ride from the club’s own rides', () => {
  const r = demoReply(ask('When’s the next ride?'), ctx);
  assert.match(r.text, /Coffee run on Sun 08\/11\/2026 at 8:30 am/);
  assert.deepEqual(r.proposals, []);
  assert.deepEqual(r.content, [{ type: 'text', text: r.text }]);
});

test('the demo cites the FNG clauses', () => {
  assert.match(demoReply(ask('What does the constitution say about FNGs?'), ctx).text, /4\.6–4\.11/);
});

test('the demo says what you owe', () => {
  assert.match(demoReply(ask('What do I owe?'), ctx).text, /all square/);
});

test('put me down proposes Going for the next ride', () => {
  const r = demoReply(ask('Put me down for the next ride'), ctx);
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].name, 'rsvp');
  assert.deepEqual(r.proposals[0].input, { ride_id: 'r-west', answer: 'going' });
  assert.ok(r.content.some((b) => b.type === 'tool_use' && b.id === r.proposals[0].id));
});

test('the bus and a new ride get their cards', () => {
  const bus = demoReply(ask('Book the bus'), ctx).proposals[0];
  assert.equal(bus.name, 'book_bus');
  assert.equal(bus.input.driver_id, 'rider');
  assert.equal(bus.input.first_day, '2026-11-08');
  const ride = demoReply(ask('Add a ride in a fortnight'), ctx).proposals[0];
  assert.equal(ride.name, 'add_ride');
  assert.equal(ride.input.date, '2026-11-15');
  assert.equal(ride.input.label, 'west');
});

test('anything else gets the starters line, and ids stay unique along a conversation', () => {
  assert.equal(demoReply(ask('Tell me a joke'), ctx).text, DEMO_FALLBACK);
  const first = demoReply(ask('Put me down for the next ride'), ctx);
  const history: ApiMessage[] = [...ask('Put me down for the next ride'), { role: 'assistant', content: first.content }];
  const second = demoReply([...history, { role: 'user', content: [{ type: 'tool_result', tool_use_id: first.proposals[0].id, content: 'Done.' }, { type: 'text', text: 'Book the bus' }] }], ctx);
  assert.notEqual(second.proposals[0].id, first.proposals[0].id);
});
