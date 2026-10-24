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
  nec_chair: 'National Chairperson',
  nec_secretary: 'National Secretary',
  nec_auditor: 'NEC Auditor',
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
  nec_chair: 'NEC CHAIR',
  nec_secretary: 'NEC SEC',
  nec_auditor: 'AUDITOR',
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

export const CLUB_ROLES: PositionRole[] = ['officer', 'tail_gunner', 'social_media_officer', 'club_coach'];

export const NATIONAL_ROLES: PositionRole[] = ['nec_chair', 'nec_secretary', 'nec_auditor'];

/** Order positions are listed in: President first, Officers last. */
export const ROLE_ORDER: PositionRole[] = [...NATIONAL_ROLES, ...BOARD_ROLES, ...CLUB_ROLES];
