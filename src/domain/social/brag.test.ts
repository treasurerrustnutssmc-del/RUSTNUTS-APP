import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_WITHDRAWN,
  AWARD_GONE,
  AWARD_OFF,
  AWARD_OFF_ALREADY,
  BAD_AWARD_DATES,
  BAD_AWARD_KIND,
  BAD_AWARD_YEAR,
  BAD_BRAG_PHOTO,
  NO_AWARD_NAME,
  NO_BRAG_PHOTO,
  NO_BRAG_TITLE,
  NO_RIDE,
  NO_STORY,
  NOMINATION_GONE,
  NOMINATIONS_CLOSED,
  NOT_AWARD_RUNNER,
  NOT_NOMINATOR,
  NOT_VOTING,
  OWN_NOMINATION,
  RIDE_NOMINATED,
  RIDE_NOT_IN_YEAR,
  TOO_MANY_NOMINATIONS,
  archiveAwardProblem,
  awardPhase,
  awardsFor,
  cleanAward,
  cleanNomination,
  nominationProblem,
  openAwardProblem,
  results,
  voteProblem,
  withdrawProblem,
  type Award,
  type AwardInput,
  type Nomination,
  type NominationInput,
} from './brag';
import type { Member, Position, Ride } from '../types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west', fullName: m.id, roadName: null, status: 'full', approval: 'approved', joinedOn: null, patchedOn: null,
  fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false, ...m,
});
const boss = member({ id: 'boss' });
const plain = member({ id: 'plain' });
const other = member({ id: 'other' });
const positions: Position[] = [{ id: 'p1', memberId: 'boss', role: 'president', chapterId: 'ch-west', startedOn: '2025-01-01', endedOn: null }];
const today = '2026-10-27';

const awardIn = (over: Partial<AwardInput> = {}): AwardInput => ({
  kind: 'ride', title: 'Ride of the year 2026', year: 2026, nominationsClose: '2026-11-10', votingClose: '2026-11-30', ...over,
});
const award = (over: Partial<Award> & Pick<Award, 'id'>): Award => ({
  kind: 'ride', title: 'Ride of the year', year: 2026, nominationsClose: '2026-11-10', votingClose: '2026-11-30',
  openedBy: 'boss', archivedAt: null, ...over,
});
const ride = (id: string, startsAt: string, cancelledAt: string | null = null): Ride =>
  ({ id, title: id, startsAt, endsAt: null, allDay: false, location: null, notes: null, category: 'club', cancelledAt }) as Ride;
const nom = (over: Partial<Nomination> & Pick<Nomination, 'id'>): Nomination => ({
  awardId: 'ride', nominatedBy: 'plain', rideId: null, title: null, photo: null, story: null, reason: null,
  nominatedAt: '2026-10-01T00:00:00Z', withdrawnAt: null, ...over,
});
const nomIn = (over: Partial<NominationInput> = {}): NominationInput => ({
  awardId: 'ride', rideId: 'r-may', title: '', photo: null, story: '', reason: '', ...over,
});

const rides = [ride('r-may', '2026-05-01T00:00:00Z'), ride('r-old', '2025-05-01T00:00:00Z'), ride('r-later', '2026-12-01T00:00:00Z'),
  ride('r-off', '2026-04-01T00:00:00Z', '2026-03-01T00:00:00Z')];
const awards = [
  award({ id: 'ride' }),
  award({ id: 'photo', kind: 'photo' }),
  award({ id: 'story', kind: 'story' }),
  award({ id: 'voting', nominationsClose: '2026-10-20' }),
  award({ id: 'done', nominationsClose: '2026-09-01', votingClose: '2026-10-26' }),
  award({ id: 'off', archivedAt: '2026-10-01T00:00:00Z' }),
];

test('an award’s phase comes from today, close days included', () => {
  const a = award({ id: 'a', nominationsClose: '2026-10-27', votingClose: '2026-10-28' });
  assert.equal(awardPhase(a, '2026-10-27'), 'nominating');
  assert.equal(awardPhase(a, '2026-10-28'), 'voting');
  assert.equal(awardPhase(a, '2026-10-29'), 'closed');
});

test('the board opens awards; the refusals in the database order', () => {
  assert.equal(openAwardProblem(boss, awardIn(), positions, today), null);
  assert.deepEqual(cleanAward(awardIn({ title: '  Ride of the year  ' })).title, 'Ride of the year');
  assert.equal(openAwardProblem(null, awardIn(), positions, today), 'Sign in first.');
  assert.equal(openAwardProblem(member({ id: 'boss', approval: 'pending' }), awardIn(), positions, today), 'Only approved members can do that.');
  assert.equal(openAwardProblem(plain, awardIn(), positions, today), NOT_AWARD_RUNNER);
  assert.equal(openAwardProblem(boss, awardIn({ kind: 'song' as never }), positions, today), BAD_AWARD_KIND);
  assert.equal(openAwardProblem(boss, awardIn({ title: ' ' }), positions, today), NO_AWARD_NAME);
  assert.equal(openAwardProblem(boss, awardIn({ title: 'x'.repeat(61) }), positions, today), 'Keep the name to 60 characters at most.');
  assert.equal(openAwardProblem(boss, awardIn({ title: '🏆'.repeat(60) }), positions, today), null);
  assert.equal(openAwardProblem(boss, awardIn({ year: 2018 }), positions, today), BAD_AWARD_YEAR);
  assert.equal(openAwardProblem(boss, awardIn({ year: 2027 }), positions, today), BAD_AWARD_YEAR);
  assert.equal(openAwardProblem(boss, awardIn({ nominationsClose: '2026-10-26' }), positions, today), BAD_AWARD_DATES);
  assert.equal(openAwardProblem(boss, awardIn({ votingClose: '2026-11-10' }), positions, today), BAD_AWARD_DATES);
  assert.equal(openAwardProblem(boss, awardIn({ nominationsClose: '2026-02-30' }), positions, today), BAD_AWARD_DATES);
  assert.equal(openAwardProblem(boss, awardIn({ nominationsClose: today, votingClose: '2026-10-28' }), positions, today), null);
});

test('taking an award off: the board, once', () => {
  assert.equal(archiveAwardProblem(boss, 'ride', awards, positions), null);
  assert.equal(archiveAwardProblem(plain, 'ride', awards, positions), NOT_AWARD_RUNNER);
  assert.equal(archiveAwardProblem(boss, 'nope', awards, positions), AWARD_GONE);
  assert.equal(archiveAwardProblem(boss, 'off', awards, positions), AWARD_OFF_ALREADY);
});

test('nominating a ride: one from the award’s year, ridden, not cancelled, once', () => {
  assert.equal(nominationProblem(plain, nomIn(), awards, [], rides, today), null);
  assert.equal(nominationProblem(null, nomIn(), awards, [], rides, today), 'Sign in first.');
  assert.equal(nominationProblem(plain, nomIn({ awardId: 'nope' }), awards, [], rides, today), AWARD_GONE);
  assert.equal(nominationProblem(plain, nomIn({ awardId: 'off' }), awards, [], rides, today), AWARD_OFF);
  assert.equal(nominationProblem(plain, nomIn({ awardId: 'voting' }), awards, [], rides, today), NOMINATIONS_CLOSED);
  assert.equal(nominationProblem(plain, nomIn({ rideId: null }), awards, [], rides, today), NO_RIDE);
  for (const r of ['r-old', 'r-later', 'r-off', 'r-ghost']) {
    assert.equal(nominationProblem(plain, nomIn({ rideId: r }), awards, [], rides, today), RIDE_NOT_IN_YEAR, r);
  }
  const taken = [nom({ id: 'n1', rideId: 'r-may', nominatedBy: 'other' })];
  assert.equal(nominationProblem(plain, nomIn(), awards, taken, rides, today), RIDE_NOMINATED);
  assert.equal(nominationProblem(plain, nomIn(), awards, [{ ...taken[0], withdrawnAt: 'x' }], rides, today), null);
  assert.equal(nominationProblem(plain, nomIn({ reason: 'r'.repeat(301) }), awards, [], rides, today), 'Keep the reason to 300 characters at most.');
});

test('three nominations each per award, withdrawn ones not counted', () => {
  const mine = ['a', 'b', 'c'].map((id) => nom({ id, awardId: 'story', title: id, story: id }));
  const input = nomIn({ awardId: 'story', rideId: null, title: 'Fourth', story: 'x' });
  assert.equal(nominationProblem(plain, input, awards, mine, rides, today), TOO_MANY_NOMINATIONS);
  assert.equal(nominationProblem(plain, input, awards, [...mine.slice(0, 2), { ...mine[2], withdrawnAt: 'x' }], rides, today), null);
  assert.equal(nominationProblem(other, input, awards, mine, rides, today), null);
});

test('nominating a photo or a story', () => {
  const photo = { path: 'plain/a.jpg', width: 800, height: 600 };
  const p = (over: Partial<NominationInput>) => nomIn({ awardId: 'photo', rideId: null, title: 'Sunset at Apollo Bay', photo, ...over });
  assert.equal(nominationProblem(plain, p({}), awards, [], rides, today), null);
  assert.equal(nominationProblem(plain, p({ title: ' ' }), awards, [], rides, today), NO_BRAG_TITLE);
  assert.equal(nominationProblem(plain, p({ title: 't'.repeat(81) }), awards, [], rides, today), 'Keep the title to 80 characters at most.');
  assert.equal(nominationProblem(plain, p({ photo: null }), awards, [], rides, today), NO_BRAG_PHOTO);
  assert.equal(nominationProblem(plain, p({ photo: { ...photo, path: 'other/a.jpg' } }), awards, [], rides, today), BAD_BRAG_PHOTO);
  const s = (over: Partial<NominationInput>) => nomIn({ awardId: 'story', rideId: null, title: 'Ballan', story: 'Chain snapped.', ...over });
  assert.equal(nominationProblem(plain, s({}), awards, [], rides, today), null);
  assert.equal(nominationProblem(plain, s({ title: '' }), awards, [], rides, today), NO_BRAG_TITLE);
  assert.equal(nominationProblem(plain, s({ story: '  ' }), awards, [], rides, today), NO_STORY);
  assert.equal(nominationProblem(plain, s({ story: 's'.repeat(1001) }), awards, [], rides, today), 'Keep the story to 1,000 characters at most.');
  // Only what the kind uses is kept.
  assert.deepEqual(cleanNomination(nomIn({ title: ' x ', story: ' y ', photo, reason: ' Best day ' }), 'ride'), {
    rideId: 'r-may', title: null, photo: null, story: null, reason: 'Best day',
  });
  assert.deepEqual(cleanNomination(s({ photo }), 'story'), { rideId: null, title: 'Ballan', photo: null, story: 'Chain snapped.', reason: null });
});

test('withdrawing: whoever nominated it or the board, while nominations are open', () => {
  const noms = [
    nom({ id: 'n1', rideId: 'r-may' }),
    nom({ id: 'n2', awardId: 'voting', rideId: 'r-may' }),
    nom({ id: 'n3', rideId: 'r-may', withdrawnAt: 'x' }),
  ];
  assert.equal(withdrawProblem(plain, 'n1', noms, awards, positions, today), null);
  assert.equal(withdrawProblem(boss, 'n1', noms, awards, positions, today), null);
  assert.equal(withdrawProblem(other, 'n1', noms, awards, positions, today), NOT_NOMINATOR);
  assert.equal(withdrawProblem(plain, 'nope', noms, awards, positions, today), NOMINATION_GONE);
  assert.equal(withdrawProblem(plain, 'n2', noms, awards, positions, today), NOMINATIONS_CLOSED);
  assert.equal(withdrawProblem(plain, 'n3', noms, awards, positions, today), ALREADY_WITHDRAWN);
});

test('voting: while it’s open, never for your own', () => {
  const noms = [
    nom({ id: 'v1', awardId: 'voting', rideId: 'r-may', nominatedBy: 'other' }),
    nom({ id: 'v2', awardId: 'voting', rideId: 'r-may', nominatedBy: 'plain' }),
    nom({ id: 'n1', awardId: 'ride', rideId: 'r-may', nominatedBy: 'other' }),
    nom({ id: 'd1', awardId: 'done', rideId: 'r-may', nominatedBy: 'other' }),
    nom({ id: 'w1', awardId: 'voting', rideId: 'r-may', nominatedBy: 'other', withdrawnAt: 'x' }),
  ];
  assert.equal(voteProblem(plain, 'v1', noms, awards, today), null);
  assert.equal(voteProblem(null, 'v1', noms, awards, today), 'Sign in first.');
  assert.equal(voteProblem(plain, 'nope', noms, awards, today), NOMINATION_GONE);
  assert.equal(voteProblem(plain, 'w1', noms, awards, today), NOMINATION_GONE);
  assert.equal(voteProblem(plain, 'n1', noms, awards, today), NOT_VOTING);
  assert.equal(voteProblem(plain, 'd1', noms, awards, today), NOT_VOTING);
  assert.equal(voteProblem(plain, 'v2', noms, awards, today), OWN_NOMINATION);
});

test('results: most votes first, ties share the win, nothing withdrawn', () => {
  const noms = [nom({ id: 'a' }), nom({ id: 'b' }), nom({ id: 'c' }), nom({ id: 'gone', withdrawnAt: 'x' })];
  const r = results(noms, [{ nominationId: 'a', votes: 2 }, { nominationId: 'b', votes: 5 }, { nominationId: 'c', votes: 5 }]);
  assert.deepEqual(r.map((x) => [x.nomination.id, x.votes, x.winner]), [['b', 5, true], ['c', 5, true], ['a', 2, false]]);
  assert.deepEqual(results([nom({ id: 'a' })], []).map((x) => [x.votes, x.winner]), [[0, false]]);
});

test('awards on show: open ones by when they close, then past ones newest first', () => {
  const { open, past } = awardsFor(awards, today);
  assert.deepEqual(open.map((a) => a.id), ['ride', 'photo', 'story', 'voting']);
  assert.deepEqual(past.map((a) => a.id), ['done']);
});
