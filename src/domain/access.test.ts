import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import type { Position } from './types';
import {
  accessLevel,
  appointProblem,
  canApprove,
  canManageMember,
  canSeeMember,
  canSeePhone,
  canSeePrivate,
  endTermProblem,
  isBoardOf,
  isNecOfficer,
  pendingFor,
  visibleMembers,
  withHolders,
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


test('a board cannot manage an applicant who has not been approved yet', () => {
  assert.equal(canManageMember(m('m-torque'), m('m-dylan'), P), false);
});

test('only National Chairman, Secretary or Auditor count as NEC officers', () => {
  assert.equal(isNecOfficer('m-rusty', P), true); // NEC chair
  assert.equal(isNecOfficer('m-smokey', P), false); // a President sits on the NEC but is not an officer
  assert.equal(isNecOfficer('m-torque', P), false);
});

const allowed = (problem: string | null) => problem === null;

test('a chapter board appoints its own members to non-President roles', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'officer', d)), true);
});

test('nobody appoints themselves', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-torque'), 'ch-west', 'officer', d)), false);
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-rusty'), null, 'nec_auditor', d)), false);
});

test('a chapter seat only goes to a member of that chapter', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-jet'), 'ch-west', 'officer', d)), false);
  // not even when national does the appointing
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-jet'), 'ch-west', 'officer', d)), false);
});

test('applicants cannot be appointed', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-dylan'), 'ch-west', 'officer', d)), false);
});

test('a member cannot hold the same open role twice', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-chook'), 'ch-west', 'officer', d)), false);
});

test('only the National Chairman hands out the other national roles', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), null, 'nec_auditor', d)), false);
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-spanner'), null, 'nec_auditor', d)), false); // a President
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-spanner'), null, 'nec_auditor', d)), true); // the Chairman
});

test('nobody seats a National Chairman in the app; that follows the vote, recorded by the admin', () => {
  const noChair = { ...d, positions: P.map((p): Position => (p.id === 'p-2' ? { ...p, endedOn: '2026-10-01' } : p)) };
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-jet'), null, 'nec_chair', noChair)), false);
});

test('only the Chairman ends a national role, and nobody ends the Chairman\'s', () => {
  const withSecretary = {
    ...d,
    positions: [...P, { id: 'p-sec', memberId: 'm-jet', chapterId: null, role: 'nec_secretary' as const, startedOn: '2025-08-16', endedOn: null }],
  };
  const sec = withSecretary.positions.find((p) => p.id === 'p-sec')!;
  assert.equal(allowed(endTermProblem(m('m-rusty'), sec, withSecretary)), true); // Chairman ends the Secretary's
  assert.equal(allowed(endTermProblem(m('m-smokey'), sec, withSecretary)), false); // a President can't
  assert.equal(allowed(endTermProblem(m('m-jet'), pos('p-2'), withSecretary)), false); // Secretary can't end the Chairman's
  assert.equal(allowed(endTermProblem(m('m-smokey'), pos('p-2'), d)), false); // nor can a President
});

// West President seat vacated: Rusty's term ended, he stays National Chair.
const vacantWest = {
  ...d,
  positions: P.map((p): Position => (p.id === 'p-1' ? { ...p, endedOn: '2026-10-01' } : p)),
};

test('only NEC officers seat a President', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'president', vacantWest)), false);
  assert.equal(allowed(appointProblem(m('m-smokey'), m('m-spanner'), 'ch-west', 'president', vacantWest)), false);
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-spanner'), 'ch-west', 'president', vacantWest)), true);
});

const pos = (id: string) => {
  const found = P.find((p) => p.id === id);
  if (!found) throw new Error(`no position ${id}`);
  return found;
};

test('a chapter board ends other people\'s chapter terms, never its own', () => {
  assert.equal(allowed(endTermProblem(m('m-torque'), pos('p-7'), d)), true); // Spanner, Tail Gunner
  assert.equal(allowed(endTermProblem(m('m-torque'), pos('p-3'), d)), false); // her own Secretary term
  assert.equal(allowed(endTermProblem(m('m-crank'), pos('p-7'), d)), false); // North board, West seat
  assert.equal(allowed(endTermProblem(m('m-smokey'), pos('p-7'), d)), true); // national reaches every chapter
});

test('only NEC officers end a President\'s term, and never their own', () => {
  assert.equal(allowed(endTermProblem(m('m-torque'), pos('p-9'), d)), false); // Smokey, North President
  assert.equal(allowed(endTermProblem(m('m-smokey'), pos('p-1'), d)), false); // a President is not an officer
  assert.equal(allowed(endTermProblem(m('m-rusty'), pos('p-9'), d)), true); // NEC chair
  assert.equal(allowed(endTermProblem(m('m-rusty'), pos('p-1'), d)), false); // his own
});

test('an ended term cannot be ended again', () => {
  const ended = { ...pos('p-7'), endedOn: '2026-09-01' };
  const data = { ...d, positions: P.map((p) => (p.id === 'p-7' ? ended : p)) };
  assert.equal(allowed(endTermProblem(m('m-torque'), ended, data)), false);
});

test('seat holders the viewer cannot see are left out instead of crashing', () => {
  const seats = [
    { id: 's1', memberId: 'm-torque', chapterId: 'ch-west', role: 'secretary' as const, startedOn: '2025-08-16', endedOn: null },
    { id: 's2', memberId: 'm-gone', chapterId: 'ch-west', role: 'officer' as const, startedOn: '2025-08-16', endedOn: null },
  ];
  assert.deepEqual(withHolders(seats, d.members).map((x) => [x.position.id, x.member.id]), [['s1', 'm-torque']]);
});

test('Founder is an honour: no powers, and nobody hands it out or ends it in the app', () => {
  const withFounder = {
    ...d,
    positions: [...P, { id: 'p-founder', memberId: 'm-spanner', chapterId: null, role: 'founder' as const, startedOn: '2019-01-01', endedOn: null }],
  };
  assert.equal(accessLevel(m('m-spanner'), withFounder.positions), 'member');
  assert.equal(allowed(appointProblem(m('m-rusty'), m('m-chook'), null, 'founder', d)), false);
  assert.equal(allowed(endTermProblem(m('m-rusty'), withFounder.positions.find((p) => p.id === 'p-founder')!, withFounder)), false);
});

test('Ride Committee and Assistant Tail Gunner are ordinary chapter roles', () => {
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'ride_committee', d)), true);
  assert.equal(allowed(appointProblem(m('m-torque'), m('m-spanner'), 'ch-west', 'assistant_tail_gunner', d)), true);
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
