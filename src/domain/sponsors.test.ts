import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_SPONSOR_URL,
  NO_SPONSOR_CHAPTER,
  NO_SPONSOR_NAME,
  NOT_SPONSOR_KEEPER,
  SPONSOR_GONE,
  SPONSOR_OFF,
  SPONSOR_OFF_ALREADY,
  archiveSponsorProblem,
  canKeepSponsors,
  cleanSponsor,
  siteLabel,
  sponsorProblem,
  sponsorsFor,
  type Sponsor,
  type SponsorInput,
} from './sponsors';
import type { Member, Position } from './types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west',
  fullName: m.id,
  roadName: null,
  status: 'full',
  approval: 'approved',
  joinedOn: null,
  patchedOn: null,
  fngStartedOn: null,
  bio: null,
  sharePhone: false,
  appliedOn: null,
  onHiatus: false,
  ...m,
});
const pos = (id: string, memberId: string, role: Position['role'], chapterId: string | null, endedOn: string | null = null): Position => ({
  id, memberId, role, chapterId, startedOn: '2025-01-01', endedOn,
});

const boss = member({ id: 'boss' });
const plain = member({ id: 'plain' });
const pending = member({ id: 'pending', approval: 'pending' });
const positions = [pos('p1', 'boss', 'secretary', 'ch-north'), pos('p2', 'plain', 'president', 'ch-west', '2025-06-01')];
const chapters = ['ch-west', 'ch-north'];

const input = (over: Partial<SponsorInput> = {}): SponsorInput => ({
  id: null, name: 'Tyre Shed', blurb: '', url: '', deal: '', logoPath: null, chapterId: null, ...over,
});
const sponsor = (over: Partial<Sponsor> & Pick<Sponsor, 'id'>): Sponsor => ({
  name: 'X', blurb: null, url: null, deal: null, logoPath: null, chapterId: null, addedBy: 'boss', archivedAt: null, ...over,
});

test('any board seat or the NEC looks after sponsors; an ended seat does not', () => {
  assert.equal(canKeepSponsors(boss, positions), true);
  assert.equal(canKeepSponsors(plain, positions), false);
  assert.equal(canKeepSponsors(null, positions), false);
  assert.equal(sponsorProblem(plain, input(), [], positions, chapters), NOT_SPONSOR_KEEPER);
  assert.equal(sponsorProblem(null, input(), [], positions, chapters), 'Sign in first.');
  assert.equal(sponsorProblem(pending, input(), [], positions, chapters), 'Only approved members can do that.');
});

test('a sponsor is trimmed, and blank extras are left off', () => {
  assert.equal(sponsorProblem(boss, input(), [], positions, chapters), null);
  assert.deepEqual(
    cleanSponsor(input({ name: ' Tyre Shed ', blurb: '  ', url: ' https://tyres.example ', deal: ' 10% off ', chapterId: 'ch-west' })),
    { name: 'Tyre Shed', blurb: null, url: 'https://tyres.example', deal: '10% off', logoPath: null, chapterId: 'ch-west' },
  );
});

test('the checks come in the same order and words as the database', () => {
  assert.equal(sponsorProblem(boss, input({ id: 'nope' }), [], positions, chapters), SPONSOR_GONE);
  const off = sponsor({ id: 's1', archivedAt: '2026-10-01T00:00:00Z' });
  assert.equal(sponsorProblem(boss, input({ id: 's1' }), [off], positions, chapters), SPONSOR_OFF);
  assert.equal(sponsorProblem(boss, input({ name: '  ' }), [], positions, chapters), NO_SPONSOR_NAME);
  assert.equal(sponsorProblem(boss, input({ name: 'x'.repeat(61) }), [], positions, chapters), 'Keep the name to 60 characters at most.');
  assert.equal(sponsorProblem(boss, input({ blurb: 'x'.repeat(301) }), [], positions, chapters), 'Keep the blurb to 300 characters at most.');
  assert.equal(sponsorProblem(boss, input({ url: 'tyres.example' }), [], positions, chapters), BAD_SPONSOR_URL);
  assert.equal(sponsorProblem(boss, input({ url: `https://${'x'.repeat(300)}` }), [], positions, chapters), 'Keep the website to 300 characters at most.');
  assert.equal(sponsorProblem(boss, input({ deal: 'x'.repeat(201) }), [], positions, chapters), 'Keep the member deal to 200 characters at most.');
  assert.equal(sponsorProblem(boss, input({ chapterId: 'ch-south' }), [], positions, chapters), NO_SPONSOR_CHAPTER);
  // Emoji count once, as the database counts them.
  assert.equal(sponsorProblem(boss, input({ name: '🏍'.repeat(60) }), [], positions, chapters), null);
});

test('taking a sponsor off', () => {
  const s = sponsor({ id: 's1' });
  assert.equal(archiveSponsorProblem(boss, 's1', [s], positions), null);
  assert.equal(archiveSponsorProblem(plain, 's1', [s], positions), NOT_SPONSOR_KEEPER);
  assert.equal(archiveSponsorProblem(boss, 'nope', [s], positions), SPONSOR_GONE);
  assert.equal(archiveSponsorProblem(boss, 's1', [{ ...s, archivedAt: '2026-10-01T00:00:00Z' }], positions), SPONSOR_OFF_ALREADY);
});

test('members see the whole club’s sponsors first, then each chapter’s, by name', () => {
  const list = [
    sponsor({ id: 'a', name: 'zed’s', chapterId: 'ch-west' }),
    sponsor({ id: 'b', name: 'Bike Barn', chapterId: null }),
    sponsor({ id: 'c', name: 'Anvil', chapterId: 'ch-north' }),
    sponsor({ id: 'd', name: 'Gone', archivedAt: '2026-10-01T00:00:00Z' }),
    sponsor({ id: 'e', name: 'alpha', chapterId: null }),
  ];
  assert.deepEqual(sponsorsFor(list).map((s) => s.id), ['e', 'b', 'c', 'a']);
});

test('a website shows as its plain address', () => {
  assert.equal(siteLabel('https://www.tyres.example.com.au/shop?x=1'), 'tyres.example.com.au');
  assert.equal(siteLabel('http://Bikes.example/'), 'bikes.example');
  assert.equal(siteLabel('https://'), 'https://');
});
