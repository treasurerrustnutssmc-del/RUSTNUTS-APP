// "Who can help?": members' skills, and the club's list of trusted mechanics. The database's
// set_skills, save_mechanic, archive_mechanic and vouch_mechanic apply the same checks with the
// same words, in the same order.

import { activePositions, canSeeMember, isNational } from '../access';
import { BOARD_ROLES } from '../labels';
import { displayName } from '../profile';
import { postingRulesProblem } from '../postingRules';
import { signedInProblem } from '../routes';
import type { Member, Position } from '../types';

export const HELP_SKILLS = [
  'servicing',
  'tyres',
  'electrics',
  'carbs',
  'diagnostics',
  'welding',
  'paint',
  'wheels',
  'suspension',
  'trailer',
  'tools',
] as const;
export type HelpSkill = (typeof HELP_SKILLS)[number];

const SKILL_LABELS: Record<HelpSkill, string> = {
  servicing: 'Servicing',
  tyres: 'Tyres',
  electrics: 'Electrics',
  carbs: 'Carbs and fuel',
  diagnostics: 'Diagnostics',
  welding: 'Welding and fab',
  paint: 'Paint and bodywork',
  wheels: 'Wheels and spokes',
  suspension: 'Suspension',
  trailer: 'Trailer or ute',
  tools: 'Tools to lend',
};

export const skillLabel = (s: HelpSkill) => SKILL_LABELS[s];

/** One member's skills. */
export interface MemberSkills {
  memberId: string;
  skills: HelpSkill[];
}

export interface Mechanic {
  id: string;
  name: string;
  suburb: string | null;
  phone: string | null;
  website: string | null;
  speciality: string | null;
  notes: string | null;
  addedBy: string | null;
  addedAt: string;
  archivedAt: string | null;
}

/** "I've used them": kept as a row that's switched off, never removed. */
export interface MechanicVouch {
  mechanicId: string;
  memberId: string;
  vouched: boolean;
}

/** What someone adding (id null) or changing a workshop typed. */
export interface MechanicInput {
  id: string | null;
  name: string;
  suburb: string;
  phone: string;
  website: string;
  speciality: string;
  notes: string;
}

export const BAD_SKILL = 'That isn’t one of the skills.';
export const MECHANIC_NO_NAME = 'Give the workshop a name.';
export const BAD_WEBSITE = 'Websites start with http:// or https://.';
export const MECHANIC_GONE = 'No such workshop.';
export const NOT_MECHANIC_EDITOR = 'Only whoever added it or the board can change it.';
export const MECHANIC_OFF_LIST = 'That workshop is off the list.';
export const ARCHIVED_ALREADY = 'That workshop is already off the list.';

/** The limits, in characters (code points), and how each refusal names its field. */
const LIMITS: { key: keyof Omit<MechanicInput, 'id'>; max: number; words: string }[] = [
  { key: 'name', max: 80, words: 'the name' },
  { key: 'suburb', max: 60, words: 'the suburb' },
  { key: 'phone', max: 30, words: 'the phone number' },
  { key: 'website', max: 200, words: 'the website' },
  { key: 'speciality', max: 80, words: 'what they’re good at' },
  { key: 'notes', max: 500, words: 'the notes' },
];

const chars = (s: string) => [...s].length;

/** Holds a board seat in any chapter, or sits on the NEC: lane B's private.is_any_board. */
export function isAnyBoard(me: Member | null, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (isNational(me.id, positions)) return true;
  return activePositions(me.id, positions).some((p) => p.chapterId !== null && BOARD_ROLES.includes(p.role));
}

export function skillsProblem(me: Member | null, skills: string[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (skills.some((s) => !(HELP_SKILLS as readonly string[]).includes(s))) return BAD_SKILL;
  return null;
}

/** Approved members the viewer can see who ticked this skill, not counting the viewer: their chapter first, then by name. */
export function helpersFor(viewer: Member | null, members: Member[], skills: MemberSkills[], skill: HelpSkill, positions: Position[]): Member[] {
  if (!viewer || viewer.approval !== 'approved') return [];
  const has = new Set(skills.filter((s) => s.skills.includes(skill)).map((s) => s.memberId));
  return members
    .filter((m) => m.id !== viewer.id && has.has(m.id) && m.approval === 'approved' && canSeeMember(viewer, m, positions))
    .sort(
      (a, b) =>
        Number(b.chapterId === viewer.chapterId) - Number(a.chapterId === viewer.chapterId) ||
        displayName(a).localeCompare(displayName(b)),
    );
}

export function canEditMechanic(me: Member | null, m: Mechanic, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return m.addedBy === me.id || isAnyBoard(me, positions);
}

/** The workshop's details as stored: trimmed, blanks as none. */
export function cleanMechanic(input: MechanicInput) {
  const opt = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    name: input.name.trim(),
    suburb: opt(input.suburb),
    phone: opt(input.phone),
    website: opt(input.website),
    speciality: opt(input.speciality),
    notes: opt(input.notes),
  };
}

export function mechanicProblem(me: Member | null, input: MechanicInput, mechanics: Mechanic[], positions: Position[] = []): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (input.id !== null) {
    const m = mechanics.find((x) => x.id === input.id);
    if (!m) return MECHANIC_GONE;
    if (!canEditMechanic(me, m, positions)) return NOT_MECHANIC_EDITOR;
    if (m.archivedAt) return MECHANIC_OFF_LIST;
  }
  const clean = cleanMechanic(input);
  if (clean.name === '') return MECHANIC_NO_NAME;
  for (const { key, max, words } of LIMITS) {
    const value = clean[key];
    if (key === 'website' && value !== null && !/^https?:\/\//i.test(value)) return BAD_WEBSITE;
    if (value !== null && chars(value) > max) return `Keep ${words} to ${max} characters at most.`;
  }
  // Last, as the row goes in (a database trigger): agreed to the club rules for chats and posts?
  return postingRulesProblem(me);
}

export function archiveProblem(me: Member | null, id: string, mechanics: Mechanic[], positions: Position[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const m = mechanics.find((x) => x.id === id);
  if (!m) return MECHANIC_GONE;
  if (!canEditMechanic(me, m, positions)) return NOT_MECHANIC_EDITOR;
  if (m.archivedAt) return ARCHIVED_ALREADY;
  return null;
}

export function vouchProblem(me: Member | null, id: string, mechanics: Mechanic[]): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  const m = mechanics.find((x) => x.id === id);
  if (!m) return MECHANIC_GONE;
  if (m.archivedAt) return MECHANIC_OFF_LIST;
  return null;
}

export const vouchCount = (mechanicId: string, vouches: MechanicVouch[]) =>
  vouches.filter((v) => v.mechanicId === mechanicId && v.vouched).length;

export const hasVouched = (mechanicId: string, memberId: string, vouches: MechanicVouch[]) =>
  vouches.some((v) => v.mechanicId === mechanicId && v.memberId === memberId && v.vouched);

/** "Used by 4 members". */
export function usedByLabel(n: number): string {
  if (n === 0) return 'No one’s said yet';
  return `Used by ${n} ${n === 1 ? 'member' : 'members'}`;
}

/** Listed workshops: most used first, then by name. */
export function listedMechanics(mechanics: Mechanic[], vouches: MechanicVouch[]): Mechanic[] {
  return mechanics
    .filter((m) => !m.archivedAt)
    .sort((a, b) => vouchCount(b.id, vouches) - vouchCount(a.id, vouches) || a.name.localeCompare(b.name));
}
