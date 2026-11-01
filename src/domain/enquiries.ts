/**
 * Join enquiries sent in from the club website's "Ride With Us" form. The website posts to the
 * `site-api` Edge Function, which checks the fields with these words and then stores the enquiry
 * with `public.site_enquiry`. The chapter board sees them on the Board screen and ticks them off.
 * The database mirrors these rules (supabase/migrations/*_site_enquiries.sql); change both together.
 */
import { isBoardOf, isNecOfficer } from './access';
import { signedInProblem } from './routes';
import { isAnyBoard } from './social/help';
import type { Member, Position } from './types';

export const ENQUIRY_CHAPTERS = ['west', 'north', 'either'] as const;
export type EnquiryChapter = (typeof ENQUIRY_CHAPTERS)[number];

export const NO_ENQUIRY_NAME = 'Tell us your name.';
export const LONG_ENQUIRY_NAME = 'Keep your name to 80 characters.';
export const BAD_ENQUIRY_EMAIL = 'That email address does not look right.';
export const NO_ENQUIRY_CHAPTER = 'Pick a chapter: West, North or either.';
export const LONG_ENQUIRY_ABOUT = 'Keep it to 600 characters.';
export const TOO_MANY_ENQUIRIES = 'Too many enquiries just now. Try again later, or email the club.';
export const NOT_ENQUIRY_READER = 'Only the board can see website enquiries.';
export const ENQUIRY_GONE = 'No such enquiry.';
export const ENQUIRY_HANDLED_ALREADY = 'That enquiry has already been handled.';
export const LONG_ENQUIRY_NOTE = 'Keep the note to 300 characters.';

export const ENQUIRY_NAME_MAX = 80;
export const ENQUIRY_EMAIL_MAX = 200;
export const ENQUIRY_ABOUT_MAX = 600;
export const ENQUIRY_NOTE_MAX = 300;

/** What the website form sends. */
export interface EnquiryInput {
  name: string;
  email: string;
  chapter: string;
  about: string;
}

/** A stored enquiry as the board sees it. */
export interface Enquiry {
  id: string;
  name: string;
  email: string;
  chapter: EnquiryChapter;
  about: string | null;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
  note: string | null;
}

/** A plausible address: something@something.tld, no spaces. The mail app does the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEnquiryChapter(value: string): value is EnquiryChapter {
  return (ENQUIRY_CHAPTERS as readonly string[]).includes(value);
}

/**
 * Why this form can't be sent, or null when it can. Checks in order, with the same words the
 * Edge Function and the database use.
 */
export function enquiryProblem(input: EnquiryInput): string | null {
  const name = input.name.trim();
  if (!name) return NO_ENQUIRY_NAME;
  if (name.length > ENQUIRY_NAME_MAX) return LONG_ENQUIRY_NAME;
  const email = input.email.trim();
  if (email.length > ENQUIRY_EMAIL_MAX || !EMAIL.test(email)) return BAD_ENQUIRY_EMAIL;
  if (!isEnquiryChapter(input.chapter)) return NO_ENQUIRY_CHAPTER;
  if (input.about.trim().length > ENQUIRY_ABOUT_MAX) return LONG_ENQUIRY_ABOUT;
  return null;
}

/** The form as stored: trimmed, email lowercased, an empty about kept as null. */
export function cleanEnquiry(input: EnquiryInput): { name: string; email: string; chapter: string; about: string | null } {
  const about = input.about.trim();
  return {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    chapter: input.chapter,
    about: about ? about : null,
  };
}

/**
 * The enquiries `me` may see, in Board screen order: open ones newest first, then handled ones.
 * A chapter board sees its own chapter's and "either"; the NEC officers (Chairman, Secretary) see
 * them all; everyone else none. Mirrors the row-level security on site_enquiries.
 */
export function enquiriesSeenBy(
  me: Member | null,
  positions: Position[],
  chapters: { id: string; slug: string }[],
  list: Enquiry[],
): Enquiry[] {
  if (!me || !isAnyBoard(me, positions)) return [];
  const national = isNecOfficer(me.id, positions);
  const mine = new Set(
    chapters.filter((c) => isBoardOf(me, c.id, positions)).map((c) => c.slug),
  );
  const visible = list.filter((e) => national || e.chapter === 'either' || mine.has(e.chapter));
  return [...visible].sort((a, b) => {
    const aOpen = a.handledAt === null ? 0 : 1;
    const bOpen = b.handledAt === null ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Why `me` can't mark this enquiry handled, or null when they can. Mirrors handle_site_enquiry. */
export function handleEnquiryProblem(
  me: Member | null,
  positions: Position[],
  enquiry: Enquiry | null,
  note: string,
): string | null {
  const notIn = signedInProblem(me);
  if (notIn) return notIn;
  if (!isAnyBoard(me, positions)) return NOT_ENQUIRY_READER;
  if (!enquiry) return ENQUIRY_GONE;
  if (enquiry.handledAt) return ENQUIRY_HANDLED_ALREADY;
  if (note.trim().length > ENQUIRY_NOTE_MAX) return LONG_ENQUIRY_NOTE;
  return null;
}

/** The Email button: a reply in the mail app with a club subject. */
export function mailtoFor(enquiry: Enquiry): string {
  const subject = encodeURIComponent(`Riding with Rustnuts SMC`);
  const body = encodeURIComponent(`Hi ${enquiry.name.split(' ')[0]},\n\n`);
  return `mailto:${encodeURIComponent(enquiry.email)}?subject=${subject}&body=${body}`;
}

export function enquiryChapterLabel(chapter: EnquiryChapter | string): string {
  switch (chapter) {
    case 'west': return 'West';
    case 'north': return 'North';
    case 'either': return 'Either chapter';
    default: return chapter;
  }
}
