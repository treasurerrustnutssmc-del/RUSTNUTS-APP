// What each social action does to the demo's social data. Plain functions, like ../demoActions:
// they take the data as it is and hand back the data as it should be, or throw with the same words
// the database uses. src/data/parity.test.ts checks them against the database's rules.

import { approvalProblem } from '../../domain/chat';
import {
  archiveProblem,
  cleanMechanic,
  mechanicProblem,
  skillsProblem,
  vouchProblem,
  type HelpSkill,
  type Mechanic,
  type MechanicInput,
  type MechanicVouch,
  type MemberSkills,
} from '../../domain/social/help';
import { birthdayProblem, type Birthday } from '../../domain/social/shoutouts';
import type { ClubData, Member } from '../../domain/types';
import type { FeedItem } from '../chat/chatContext';
import { NotAllowedError } from '../clubContext';

export interface SocialData {
  /** Shared birthdays only: taking one off removes it here (the database keeps a "not shared" row). */
  birthdays: Birthday[];
  /** Photos from earlier years, for On this day (the demo's chats only go back a fortnight). */
  pastPhotos: FeedItem[];
  // Who can help
  skills: MemberSkills[];
  /** Every workshop, archived ones included. */
  mechanics: Mechanic[];
  vouches: MechanicVouch[];
}

export interface SocialCtx {
  social: SocialData;
  club: ClubData;
  me: Member | null;
  /** The club's date (Melbourne), ISO. */
  today: string;
  /** The current instant (ISO), for stamps. */
  now?: string;
}

const refuse = (problem: string | null) => {
  if (problem) throw new NotAllowedError(problem);
};

/** Shares (or changes) my birthday; two nulls take it off. */
export function setBirthday(ctx: SocialCtx, month: number | null, day: number | null): SocialData {
  refuse(approvalProblem(ctx.me));
  refuse(birthdayProblem(month, day));
  const me = ctx.me as Member;
  const others = ctx.social.birthdays.filter((b) => b.memberId !== me.id);
  return {
    ...ctx.social,
    birthdays: month === null || day === null ? others : [...others, { memberId: me.id, month, day }],
  };
}

/** Sets my skills: each once, in the order given. */
export function setSkills(ctx: SocialCtx, skills: string[]): SocialData {
  refuse(skillsProblem(ctx.me, skills));
  const me = ctx.me as Member;
  const once = [...new Set(skills)] as HelpSkill[];
  return { ...ctx.social, skills: [...ctx.social.skills.filter((s) => s.memberId !== me.id), { memberId: me.id, skills: once }] };
}

/** Adds (input.id null) or changes a workshop; hands back its id. */
export function saveMechanic(ctx: SocialCtx, input: MechanicInput): { social: SocialData; id: string } {
  refuse(mechanicProblem(ctx.me, input, ctx.social.mechanics, ctx.club.positions));
  const me = ctx.me as Member;
  const clean = cleanMechanic(input);
  if (input.id === null) {
    const id = `mech-${ctx.social.mechanics.length + 1}-${Date.now().toString(36)}`;
    const added: Mechanic = { id, ...clean, addedBy: me.id, addedAt: ctx.now ?? new Date().toISOString(), archivedAt: null };
    return { social: { ...ctx.social, mechanics: [...ctx.social.mechanics, added] }, id };
  }
  return {
    social: { ...ctx.social, mechanics: ctx.social.mechanics.map((m) => (m.id === input.id ? { ...m, ...clean } : m)) },
    id: input.id,
  };
}

export function archiveMechanic(ctx: SocialCtx, id: string): SocialData {
  refuse(archiveProblem(ctx.me, id, ctx.social.mechanics, ctx.club.positions));
  const at = ctx.now ?? new Date().toISOString();
  return { ...ctx.social, mechanics: ctx.social.mechanics.map((m) => (m.id === id ? { ...m, archivedAt: at } : m)) };
}

export function vouchMechanic(ctx: SocialCtx, id: string, on: boolean): SocialData {
  refuse(vouchProblem(ctx.me, id, ctx.social.mechanics));
  const me = ctx.me as Member;
  const others = ctx.social.vouches.filter((v) => !(v.mechanicId === id && v.memberId === me.id));
  return { ...ctx.social, vouches: [...others, { mechanicId: id, memberId: me.id, vouched: on }] };
}

/** A parity.json case, as the social action it names. */
export type SocialAction =
  | { action: 'socialSetBirthday'; month: number | null; day: number | null }
  | { action: 'socialSetSkills'; skills: string[] }
  // The workshop's name is `workshop`: a case's `name` is the case's own.
  | ({ action: 'socialSaveMechanic'; mechanic: string | null; workshop: string } & Omit<MechanicInput, 'id' | 'name'>)
  | { action: 'socialArchiveMechanic'; mechanic: string }
  | { action: 'socialVouchMechanic'; mechanic: string; on: boolean };

export function runSocialAction(ctx: SocialCtx, a: SocialAction): SocialData {
  switch (a.action) {
    case 'socialSetBirthday':
      return setBirthday(ctx, a.month, a.day);
    case 'socialSetSkills':
      return setSkills(ctx, a.skills);
    case 'socialSaveMechanic':
      return saveMechanic(ctx, {
        id: a.mechanic, name: a.workshop, suburb: a.suburb, phone: a.phone, website: a.website, speciality: a.speciality, notes: a.notes,
      }).social;
    case 'socialArchiveMechanic':
      return archiveMechanic(ctx, a.mechanic);
    case 'socialVouchMechanic':
      return vouchMechanic(ctx, a.mechanic, a.on);
  }
}
