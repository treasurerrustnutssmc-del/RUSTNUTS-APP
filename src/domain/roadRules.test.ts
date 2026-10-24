import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGES_TOO_LONG,
  MAX_RULES_CHANGES,
  MAX_RULES_TEXT,
  NOT_PUBLISHER,
  NO_RULES,
  PUBLISH_CONFLICT,
  RULES_EMPTY,
  RULES_TOO_LONG,
  SIGN_OUTDATED,
  askedToSign,
  cleanRoadRules,
  currentRoadRules,
  goodUntil,
  publishProblem,
  publishesRoadRules,
  roadRulesStatus,
  rulesBlocks,
  signProblem,
  signoffBase,
  signoffGroups,
  type RoadRulesInput,
} from './roadRules';
import type { ClubData, Member, Position, PositionRole, RoadRulesSignoff, RoadRulesVersion } from './types';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Full ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

const position = (memberId: string, role: PositionRole, chapterId: string | null, endedOn: string | null = null): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn,
});

const version = (number: number, over: Partial<RoadRulesVersion> = {}): RoadRulesVersion => ({
  number, body: `# Road Rules v${number}\nRide your own ride.`, changes: '', fresh: true,
  publishedAt: '2025-07-01T00:00:00.000Z', publishedBy: 'nec', ...over,
});

const signoff = (memberId: string, v: number, signedAt: string): RoadRulesSignoff => ({ memberId, version: v, signedAt });

// The cast. westVp has a board seat but isn't NEC; northPres is a sitting chapter President (NEC).
const nec = member('nec', { chapterId: 'ch-north' });
const northPres = member('north-pres', { chapterId: 'ch-north' });
const westVp = member('west-vp');
const exChair = member('ex-chair');
const rider = member('rider');
const pending = member('pending', { approval: 'pending' });
const suspendedNec = member('suspended-nec', { approval: 'suspended' });

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters: [], members: [nec, northPres, westVp, exChair, rider, pending, suspendedNec],
  privates: [], bikes: [], registrations: [], emergencyContacts: [],
  positions: [
    position('nec', 'nec_chair', null),
    position('north-pres', 'president', 'ch-north'),
    position('west-vp', 'vice_president', 'ch-west'),
    position('ex-chair', 'nec_chair', null, '2025-06-30'),
    position('suspended-nec', 'nec_secretary', null),
  ],
  rides: [], rsvps: [],
  ...over,
});

const OK: RoadRulesInput = { body: '# Road Rules\nRide your own ride.', changes: 'Fixed a typo.', fresh: true };

// ---------------------------------------------------------------------------
// Messages and limits
// ---------------------------------------------------------------------------

test('the messages are the spec’s words, with the curly ’', () => {
  assert.equal(NOT_PUBLISHER, 'Only the NEC can publish the Road Rules.');
  assert.equal(
    PUBLISH_CONFLICT,
    'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the Road Rules again.',
  );
  assert.equal(RULES_EMPTY, 'Write the Road Rules first.');
  assert.equal(RULES_TOO_LONG, 'That’s too long (20000 characters at most).');
  assert.equal(CHANGES_TOO_LONG, 'Keep what changed to 500 characters at most.');
  assert.equal(NO_RULES, 'There are no Road Rules to sign yet.');
  assert.equal(SIGN_OUTDATED, 'The Road Rules changed while you had them open. Read the new version, then sign.');
  assert.equal(MAX_RULES_TEXT, 20000);
  assert.equal(MAX_RULES_CHANGES, 500);
});

// ---------------------------------------------------------------------------
// Versions and the sign-off base
// ---------------------------------------------------------------------------

test('currentRoadRules is the highest number, in any order, and undefined with none', () => {
  assert.equal(currentRoadRules(data()), undefined);
  assert.equal(currentRoadRules(data({ roadRules: [] })), undefined);
  const d = data({ roadRules: [version(2), version(3), version(1)] });
  assert.equal(currentRoadRules(d)?.number, 3);
});

test('signoffBase is the newest version that needed a fresh sign-off', () => {
  assert.equal(signoffBase(data()), undefined);
  assert.equal(signoffBase(data({ roadRules: [version(1)] }))?.number, 1);
  // Small fixes carry over: the base stays on the last fresh one.
  const fixes = data({ roadRules: [version(1), version(2, { fresh: false }), version(3, { fresh: false })] });
  assert.equal(signoffBase(fixes)?.number, 1);
  const fresh = data({ roadRules: [version(3, { fresh: false }), version(2), version(1)] });
  assert.equal(signoffBase(fresh)?.number, 2);
});

test('version 1 always counts as fresh, even if it was stored as a small fix', () => {
  const d = data({ roadRules: [version(1, { fresh: false }), version(2, { fresh: false })] });
  assert.equal(signoffBase(d)?.number, 1);
});

// ---------------------------------------------------------------------------
// Who publishes
// ---------------------------------------------------------------------------

test('publishesRoadRules: the NEC (a national role or a sitting President), approved', () => {
  const d = data();
  assert.equal(publishesRoadRules(nec, d), true);
  assert.equal(publishesRoadRules(northPres, d), true);
  assert.equal(publishesRoadRules(westVp, d), false, 'a non-NEC board seat');
  assert.equal(publishesRoadRules(exChair, d), false, 'a national role that has ended');
  assert.equal(publishesRoadRules(rider, d), false);
  assert.equal(publishesRoadRules(suspendedNec, d), false, 'not approved');
  assert.equal(publishesRoadRules(null, d), false);
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

test('publishProblem checks in the spec’s order', () => {
  const d = data({ roadRules: [version(1), version(2)] });
  // Everything wrong at once: each check is passed in turn, so each message shows in order.
  const bad: RoadRulesInput = { body: '   ', changes: 'x'.repeat(501), fresh: true };
  assert.equal(publishProblem(null, bad, 0, d), 'Sign in first.');
  assert.equal(publishProblem(pending, bad, 0, d), 'Only approved members can do that.');
  assert.equal(publishProblem(suspendedNec, bad, 0, d), 'Only approved members can do that.');
  assert.equal(publishProblem(westVp, bad, 0, d), NOT_PUBLISHER);
  assert.equal(publishProblem(rider, bad, 0, d), NOT_PUBLISHER);
  assert.equal(publishProblem(nec, bad, 1, d), PUBLISH_CONFLICT);
  assert.equal(publishProblem(nec, bad, 2, d), RULES_EMPTY);
  assert.equal(publishProblem(nec, { ...bad, body: 'x'.repeat(20001) }, 2, d), RULES_TOO_LONG);
  assert.equal(publishProblem(nec, { ...bad, body: 'Ride your own ride.' }, 2, d), CHANGES_TOO_LONG);
  assert.equal(publishProblem(nec, OK, 2, d), null);
  assert.equal(publishProblem(northPres, OK, 2, d), null);
});

test('a non-NEC board member is refused, even with good text', () => {
  assert.equal(publishProblem(westVp, OK, 0, data()), NOT_PUBLISHER);
});

test('seen is the version the editor opened on: 0 when there were none', () => {
  const none = data();
  assert.equal(publishProblem(nec, OK, 0, none), null);
  assert.equal(publishProblem(nec, OK, 1, none), PUBLISH_CONFLICT);
  const one = data({ roadRules: [version(1)] });
  assert.equal(publishProblem(nec, OK, 0, one), PUBLISH_CONFLICT, 'someone published the first version meanwhile');
  assert.equal(publishProblem(nec, OK, 1, one), null);
  assert.equal(publishProblem(nec, OK, 2, one), PUBLISH_CONFLICT);
});

test('publish limits count code points after trimming', () => {
  const d = data();
  assert.equal(publishProblem(nec, { ...OK, body: 'x'.repeat(MAX_RULES_TEXT) }, 0, d), null);
  assert.equal(publishProblem(nec, { ...OK, body: 'x'.repeat(MAX_RULES_TEXT + 1) }, 0, d), RULES_TOO_LONG);
  assert.equal(publishProblem(nec, { ...OK, body: '🏍'.repeat(MAX_RULES_TEXT) }, 0, d), null, 'an emoji is one');
  assert.equal(publishProblem(nec, { ...OK, body: `  ${'x'.repeat(MAX_RULES_TEXT)}\n\n ` }, 0, d), null, 'trimmed first');
  assert.equal(publishProblem(nec, { ...OK, body: '\n\t \n' }, 0, d), RULES_EMPTY);
  assert.equal(publishProblem(nec, { ...OK, changes: 'x'.repeat(MAX_RULES_CHANGES) }, 0, d), null);
  assert.equal(publishProblem(nec, { ...OK, changes: 'x'.repeat(MAX_RULES_CHANGES + 1) }, 0, d), CHANGES_TOO_LONG);
  assert.equal(publishProblem(nec, { ...OK, changes: '🏍'.repeat(MAX_RULES_CHANGES) }, 0, d), null);
  assert.equal(publishProblem(nec, { ...OK, changes: ` ${'x'.repeat(MAX_RULES_CHANGES)} ` }, 0, d), null);
  assert.equal(publishProblem(nec, { ...OK, changes: '' }, 0, d), null, 'what changed is optional');
});

test('cleanRoadRules trims the texts and forces fresh for version 1', () => {
  const typed: RoadRulesInput = { body: '  # Rules\nRide.  \n', changes: ' First go. ', fresh: false };
  assert.deepEqual(cleanRoadRules(typed, data()), { body: '# Rules\nRide.', changes: 'First go.', fresh: true });
  const one = data({ roadRules: [version(1)] });
  assert.deepEqual(cleanRoadRules(typed, one), { body: '# Rules\nRide.', changes: 'First go.', fresh: false });
  assert.equal(cleanRoadRules({ ...typed, fresh: true }, one).fresh, true);
});

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

test('signProblem checks in the spec’s order', () => {
  const none = data();
  assert.equal(signProblem(null, 1, none), 'Sign in first.');
  assert.equal(signProblem(pending, 1, none), 'Only approved members can do that.');
  assert.equal(signProblem(rider, 1, none), NO_RULES);
  const d = data({ roadRules: [version(1), version(2, { fresh: false })] });
  assert.equal(signProblem(null, 1, d), 'Sign in first.');
  assert.equal(signProblem(pending, 2, d), 'Only approved members can do that.');
  assert.equal(signProblem(rider, 1, d), SIGN_OUTDATED, 'an older version, even a carried-over one');
  assert.equal(signProblem(rider, 3, d), SIGN_OUTDATED);
  assert.equal(signProblem(rider, 2, d), null);
  assert.equal(signProblem(westVp, 2, d), null, 'anyone approved signs, not just the NEC');
});

test('signing again while already signed is allowed', () => {
  const d = data({ roadRules: [version(1)], roadRulesSignoffs: [signoff('rider', 1, '2026-10-01T00:00:00.000Z')] });
  assert.equal(signProblem(rider, 1, d), null);
});

// ---------------------------------------------------------------------------
// Good until and status
// ---------------------------------------------------------------------------

test('goodUntil is the same Melbourne date a year on, with 29 February rolling to 28 February', () => {
  assert.equal(goodUntil('2025-11-15T02:00:00.000Z'), '2026-11-15');
  // 14 Nov 14:00 UTC is 15 Nov 01:00 in Melbourne (AEDT).
  assert.equal(goodUntil('2025-11-14T14:00:00.000Z'), '2026-11-15');
  // 30 Jun 15:00 UTC is 1 Jul 01:00 in Melbourne (AEST).
  assert.equal(goodUntil('2025-06-30T15:00:00.000Z'), '2026-07-01');
  assert.equal(goodUntil('2028-02-29T03:00:00.000Z'), '2029-02-28');
  // 28 Feb 13:30 UTC is already 29 Feb in Melbourne.
  assert.equal(goodUntil('2028-02-28T13:30:00.000Z'), '2029-02-28');
  assert.equal(goodUntil('2027-02-28T03:00:00.000Z'), '2028-02-28');
  assert.equal(goodUntil('2025-12-31T03:00:00.000Z'), '2026-12-31');
});

const signedRules = (signedAt: string, v = 1) =>
  data({ roadRules: [version(1)], roadRulesSignoffs: [signoff('rider', v, signedAt)] });

test('roadRulesStatus: none with nothing to sign', () => {
  assert.deepEqual(roadRulesStatus(rider, data(), '2026-10-24'), { state: 'none', goodUntil: null, signedVersion: null });
  const stray = data({ roadRulesSignoffs: [signoff('rider', 1, '2026-10-01T00:00:00.000Z')] });
  assert.deepEqual(roadRulesStatus(rider, stray, '2026-10-24'), { state: 'none', goodUntil: null, signedVersion: null });
});

test('roadRulesStatus: unsigned when never signed', () => {
  const d = data({ roadRules: [version(1)] });
  assert.deepEqual(roadRulesStatus(rider, d, '2026-10-24'), { state: 'unsigned', goodUntil: null, signedVersion: null });
});

test('roadRulesStatus: current, with the good-until date and the version signed', () => {
  const d = signedRules('2026-10-01T00:00:00.000Z');
  assert.deepEqual(roadRulesStatus(rider, d, '2026-10-24'), { state: 'current', goodUntil: '2027-10-01', signedVersion: 1 });
});

test('the expiry edges: 29 February, the good-until day, the day after, and 30 days before', () => {
  const d = signedRules('2028-02-29T03:00:00.000Z');
  const on = (today: string) => roadRulesStatus(rider, d, today);
  assert.equal(on('2028-02-29').state, 'current');
  assert.equal(on('2029-01-28').state, 'current', '31 days left');
  assert.equal(on('2029-01-29').state, 'due_soon', '30 days left');
  assert.equal(on('2029-02-28').state, 'due_soon', 'still signed on the good-until date');
  assert.deepEqual(on('2029-03-01'), { state: 'expired', goodUntil: '2029-02-28', signedVersion: 1 });
});

test('the due-soon edge on an ordinary date', () => {
  // Spanner's demo case: signed 15/11/2025, good until 15/11/2026.
  const d = signedRules('2025-11-15T00:00:00.000Z');
  assert.equal(roadRulesStatus(rider, d, '2026-10-15').state, 'current', '31 days left');
  assert.equal(roadRulesStatus(rider, d, '2026-10-16').state, 'due_soon', '30 days left');
  assert.equal(roadRulesStatus(rider, d, '2026-10-24').state, 'due_soon');
  assert.equal(roadRulesStatus(rider, d, '2026-11-15').state, 'due_soon');
  assert.equal(roadRulesStatus(rider, d, '2026-11-16').state, 'expired');
});

test('carry-over: a small fix keeps sign-offs, a fresh version makes them unsigned', () => {
  const signedV1 = [signoff('rider', 1, '2026-10-01T00:00:00.000Z')];
  const fix = data({ roadRules: [version(1), version(2, { fresh: false })], roadRulesSignoffs: signedV1 });
  assert.deepEqual(roadRulesStatus(rider, fix, '2026-10-24'), { state: 'current', goodUntil: '2027-10-01', signedVersion: 1 });

  const fresh = data({ roadRules: [version(1), version(2, { fresh: false }), version(3)], roadRulesSignoffs: signedV1 });
  assert.deepEqual(roadRulesStatus(rider, fresh, '2026-10-24'), { state: 'unsigned', goodUntil: null, signedVersion: null });

  // Signing at or after the base counts, carried over or not.
  const signedV2 = data({
    roadRules: [version(1), version(2), version(3, { fresh: false })],
    roadRulesSignoffs: [signoff('rider', 2, '2026-10-01T00:00:00.000Z')],
  });
  assert.equal(roadRulesStatus(rider, signedV2, '2026-10-24').state, 'current');
});

test('roadRulesStatus: a sign-off on a small-fix version after the base is current', () => {
  const d = data({
    roadRules: [version(1), version(2), version(3, { fresh: false }), version(4, { fresh: false })],
    roadRulesSignoffs: [signoff('rider', 3, '2026-10-01T00:00:00.000Z')],
  });
  assert.equal(signoffBase(d)?.number, 2);
  assert.deepEqual(roadRulesStatus(rider, d, '2026-10-24'), { state: 'current', goodUntil: '2027-10-01', signedVersion: 3 });
});

test('an old sign-off from before the base is unsigned, not expired', () => {
  const d = data({
    roadRules: [version(1), version(2)],
    roadRulesSignoffs: [signoff('rider', 1, '2024-01-01T00:00:00.000Z')],
  });
  assert.equal(roadRulesStatus(rider, d, '2026-10-24').state, 'unsigned');
});

// ---------------------------------------------------------------------------
// Who's asked and the sign-off groups
// ---------------------------------------------------------------------------

test('askedToSign: every approved member except Legacy, in name order', () => {
  const legacy = member('legacy', { status: 'legacy' });
  const nomad = member('nomad', { status: 'nomad' });
  const supporter = member('supporter', { status: 'supporter', roadName: null, fullName: 'Bea Supporter' });
  const introduced = member('introduced', { status: 'introduced' });
  const declined = member('declined', { approval: 'declined' });
  const d = data({ members: [rider, legacy, nomad, supporter, introduced, pending, declined, suspendedNec] });
  assert.deepEqual(askedToSign(d).map((m) => m.id), ['supporter', 'introduced', 'nomad', 'rider']);
});

test('signoffGroups sorts asked members into Not signed, Due soon and Signed, by name', () => {
  const today = '2026-10-24';
  const zed = member('zed', { roadName: 'Zed' });
  const alf = member('alf', { roadName: null, fullName: 'alf Smith' });
  const bob = member('bob', { roadName: 'Bob' });
  const cat = member('cat', { roadName: 'Cat' });
  const dee = member('dee', { roadName: 'Dee' });
  const eve = member('eve', { roadName: 'Eve' });
  const legacy = member('legacy', { roadName: 'Legacy', status: 'legacy' });
  const applicant = member('applicant', { roadName: 'Applicant', approval: 'pending' });
  const members = [zed, alf, bob, cat, dee, eve, legacy, applicant];
  const d = data({
    members,
    roadRules: [version(1), version(2, { fresh: false })],
    roadRulesSignoffs: [
      signoff('zed', 2, '2026-10-01T00:00:00.000Z'), // signed
      signoff('bob', 1, '2025-11-15T00:00:00.000Z'), // due soon
      signoff('cat', 1, '2025-09-01T00:00:00.000Z'), // expired
      signoff('eve', 2, '2026-01-01T00:00:00.000Z'), // signed
      signoff('dee', 1, '2025-11-01T00:00:00.000Z'), // due soon
      signoff('legacy', 1, '2025-09-01T00:00:00.000Z'), // expired, but not asked
    ],
  });
  const groups = signoffGroups(members, d, today);
  const ids = (list: Member[]) => list.map((m) => m.id);
  assert.deepEqual(ids(groups.notSigned), ['alf', 'cat']);
  assert.deepEqual(ids(groups.dueSoon), ['bob', 'dee']);
  assert.deepEqual(ids(groups.signed), ['eve', 'zed']);
});

test('signoffGroups groups only the members it is given (the caller’s chapter)', () => {
  const north = member('north', { chapterId: 'ch-north', roadName: 'North' });
  const west = member('west', { roadName: 'West' });
  const d = data({ members: [north, west], roadRules: [version(1)] });
  const groups = signoffGroups([west], d, '2026-10-24');
  assert.deepEqual(groups.notSigned.map((m) => m.id), ['west']);
  assert.deepEqual(groups.dueSoon, []);
  assert.deepEqual(groups.signed, []);
});

test('signoffGroups: with no versions there is nothing to sign, so all three groups are empty', () => {
  const d = data({ members: [rider, westVp] });
  assert.deepEqual(signoffGroups([rider, westVp], d, '2026-10-24'), { notSigned: [], dueSoon: [], signed: [] });
  assert.deepEqual(signoffGroups([rider], data({ roadRules: [] }), '2026-10-24'), { notSigned: [], dueSoon: [], signed: [] });
});

test('a member who becomes Legacy drops out of the groups', () => {
  const left = member('left', { status: 'legacy' });
  const d = data({ members: [left], roadRules: [version(1)] });
  assert.deepEqual(signoffGroups([left], d, '2026-10-24'), { notSigned: [], dueSoon: [], signed: [] });
});

// ---------------------------------------------------------------------------
// rulesBlocks
// ---------------------------------------------------------------------------

test('rulesBlocks: headings, bullets and paragraphs', () => {
  const body = [
    '# Sample Road Rules (demo only)',
    'Ride your own ride.',
    'Keep a staggered formation',
    'on open roads.',
    '',
    '# Signals',
    '- Left hand down: slowing.',
    '- Foot out: hazard on the road.',
    'After the list.',
  ].join('\n');
  assert.deepEqual(rulesBlocks(body), [
    { kind: 'heading', text: 'Sample Road Rules (demo only)' },
    { kind: 'para', text: 'Ride your own ride. Keep a staggered formation on open roads.' },
    { kind: 'heading', text: 'Signals' },
    { kind: 'bullet', text: 'Left hand down: slowing.' },
    { kind: 'bullet', text: 'Foot out: hazard on the road.' },
    { kind: 'para', text: 'After the list.' },
  ]);
});

test('rulesBlocks: runs of blank lines, \\r\\n and trailing spaces', () => {
  const body = '\r\n\r\nFirst para.   \r\nStill first.\r\n\r\n\r\n   \r\nSecond para.\r\n# Heading  \r\n-  Bullet  \r\n\r\n';
  assert.deepEqual(rulesBlocks(body), [
    { kind: 'para', text: 'First para. Still first.' },
    { kind: 'para', text: 'Second para.' },
    { kind: 'heading', text: 'Heading' },
    { kind: 'bullet', text: 'Bullet' },
  ]);
});

test('rulesBlocks: markers count only at the start of a line, and nothing else is formatted', () => {
  assert.deepEqual(rulesBlocks('  # not a heading\n  - not a bullet\n#nospace\n-nospace\n## two\n**bold**'), [
    { kind: 'para', text: '# not a heading - not a bullet #nospace -nospace ## two **bold**' },
  ]);
});

test('rulesBlocks: empty blocks are dropped', () => {
  assert.deepEqual(rulesBlocks(''), []);
  assert.deepEqual(rulesBlocks('\n \n\t\n'), []);
  assert.deepEqual(rulesBlocks('#  \n- \n-   x'), [{ kind: 'bullet', text: 'x' }]);
});
