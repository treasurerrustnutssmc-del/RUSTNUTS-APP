/**
 * The club rules for chats and posts: what every member agrees to before they can post in the
 * app (App Store Guideline 1.2 asks for terms with no tolerance for objectionable content or
 * abusive members, a way to report, a way to block, and action within 24 hours). The Club rules
 * screen shows it, `npm run build:privacy` turns it into site/posting-rules.html, and the same
 * text goes into App Store Connect as the licence agreement. A test keeps the page and this text
 * the same.
 *
 * The database keeps the member's agreement in members.posting_rules_accepted_on and refuses
 * posts until it's set (supabase/migrations/20270600000000_member_content_rules.sql); the app's
 * rule functions say the same thing in the same place.
 */

import type { Member } from './types';

/** Where the rules live on the web. */
export const POSTING_RULES_URL = 'https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/posting-rules.html';

export const POSTING_RULES_EMAIL = 'apps@rustnutssmc.com.au';

/** ISO date the rules last changed. */
export const POSTING_RULES_UPDATED_ON = '2026-10-31';

export const POSTING_RULES_TITLE = 'Club rules for chats and posts';

/** Why a member can't post yet. The database uses the same words. */
export const AGREE_FIRST = 'Agree to the club rules for chats and posts first.';

/** A paragraph, or a list of points (the same shape as the privacy policy). */
export type RulesBlock = string | { points: string[] };

export interface RulesSection {
  id: string;
  heading: string;
  blocks: RulesBlock[];
}

export const POSTING_RULES_INTRO =
  'The chats, swap and sell, build threads, bragging rights, the workshop list and your profile are the club talking to itself. These are the rules for all of it. You agree to them once, and they apply every time you post.';

export const POSTING_RULES_SECTIONS: RulesSection[] = [
  {
    id: 'no-tolerance',
    heading: 'No tolerance',
    blocks: [
      'There is no tolerance in this app for objectionable content or abusive members. Banter is fine. The following is not, anywhere in the app:',
      {
        points: [
          'Abuse, bullying, threats or harassment of anyone, in or out of the club.',
          'Slurs or attacks on anyone’s race, religion, sex, sexuality, disability or background.',
          'Sexual, pornographic or gratuitously violent words, photos, videos or GIFs.',
          'Anyone’s private details, photos or messages shared without their say-so.',
          'Anything illegal, including selling what you’re not allowed to sell.',
          'Anything that would shame the club, its sponsors or the people the Rusty Bus rides for.',
        ],
      },
    ],
  },
  {
    id: 'what-happens',
    heading: 'What happens when something is reported',
    blocks: [
      'Every message, listing, build update, nomination, workshop entry and profile has a Report button. Reports go to the chapter boards and the NEC, who act on them within 24 hours, normally much sooner.',
      {
        points: [
          'Content that breaks these rules is removed.',
          'A member who posts it can have their app access suspended on the spot, which cuts them off from the chats, the posts and the directory. The board then deals with it under the club’s constitution.',
          'Anything you report disappears from your own view straight away, before the board has looked at it.',
        ],
      },
    ],
  },
  {
    id: 'block',
    heading: 'Blocking',
    blocks: [
      'You can block any member from their message or from their page in Members. You won’t see their messages, listings or build threads, and neither of you can message the other. Only you know.',
    ],
  },
  {
    id: 'your-posts',
    heading: 'Your posts',
    blocks: [
      'What you post is yours, and you’re responsible for it. The club can remove any post that breaks these rules, and a board member can remove anything in a chat they look after. Reported messages are kept for the board to see even after they’re removed.',
      'The club’s constitution and its Road Rules apply as well. Nothing here overrides them.',
    ],
  },
  {
    id: 'contact',
    heading: 'Reaching the club',
    blocks: [
      `Questions, or something you can’t report from the app: email ${POSTING_RULES_EMAIL}. Rustnuts Social Motorcycle Club Incorporated, Victoria, Australia.`,
    ],
  },
];

/** "Last updated 31/10/2026". */
export function postingRulesUpdatedLine(iso: string = POSTING_RULES_UPDATED_ON): string {
  const [y, m, d] = iso.split('-');
  return `Last updated ${d}/${m}/${y}`;
}

/**
 * Has this member agreed to the rules? `null` means not yet. Members loaded from the database and
 * the demo always carry the field; a member built without it (older fixtures) counts as agreed.
 */
export function hasAgreedPostingRules(me: Pick<Member, 'postingRulesAcceptedOn'> | null): boolean {
  return !me || me.postingRulesAcceptedOn !== null;
}

/** Why `me` can't post anything yet, or null. Checked last, as the row would go in. */
export function postingRulesProblem(me: Pick<Member, 'postingRulesAcceptedOn'> | null): string | null {
  return hasAgreedPostingRules(me) ? null : AGREE_FIRST;
}

/** An approved member who isn't Family and hasn't agreed yet: the app shows the rules instead of the tabs. */
export function needsPostingRules(me: Member | null): boolean {
  return !!me && me.approval === 'approved' && me.status !== 'family' && !hasAgreedPostingRules(me);
}

/**
 * Why `me` can't save this bio, or null. A blank bio is fine before agreeing (a name change), and
 * so is leaving the bio as it was: the database trigger only looks at a changed, non-blank bio.
 */
export function bioProblem(me: Pick<Member, 'postingRulesAcceptedOn' | 'bio'> | null, bio: string | null | undefined): string | null {
  if (!bio || bio.trim() === '') return null;
  if (me && bio === me.bio) return null;
  return postingRulesProblem(me);
}
