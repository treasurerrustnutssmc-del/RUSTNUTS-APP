import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import {
  accessLevel,
  canApprove,
  canAssignRole,
  canManageMember,
  canSeeMember,
  canSeePhone,
  canSeePrivate,
  isBoardOf,
  pendingFor,
  visibleMembers,
} from './access';
import { isChapterless } from './labels';

const d = DEMO_DATA;
const m = (id: string) => {
  const found = d.members.find((x) => x.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};
const P = d.positions;

test('access levels follow positions and approval', () => {
  assert.equal(accessLevel(null, P), 'public');
  assert.equal(accessLevel(m('m-dylan'), P), 'pending');
  assert.equal(accessLevel(m('m-spanner'), P), 'member'); // Tail Gunner is not a board seat
  assert.equal(accessLevel(m('m-chook'), P), 'member'); // Officer is not a board seat
  assert.equal(accessLevel(m('m-torque'), P), 'board');
  assert.equal(accessLevel(m('m-crank'), P), 'board');
  assert.equal(accessLevel(m('m-rusty'), P), 'national'); // NEC chair
  assert.equal(accessLevel(m('m-smokey'), P), 'national'); // sitting presidents sit on the NEC
});

test('ended positions stop counting', () => {
  const ended = P.map((p) => (p.memberId === 'm-torque' ? { ...p, endedOn: '2026-08-01' } : p));
  assert.equal(accessLevel(m('m-torque'), ended), 'member');
});

test('board power is limited to their own chapter', () => {
  assert.equal(isBoardOf(m('m-torque'), 'ch-west', P), true);
  assert.equal(isBoardOf(m('m-torque'), 'ch-north', P), false);
  assert.equal(isBoardOf(m('m-rusty'), 'ch-north', P), true); // national reaches every chapter
  assert.equal(isBoardOf(m('m-spanner'), 'ch-west', P), false);
});

test('pending applicants are only seen by their chapter board', () => {
  const dylan = m('m-dylan'); // West applicant
  assert.equal(canSeeMember(m('m-spanner'), dylan, P), false);
  assert.equal(canSeeMember(m('m-crank'), dylan, P), false); // North board
  assert.equal(canSeeMember(m('m-torque'), dylan, P), true); // West board
  assert.equal(canSeeMember(m('m-smokey'), dylan, P), true); // NEC
  assert.equal(canSeeMember(dylan, dylan, P), true);
  assert.equal(canSeeMember(null, m('m-spanner'), P), false); // public sees no directory
});

test('applicants see nobody else', () => {
  assert.deepEqual(
    visibleMembers(m('m-dylan'), d).map((x) => x.id),
    ['m-dylan'],
  );
});

test('phone numbers respect the share setting', () => {
  assert.equal(canSeePhone(m('m-chook'), m('m-spanner'), P), true); // Spanner shares
  assert.equal(canSeePhone(m('m-chook'), m('m-gravel'), P), false); // Gravel doesn't
  assert.equal(canSeePhone(m('m-torque'), m('m-gravel'), P), true); // West board sees it anyway
  assert.equal(canSeePhone(m('m-crank'), m('m-gravel'), P), false); // North board does not
});

test('private details are self and chapter board only', () => {
  assert.equal(canSeePrivate(m('m-spanner'), m('m-spanner'), P), true);
  assert.equal(canSeePrivate(m('m-chook'), m('m-spanner'), P), false);
  assert.equal(canSeePrivate(m('m-torque'), m('m-spanner'), P), true);
  assert.equal(canSeePrivate(m('m-jet'), m('m-spanner'), P), false);
});

test('approvals and member changes', () => {
  assert.equal(canApprove(m('m-torque'), m('m-dylan'), P), true);
  assert.equal(canApprove(m('m-torque'), m('m-josh'), P), false); // North applicant
  assert.equal(canApprove(m('m-torque'), m('m-spanner'), P), false); // already approved
  assert.deepEqual(pendingFor(m('m-torque'), d).map((x) => x.id), ['m-dylan']);
  assert.deepEqual(pendingFor(m('m-rusty'), d).map((x) => x.id), ['m-dylan', 'm-josh']);
  assert.equal(canManageMember(m('m-torque'), m('m-spanner'), P), true);
  assert.equal(canManageMember(m('m-torque'), m('m-torque'), P), false); // no self-promotion
  assert.equal(canManageMember(m('m-spanner'), m('m-chook'), P), false);
});

test('national roles are only handed out by the NEC', () => {
  assert.equal(canAssignRole(m('m-torque'), 'ch-west', P), true);
  assert.equal(canAssignRole(m('m-torque'), null, P), false);
  assert.equal(canAssignRole(m('m-smokey'), null, P), true);
  assert.equal(canAssignRole(m('m-dylan'), 'ch-west', P), false);
});

test('Founder is a title: it carries no chapter and no national powers', () => {
  const founderOnly = [
    { id: 'f1', memberId: 'm-spanner', chapterId: null, role: 'founder' as const, startedOn: '2019-05-11', endedOn: null },
  ];
  assert.equal(accessLevel(m('m-spanner'), founderOnly), 'member');
  assert.equal(isChapterless('founder'), true);
  assert.equal(isChapterless('nec_chair'), true);
  assert.equal(isChapterless('ride_committee'), false);
  assert.equal(isChapterless('assistant_tail_gunner'), false);
});
