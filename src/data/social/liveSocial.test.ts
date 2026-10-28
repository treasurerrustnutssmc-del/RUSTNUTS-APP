import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBirthdays } from './liveSocial';

test('birthday rows: taken-off ones are left out', () => {
  assert.deepEqual(
    toBirthdays([
      { member_id: 'a', month: 3, day: 7 },
      { member_id: 'b', month: null, day: null },
    ]),
    [{ memberId: 'a', month: 3, day: 7 }],
  );
});

test('skills, workshops and vouches rows', async () => {
  const { toSkills, toMechanics, toVouches, saveMechanicArgs } = await import('./liveSocial');
  assert.deepEqual(toSkills([{ member_id: 'a', skills: ['tyres'] }, { member_id: 'b', skills: null }]), [
    { memberId: 'a', skills: ['tyres'] },
    { memberId: 'b', skills: [] },
  ]);
  assert.deepEqual(
    toMechanics([{ id: 'w', name: 'N', suburb: null, phone: 'p', website: null, speciality: null, notes: null, added_by: null, added_at: 't', archived_at: null }]),
    [{ id: 'w', name: 'N', suburb: null, phone: 'p', website: null, speciality: null, notes: null, addedBy: null, addedAt: 't', archivedAt: null }],
  );
  assert.deepEqual(toVouches([{ mechanic_id: 'w', member_id: 'a', vouched: true }]), [{ mechanicId: 'w', memberId: 'a', vouched: true }]);
  assert.deepEqual(saveMechanicArgs({ id: null, name: 'n', suburb: 's', phone: 'p', website: 'w', speciality: 'x', notes: 'y' }), {
    p_id: null, p_name: 'n', p_suburb: 's', p_phone: 'p', p_website: 'w', p_speciality: 'x', p_notes: 'y',
  });
});
