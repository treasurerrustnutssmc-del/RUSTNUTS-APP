import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA, STORY_NOW, STORY_TODAY } from '../data/demoStory.testkit';
import { homeNeedsYou, type NeedsYouItem } from './homeNeedsYou';
import type { ClubData, Member } from './types';

const now = STORY_NOW.toISOString();
const member = (id: string): Member => DEMO_DATA.members.find((m) => m.id === id)!;
const keys = (items: NeedsYouItem[]) => items.map((i) => i.key);

test('approvals come first: applicants waiting lead the list for their board', () => {
  const items = homeNeedsYou(member('m-rusty'), DEMO_DATA, STORY_TODAY, now);
  assert.ok(items.length > 0);
  assert.equal(items[0].key, 'applicants');
  assert.equal(items[0].group, 'approve');
  assert.deepEqual(items[0].to, { screen: 'Board', params: { focus: 'pending' } });
  assert.match(items[0].title, /waiting for approval/);
  // Every approval sits above every "for you" item.
  const firstYou = items.findIndex((i) => i.group === 'you');
  const lastApprove = items.map((i) => i.group).lastIndexOf('approve');
  if (firstYou !== -1) assert.ok(lastApprove < firstYou, keys(items).join(','));
});

test('rego, licence and first aid reminders are never in Needs you (they go to the bottom of Home)', () => {
  for (const m of DEMO_DATA.members) {
    const items = homeNeedsYou(m, DEMO_DATA, STORY_TODAY, now);
    assert.ok(!items.some((i) => /rego|licence|first aid/i.test(i.title)), `${m.id}: ${keys(items).join(',')}`);
  }
});

test('an ordinary member never sees board approvals', () => {
  const plain = DEMO_DATA.members.find(
    (m) => m.approval === 'approved' && m.status === 'full' && !DEMO_DATA.positions.some((p) => p.memberId === m.id && p.endedOn === null),
  )!;
  const items = homeNeedsYou(plain, DEMO_DATA, STORY_TODAY, now);
  assert.ok(items.every((i) => i.group === 'you'), keys(items).join(','));
});

test('nobody signed in, or nothing waiting: an empty list, so the card hides', () => {
  assert.deepEqual(homeNeedsYou(null, DEMO_DATA, STORY_TODAY, now), []);
  const quiet: ClubData = {
    ...DEMO_DATA,
    members: DEMO_DATA.members.map((m) => (m.approval === 'pending' ? { ...m, approval: 'approved' as const } : m)),
    votes: [],
    charges: [],
    busBookings: [],
    actingRequests: [],
    auditRequests: [],
    contributions: [],
    merchOrders: [],
    shopOrders: [],
    ledger: [],
    statusNotices: [],
    decisions: DEMO_DATA.decisions,
  };
  const items = homeNeedsYou(member('m-rusty'), quiet, STORY_TODAY, now).filter((i) => i.key !== 'road-rules' && i.key !== 'fng-reviews');
  assert.deepEqual(keys(items), []);
});

test('fees owing point at your own fees; a single vote opens that vote', () => {
  const rusty = member('m-rusty');
  const withFee: ClubData = {
    ...DEMO_DATA,
    charges: [{ id: 'c-x', memberId: rusty.id, chapterId: rusty.chapterId, fy: 2027, kind: 'annual', description: 'Annual fee', amountCents: 36000, dueOn: STORY_TODAY, createdAt: now, waivedAt: null }],
    payments: [],
  };
  const fee = homeNeedsYou(rusty, withFee, STORY_TODAY, now).find((i) => i.key === 'fees');
  assert.ok(fee);
  assert.deepEqual(fee.to, { screen: 'MemberFees', params: { memberId: rusty.id } });
  assert.match(fee.title, /\$360/);
});

test('each item has a place to go and a title', () => {
  for (const m of DEMO_DATA.members) {
    for (const i of homeNeedsYou(m, DEMO_DATA, STORY_TODAY, now)) {
      assert.ok(i.title.length > 0 && i.to.screen.length > 0, i.key);
    }
  }
});

test('fees you have told the treasurer about come off: they wait on the treasurer, not you', () => {
  const rusty = member('m-rusty');
  const charge = { id: 'c-x', memberId: rusty.id, chapterId: rusty.chapterId, fy: 2027, kind: 'annual' as const, description: 'Annual fee', amountCents: 36000, dueOn: STORY_TODAY, createdAt: now, waivedAt: null };
  const claim = (amountCents: number) => ({ ...DEMO_DATA, charges: [charge], payments: [{ ...(DEMO_DATA.payments ?? [])[0], id: 'p-x', chargeId: 'c-x', amountCents, state: 'claimed' as const }] });
  const part = homeNeedsYou(rusty, claim(10000) as ClubData, STORY_TODAY, now).find((i) => i.key === 'fees');
  assert.ok(part);
  assert.match(part.title, /\$260/);
  assert.match(part.subtitle ?? '', /told the treasurer about \$100/);
  assert.equal(homeNeedsYou(rusty, claim(36000) as ClubData, STORY_TODAY, now).find((i) => i.key === 'fees'), undefined);
});

