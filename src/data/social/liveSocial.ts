// Turns the social tables' rows into the app's records.

import type { HelpSkill, Mechanic, MechanicVouch, MemberSkills } from '../../domain/social/help';
import type { Birthday } from '../../domain/social/shoutouts';

export interface BirthdayRow {
  member_id: string;
  month: number | null;
  day: number | null;
}

/** Shared birthdays only: a row with no month and day is one that was taken off. */
export function toBirthdays(rows: BirthdayRow[]): Birthday[] {
  return rows.flatMap((r) => (r.month === null || r.day === null ? [] : [{ memberId: r.member_id, month: r.month, day: r.day }]));
}

export interface SkillsRow {
  member_id: string;
  skills: HelpSkill[] | null;
}

export interface MechanicRow {
  id: string;
  name: string;
  suburb: string | null;
  phone: string | null;
  website: string | null;
  speciality: string | null;
  notes: string | null;
  added_by: string | null;
  added_at: string;
  archived_at: string | null;
}

export interface VouchRow {
  mechanic_id: string;
  member_id: string;
  vouched: boolean;
}

export const toSkills = (rows: SkillsRow[]): MemberSkills[] =>
  rows.map((r) => ({ memberId: r.member_id, skills: r.skills ?? [] }));

export const toMechanics = (rows: MechanicRow[]): Mechanic[] =>
  rows.map((r) => ({
    id: r.id, name: r.name, suburb: r.suburb, phone: r.phone, website: r.website, speciality: r.speciality, notes: r.notes,
    addedBy: r.added_by, addedAt: r.added_at, archivedAt: r.archived_at,
  }));

export const toVouches = (rows: VouchRow[]): MechanicVouch[] =>
  rows.map((r) => ({ mechanicId: r.mechanic_id, memberId: r.member_id, vouched: r.vouched }));

/** The save_mechanic call for what was typed: the database trims and checks it the same way. */
export const saveMechanicArgs = (i: { id: string | null; name: string; suburb: string; phone: string; website: string; speciality: string; notes: string }) => ({
  p_id: i.id, p_name: i.name, p_suburb: i.suburb, p_phone: i.phone, p_website: i.website, p_speciality: i.speciality, p_notes: i.notes,
});
