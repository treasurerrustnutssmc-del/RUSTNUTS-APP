import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVED_ALREADY,
  BAD_SKILL,
  HELP_SKILLS,
  MECHANIC_GONE,
  MECHANIC_NO_NAME,
  MECHANIC_OFF_LIST,
  NOT_MECHANIC_EDITOR,
  canEditMechanic,
  cleanMechanic,
  helpersFor,
  mechanicProblem,
  skillLabel,
  skillsProblem,
  usedByLabel,
  vouchCount,
  type Mechanic,
  type MechanicInput,
} from './help';
import type { Member, Position } from '../types';

const member = (m: Partial<Member> & Pick<Member, 'id'>): Member => ({
  chapterId: 'ch-west', fullName: m.id, roadName: null, status: 'full', approval: 'approved', joinedOn: null,
  patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false, ...m,
});

const input = (over: Partial<MechanicInput> = {}): MechanicInput => ({
  id: null, name: 'Bob’s Bikes', suburb: 'Sunshine', phone: '0400 555 111', website: 'https://bobs.example',
  speciality: 'Old Japanese', notes: 'Fair prices', ...over,
});

const mech = (over: Partial<Mechanic> = {}): Mechanic => ({
  id: 'w1', name: 'Bob’s Bikes', suburb: null, phone: null, website: null, speciality: null, notes: null,
  addedBy: 'adder', addedAt: '2026-10-01T00:00:00.000Z', archivedAt: null, ...over,
});

test('the skills, in order, with labels', () => {
  assert.equal(HELP_SKILLS.length, 11);
  assert.equal(HELP_SKILLS[0], 'servicing');
  assert.equal(skillLabel('trailer'), 'Trailer or ute');
  assert.equal(skillLabel('carbs'), 'Carbs and fuel');
});

test('skills problems', () => {
  assert.equal(skillsProblem(null, ['tyres']), 'Sign in first.');
  assert.equal(skillsProblem(member({ id: 'p', approval: 'pending' }), ['nope']), 'Only approved members can do that.');
  assert.equal(skillsProblem(member({ id: 'a' }), ['tyres', 'nope']), BAD_SKILL);
  assert.equal(skillsProblem(member({ id: 'a' }), []), null);
  assert.equal(skillsProblem(member({ id: 'a' }), ['tyres', 'tyres']), null);
});

test('helpers: approved members you can see with that skill (not you), your chapter first, then by name', () => {
  const me = member({ id: 'me', chapterId: 'ch-north' });
  const members = [
    me,
    member({ id: 'w-zed', fullName: 'Zed', chapterId: 'ch-west' }),
    member({ id: 'n-bo', fullName: 'Bo', chapterId: 'ch-north' }),
    member({ id: 'w-al', fullName: 'Al', chapterId: 'ch-west' }),
    member({ id: 'gone', fullName: 'Gone', approval: 'suspended' }),
    member({ id: 'other', fullName: 'Other' }),
  ];
  const skills = [
    { memberId: 'w-zed', skills: ['tyres' as const] },
    { memberId: 'n-bo', skills: ['tyres' as const, 'electrics' as const] },
    { memberId: 'w-al', skills: ['tyres' as const] },
    { memberId: 'gone', skills: ['tyres' as const] },
    { memberId: 'other', skills: ['electrics' as const] },
    { memberId: 'me', skills: ['tyres' as const] },
  ];
  assert.deepEqual(helpersFor(me, members, skills, 'tyres', []).map((m) => m.id), ['n-bo', 'w-al', 'w-zed']);
  assert.deepEqual(helpersFor(me, members, skills, 'welding', []), []);
  assert.deepEqual(helpersFor(member({ id: 'x', approval: 'pending' }), members, skills, 'tyres', []), []);
});

test('mechanic problems, in the database order', () => {
  const me = member({ id: 'me' });
  assert.equal(mechanicProblem(null, input(), []), 'Sign in first.');
  assert.equal(mechanicProblem(member({ id: 'p', approval: 'pending' }), input(), []), 'Only approved members can do that.');
  assert.equal(mechanicProblem(me, input({ name: '   ' }), []), MECHANIC_NO_NAME);
  assert.equal(mechanicProblem(me, input({ name: 'x'.repeat(81) }), []), 'Keep the name to 80 characters at most.');
  assert.equal(mechanicProblem(me, input({ name: 'x'.repeat(80) }), []), null);
  assert.equal(mechanicProblem(me, input({ suburb: 'x'.repeat(61) }), []), 'Keep the suburb to 60 characters at most.');
  assert.equal(mechanicProblem(me, input({ phone: '1'.repeat(31) }), []), 'Keep the phone number to 30 characters at most.');
  assert.equal(mechanicProblem(me, input({ website: 'bobs.example' }), []), 'Websites start with http:// or https://.');
  assert.equal(mechanicProblem(me, input({ website: 'https://' + 'x'.repeat(193) }), []), 'Keep the website to 200 characters at most.');
  assert.equal(mechanicProblem(me, input({ website: '  ' }), []), null);
  assert.equal(mechanicProblem(me, input({ speciality: 'x'.repeat(81) }), []), 'Keep what they’re good at to 80 characters at most.');
  assert.equal(mechanicProblem(me, input({ notes: 'x'.repeat(501) }), []), 'Keep the notes to 500 characters at most.');
  // Emoji count as one character each, like the database counts them.
  assert.equal(mechanicProblem(me, input({ name: '🔧'.repeat(80) }), []), null);
});

test('editing: whoever added it, or the board or NEC; not a gone or archived one', () => {
  const adder = member({ id: 'adder' });
  const other = member({ id: 'other' });
  const sec = member({ id: 'sec', chapterId: 'ch-north' });
  const positions: Position[] = [{ id: 'p1', memberId: 'sec', chapterId: 'ch-north', role: 'secretary', startedOn: '2025-01-01', endedOn: null }];
  const list = [mech()];
  assert.equal(mechanicProblem(adder, input({ id: 'w1' }), list), null);
  assert.equal(mechanicProblem(other, input({ id: 'w1' }), list, positions), NOT_MECHANIC_EDITOR);
  assert.equal(mechanicProblem(sec, input({ id: 'w1' }), list, positions), null);
  assert.equal(mechanicProblem(adder, input({ id: 'nope' }), list), MECHANIC_GONE);
  assert.equal(mechanicProblem(adder, input({ id: 'w1' }), [mech({ archivedAt: '2026-10-02T00:00:00.000Z' })]), MECHANIC_OFF_LIST);
  assert.equal(canEditMechanic(other, mech(), positions), false);
  assert.equal(canEditMechanic(sec, mech(), positions), true);
  // An ended seat gives nothing.
  assert.equal(canEditMechanic(sec, mech(), [{ ...positions[0], endedOn: '2026-01-01' }]), false);
  assert.ok(ARCHIVED_ALREADY.length > 0);
});

test('cleaning: trimmed, blanks become none', () => {
  assert.deepEqual(cleanMechanic(input({ name: '  Bob  ', suburb: ' ', phone: '', website: ' https://x.example ', speciality: ' ', notes: ' hi ' })), {
    name: 'Bob', suburb: null, phone: null, website: 'https://x.example', speciality: null, notes: 'hi',
  });
});

test('vouches', () => {
  const vouches = [
    { mechanicId: 'w1', memberId: 'a', vouched: true },
    { mechanicId: 'w1', memberId: 'b', vouched: false },
    { mechanicId: 'w1', memberId: 'c', vouched: true },
    { mechanicId: 'w2', memberId: 'a', vouched: true },
  ];
  assert.equal(vouchCount('w1', vouches), 2);
  assert.equal(usedByLabel(0), 'No one’s said yet');
  assert.equal(usedByLabel(1), 'Used by 1 member');
  assert.equal(usedByLabel(4), 'Used by 4 members');
});
