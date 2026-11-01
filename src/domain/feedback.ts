/**
 * Feedback & issues: members tell the club what's wrong with the app, or what they'd like. Anyone
 * approved in the app (Family too) sends a report; the app keepers (a sitting Treasurer, or the
 * NEC Chairman or Secretary) read them all, mark them looking / done and reply. The database
 * mirrors these rules (supabase/migrations/*_app_feedback.sql); change both together.
 * Spec: docs/superpowers/specs/2026-11-01-app-feedback-design.md
 */
import { activePositions } from './access';
import type { Member, Position } from './types';

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_STATUSES = ['new', 'looking', 'done'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_MAX = 1000;
export const FEEDBACK_WHERE_MAX = 60;
export const FEEDBACK_REPLY_MAX = 600;
export const FEEDBACK_PER_DAY = 5;

export const BAD_FEEDBACK_KIND = 'Pick what it is: something wrong, an idea or other.';
export const NO_FEEDBACK = 'Tell us what happened.';
export const LONG_FEEDBACK = 'Keep it to 1,000 characters.';
export const LONG_FEEDBACK_WHERE = 'Keep “where” to 60 characters.';
export const TOO_MUCH_FEEDBACK = 'That’s five today. Send more tomorrow, or message the treasurer.';
export const NOT_FEEDBACK_KEEPER = 'Only the app keepers can answer feedback.';
export const FEEDBACK_GONE = 'No such report.';
export const BAD_FEEDBACK_STATUS = 'Pick a status: new, looking into it or done.';
export const LONG_FEEDBACK_REPLY = 'Keep the reply to 600 characters.';

/** A report as the app shows it. The email comes only to keepers. */
export interface Feedback {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string | null;
  kind: FeedbackKind;
  body: string;
  whereInApp: string | null;
  screenshotPath: string | null;
  appVersion: string;
  build: string;
  device: string;
  status: FeedbackStatus;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface FeedbackInput {
  kind: string;
  body: string;
  whereInApp: string;
  /** How many this member has sent in the last day, so the fifth is the last. */
  sentToday: number;
}

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value);
}
export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

/** Approved in the app, Family included: anyone who uses it can report on it. */
function usesApp(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  return null;
}

/** A sitting Treasurer (either chapter) or NEC Chairman / Secretary. Mirrors private.is_feedback_keeper. */
export function isFeedbackKeeper(me: Member | null, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved' || me.status === 'family') return false;
  return activePositions(me.id, positions).some((p) => p.role === 'treasurer' || p.role === 'nec_chair' || p.role === 'nec_secretary');
}

/** Why this report can't be sent, or null when it can. Mirrors send_app_feedback, in its order. */
export function sendFeedbackProblem(me: Member | null, input: FeedbackInput): string | null {
  const notIn = usesApp(me);
  if (notIn) return notIn;
  if (!isFeedbackKind(input.kind)) return BAD_FEEDBACK_KIND;
  const body = input.body.trim();
  if (!body) return NO_FEEDBACK;
  if (body.length > FEEDBACK_MAX) return LONG_FEEDBACK;
  if (input.whereInApp.trim().length > FEEDBACK_WHERE_MAX) return LONG_FEEDBACK_WHERE;
  if (input.sentToday >= FEEDBACK_PER_DAY) return TOO_MUCH_FEEDBACK;
  return null;
}

/**
 * The reports `me` may see, in Board order: new, then looking, then done, newest first within
 * each. A keeper sees the lot; anyone else only their own. Mirrors the row-level security.
 */
export function feedbackSeenBy(me: Member | null, positions: Position[], list: Feedback[]): Feedback[] {
  if (!me) return [];
  const keeper = isFeedbackKeeper(me, positions);
  const rank: Record<FeedbackStatus, number> = { new: 0, looking: 1, done: 2 };
  return list
    .filter((f) => keeper || f.memberId === me.id)
    .sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt));
}

/** Why `me` can't answer this report, or null when they can. Mirrors answer_app_feedback. */
export function answerFeedbackProblem(
  me: Member | null,
  positions: Position[],
  report: Feedback | null,
  status: string,
  reply: string,
): string | null {
  const notIn = usesApp(me);
  if (notIn) return notIn;
  if (!isFeedbackKeeper(me, positions)) return NOT_FEEDBACK_KEEPER;
  if (!report) return FEEDBACK_GONE;
  if (!isFeedbackStatus(status)) return BAD_FEEDBACK_STATUS;
  if (reply.trim().length > FEEDBACK_REPLY_MAX) return LONG_FEEDBACK_REPLY;
  return null;
}

export function feedbackKindLabel(kind: FeedbackKind | string): string {
  switch (kind) {
    case 'bug': return 'Something’s wrong';
    case 'idea': return 'An idea';
    case 'other': return 'Other';
    default: return kind;
  }
}

export function feedbackStatusLabel(status: FeedbackStatus | string): string {
  switch (status) {
    case 'new': return 'New';
    case 'looking': return 'Looking into it';
    case 'done': return 'Done';
    default: return status;
  }
}

/** "v0.1.0 · update 3f2a9c1d · Android 15 · SM-S938B": what the app attached, for the keeper. */
export function deviceLine(f: Pick<Feedback, 'appVersion' | 'build' | 'device'>): string {
  const parts: string[] = [];
  if (f.appVersion) parts.push(`v${f.appVersion}`);
  if (f.build) parts.push(/^[0-9a-f]{8}-/i.test(f.build) ? `update ${f.build.slice(0, 8)}` : f.build);
  if (f.device) parts.push(f.device);
  return parts.length ? parts.join(' · ') : 'unknown';
}

/** The Email button: a reply in the mail app, or null when the keeper can't see the address. */
export function feedbackMailto(f: Feedback): string | null {
  if (!f.memberEmail) return null;
  const subject = encodeURIComponent('Your Rustnuts app feedback');
  const body = encodeURIComponent(`Hi ${f.memberName.split(' ')[0]},\n\n`);
  return `mailto:${encodeURIComponent(f.memberEmail)}?subject=${subject}&body=${body}`;
}
