import type {
  BallotChoice,
  CrewRole,
  Electorate,
  LicenceClass,
  MeetingKind,
  MemberStatus,
  PositionRole,
  RideCategory,
  RsvpAnswer,
  Threshold,
  VoteResult,
} from './types';

export const STATUS_LABEL: Record<MemberStatus, string> = {
  introduced: 'Introduced',
  fng: 'FNG',
  full: 'Full patch',
  nomad: 'Nomad',
  supporter: 'Supporter',
  family: 'Family',
  legacy: 'Legacy',
};

/** What a board can let a new applicant in as. Full and Nomad are earned, and Legacy is for leaving. */
export const APPROVE_AS: MemberStatus[] = ['introduced', 'fng', 'supporter', 'family'];

export const STATUS_ORDER: MemberStatus[] = ['full', 'nomad', 'fng', 'introduced', 'supporter', 'family', 'legacy'];

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
  charity_committee: 'Charity Committee',
};

/** Short forms used on chips, matching the Road Rules formation labels. */
export const ROLE_SHORT: Record<PositionRole, string> = {
  president: 'PRES',
  vice_president: 'VP',
  secretary: 'SEC',
  treasurer: 'TREAS',
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
  charity_committee: 'CHARITY',
};

/** The spots on a ride's crew, in the order they're listed. Labels come from ROLE_LABEL and ROLE_SHORT. */
export const CREW_ROLES: CrewRole[] = ['road_captain', 'tail_gunner', 'assistant_tail_gunner', 'officer'];

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
  'charity_committee',
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

/** The website's Ride Calendar colour key, in its order. */
export const RIDE_CATEGORIES: RideCategory[] = ['north', 'west', 'club', 'supported', 'non_nuts'];

export const RIDE_CATEGORY_LABEL: Record<RideCategory, string> = {
  north: 'North',
  west: 'West',
  club: 'Rustnuts',
  supported: 'Supported',
  non_nuts: 'Non-Nuts',
};

export const RSVP_LABEL: Record<RsvpAnswer, string> = {
  going: 'Going',
  maybe: 'Maybe',
  no: 'Can’t make it',
};

// Stage 5: meetings and votes ----------------------------------------------------------------

/**
 * A meeting kind's name, which depends on whose meeting it is (constitution v4 10.2, 10.3): a
 * chapter's annual meeting is its Annual Chapter Meeting, not the statutory AGM, which belongs to
 * the Association (the whole club, chapterId null).
 */
export function meetingKindLabel(kind: MeetingKind, chapterId: string | null): string {
  switch (kind) {
    case 'board':
      return 'Board meeting';
    case 'general':
      return chapterId === null ? 'National Club meeting' : 'Chapter meeting';
    case 'agm':
      return chapterId === null ? 'Association AGM' : 'Annual Chapter Meeting';
    case 'special':
      return 'Special meeting';
    case 'nec':
      return 'NEC meeting';
  }
}

/** The kinds of meeting a chapter (or the whole club, when null) holds. */
export function kindsFor(chapterId: string | null): MeetingKind[] {
  return chapterId === null ? ['nec', 'general', 'agm', 'special'] : ['board', 'general', 'agm', 'special'];
}

export const ELECTORATE_LABEL: Record<Electorate, string> = {
  chapter_board: 'The chapter board',
  chapter_patched: 'The chapter’s Full Members',
  club_patched: 'Every Voting Member',
  nec: 'The NEC',
};

/** Who can be asked to vote on a chapter's question, or the whole club's (null). */
export function electoratesFor(chapterId: string | null): Electorate[] {
  return chapterId === null ? ['club_patched', 'nec'] : ['chapter_board', 'chapter_patched'];
}

export const THRESHOLD_LABEL: Record<Threshold, string> = {
  majority: 'Majority',
  two_thirds: 'Two-thirds',
  unanimous: 'Unanimous',
};

export const BALLOT_LABEL: Record<BallotChoice, string> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstain',
};

export const RESULT_LABEL: Record<VoteResult, string> = {
  carried: 'Carried',
  lost: 'Lost',
  no_quorum: 'No quorum',
};
