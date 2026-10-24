import type { LicenceClass, MemberStatus, PositionRole } from './types';

export const STATUS_LABEL: Record<MemberStatus, string> = {
  introduced: 'Introduced',
  fng: 'FNG',
  full: 'Full patch',
  nomad: 'Nomad',
  supporter: 'Supporter',
  family: 'Family',
};

export const STATUS_ORDER: MemberStatus[] = ['full', 'nomad', 'fng', 'introduced', 'supporter', 'family'];

export const ROLE_LABEL: Record<PositionRole, string> = {
  president: 'President',
  vice_president: 'Vice President',
  secretary: 'Secretary',
  treasurer: 'Treasurer',
  sergeant_at_arms: 'Sergeant at Arms',
  road_captain: 'Road Captain',
  officer: 'Officer',
  tail_gunner: 'Tail Gunner',
  social_media_officer: 'Social Media Officer',
  club_coach: 'Club Coach',
  ride_committee: 'Ride Committee',
  assistant_tail_gunner: 'Assistant Tail Gunner',
  nec_chair: 'National Chairman',
  nec_secretary: 'National Secretary',
  nec_auditor: 'National Auditor',
  founder: 'Founder',
};

/** Short forms used on chips, matching the Road Rules formation labels. */
export const ROLE_SHORT: Record<PositionRole, string> = {
  president: 'PRES',
  vice_president: 'VP',
  secretary: 'SEC',
  treasurer: 'TRE',
  sergeant_at_arms: 'SAA',
  road_captain: 'RC',
  officer: 'O',
  tail_gunner: 'TG',
  social_media_officer: 'SMO',
  club_coach: 'COACH',
  ride_committee: 'RIDE COMM',
  assistant_tail_gunner: 'ATG',
  nec_chair: 'NEC CHAIR',
  nec_secretary: 'NEC SEC',
  nec_auditor: 'AUDITOR',
  founder: 'FOUNDER',
};

export const LICENCE_LABEL: Record<LicenceClass, string> = {
  full_open: 'Full open',
  probationary_open: 'Probationary open',
  learner: 'Learner',
};

export const BOARD_ROLES: PositionRole[] = [
  'president',
  'vice_president',
  'secretary',
  'treasurer',
  'sergeant_at_arms',
  'road_captain',
];

export const CLUB_ROLES: PositionRole[] = [
  'officer',
  'tail_gunner',
  'assistant_tail_gunner',
  'social_media_officer',
  'club_coach',
  'ride_committee',
];

export const NATIONAL_ROLES: PositionRole[] = ['nec_chair', 'nec_secretary', 'nec_auditor'];

/** Honorary titles: held club-wide like national roles, but they grant no powers. */
export const TITLE_ROLES: PositionRole[] = ['founder'];

/** Roles that belong to the whole club rather than one chapter. */
export function isChapterless(role: PositionRole): boolean {
  return NATIONAL_ROLES.includes(role) || TITLE_ROLES.includes(role);
}

/** Order positions are listed in: Founder first, Officers last. */
export const ROLE_ORDER: PositionRole[] = [...TITLE_ROLES, ...NATIONAL_ROLES, ...BOARD_ROLES, ...CLUB_ROLES];
