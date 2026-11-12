// "Club words": what the club's own words mean, in one plain line each. The wording comes from
// Chris (12/11/2026) and is for Jeff to correct. Short role forms come from ROLE_SHORT, so the key
// can never drift from what the chips show.
import { ROLE_LABEL, ROLE_SHORT } from './labels';
import type { PositionRole } from './types';

export type GlossaryEntry = { term: string; meaning: string };
export type GlossaryGroup = { title: string; entries: GlossaryEntry[] };

export const GLOSSARY: GlossaryGroup[] = [
  {
    title: 'People',
    entries: [
      { term: 'Hang Around', meaning: 'Very new to the club and getting to know us. Not yet an FNG. The app also calls this Introduced.' },
      { term: 'Applicant', meaning: 'Someone who has asked to join and is waiting for the board to approve them.' },
      { term: 'FNG', meaning: 'Someone who has started the process of becoming a Full member.' },
      { term: 'Full member', meaning: 'A member who has earned the round MEMBER patch, called the disc.' },
      { term: 'The disc', meaning: 'The round MEMBER patch, earned when you become a Full member.' },
      { term: 'Nomad', meaning: 'A member with no local chapter who still calls in for meetings.' },
      { term: 'Legacy', meaning: 'A Full member who has stepped away from the club.' },
      { term: 'Supporter', meaning: 'A friend of the club, or family of an FNG or a Hang Around.' },
      { term: 'Family', meaning: 'The kids, partners, wives and husbands of Full members.' },
    ],
  },
  {
    title: 'Rides',
    entries: [
      { term: 'Big 4', meaning: 'The club’s mandatory rides, usually overnight.' },
      { term: 'Supported ride', meaning: 'Another club’s ride that we support, such as a charity event.' },
      { term: 'Non-Nuts ride', meaning: 'A ride organised by someone else. It is shown so we don’t create a clashing ride.' },
      { term: 'KSU', meaning: 'Kickstands up: the time the ride leaves.' },
    ],
  },
  {
    title: 'Boards and meetings',
    entries: [
      { term: 'Board', meaning: 'A chapter’s board. The club also calls it the big table or the committee.' },
      { term: 'NEC', meaning: 'The National Executive Committee: the National Chairman, the National Secretary and the sitting chapter Presidents.' },
      { term: 'Monthly chapter meeting', meaning: 'Each chapter holds its own meeting every month.' },
      { term: 'Annual Chapter Meeting', meaning: 'Each chapter’s own AGM.' },
      { term: 'Association AGM', meaning: 'The one combined AGM for the whole club, held at an overnighter.' },
    ],
  },
];

/** Every short form shown on a chip, with the full title it stands for. The chapter shows in brackets, like SAA (WEST). */
export function roleKey(): { short: string; title: string }[] {
  return (Object.keys(ROLE_SHORT) as PositionRole[]).map((role) => ({ short: ROLE_SHORT[role], title: ROLE_LABEL[role] }));
}
