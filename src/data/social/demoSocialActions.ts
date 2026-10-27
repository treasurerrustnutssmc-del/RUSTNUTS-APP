// What each social action does to the demo's social data. Plain functions, like ../demoActions:
// they take the data as it is and hand back the data as it should be, or throw with the same words
// the database uses. src/data/parity.test.ts checks them against the database's rules.

import { approvalProblem } from '../../domain/chat';
import { birthdayProblem, type Birthday } from '../../domain/social/shoutouts';
import type { FeedItem } from '../chat/chatContext';
import type { ClubData, Member } from '../../domain/types';
import { NotAllowedError } from '../clubContext';

export interface SocialData {
  /** Shared birthdays only: taking one off removes it here (the database keeps a "not shared" row). */
  birthdays: Birthday[];
  /** Photos from earlier years, for On this day (the demo's chats only go back a fortnight). */
  pastPhotos: FeedItem[];
}

export interface SocialCtx {
  social: SocialData;
  club: ClubData;
  me: Member | null;
  /** The club's date (Melbourne), ISO. */
  today: string;
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

/** A parity.json case, as the social action it names. */
export type SocialAction = { action: 'socialSetBirthday'; month: number | null; day: number | null };

export function runSocialAction(ctx: SocialCtx, a: SocialAction): SocialData {
  switch (a.action) {
    case 'socialSetBirthday':
      return setBirthday(ctx, a.month, a.day);
  }
}
