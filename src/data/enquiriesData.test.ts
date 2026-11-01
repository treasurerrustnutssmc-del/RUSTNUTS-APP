import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ENQUIRIES, demoHandleEnquiry, toEnquiries } from './enquiriesData';
import { ENQUIRY_CHAPTERS } from '../domain/enquiries';

test('rows from the database become enquiries', () => {
  const [e] = toEnquiries([{
    id: 'e1', name: 'Sam', email: 'sam@example.com', chapter_slug: 'west', about: null,
    created_at: '2026-11-01T00:00:00Z', handled_at: null, handled_by: null, note: null,
  }]);
  assert.deepEqual(e, { id: 'e1', name: 'Sam', email: 'sam@example.com', chapter: 'west', about: null, createdAt: '2026-11-01T00:00:00Z', handledAt: null, handledBy: null, note: null });
});

test('the demo has one open and one handled enquiry, on real chapters', () => {
  assert.equal(DEMO_ENQUIRIES.filter((e) => e.handledAt === null).length, 1);
  assert.equal(DEMO_ENQUIRIES.filter((e) => e.handledAt !== null).length, 1);
  for (const e of DEMO_ENQUIRIES) assert.ok((ENQUIRY_CHAPTERS as readonly string[]).includes(e.chapter));
  const done = demoHandleEnquiry(DEMO_ENQUIRIES, 'demo-enquiry-1', 'pres', '  Rang him ', '2026-11-01T01:00:00Z');
  assert.deepEqual(done[0].handledAt, '2026-11-01T01:00:00Z');
  assert.equal(done[0].handledBy, 'pres');
  assert.equal(done[0].note, 'Rang him');
  assert.equal(demoHandleEnquiry(DEMO_ENQUIRIES, 'demo-enquiry-1', 'pres', '', 'x')[0].note, null);
});
