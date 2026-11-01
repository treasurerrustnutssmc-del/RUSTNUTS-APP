// App feedback as rows from the database, and the demo build's made-up reports.
import type { Feedback } from '../domain/feedback';

export interface FeedbackRow {
  id: string;
  member_id: string;
  member_name: string;
  member_email: string | null;
  kind: string;
  body: string;
  where_in_app: string | null;
  screenshot_path: string | null;
  app_version: string;
  build: string;
  device: string;
  status: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export function toFeedback(rows: FeedbackRow[]): Feedback[] {
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: r.member_name,
    memberEmail: r.member_email,
    kind: r.kind as Feedback['kind'],
    body: r.body,
    whereInApp: r.where_in_app,
    screenshotPath: r.screenshot_path,
    appVersion: r.app_version,
    build: r.build,
    device: r.device,
    status: r.status as Feedback['status'],
    reply: r.reply,
    repliedAt: r.replied_at,
    createdAt: r.created_at,
  }));
}

/** What the app attaches to every report. */
export interface AppDetails {
  appVersion: string;
  build: string;
  device: string;
}

/** What the form sends. */
export interface FeedbackDraft {
  kind: string;
  body: string;
  whereInApp: string;
  screenshotPath: string | null;
}

/** Two sample reports so the demo shows what the screens look like (on real demo members). */
export const DEMO_FEEDBACK: Feedback[] = [
  {
    id: 'demo-feedback-1',
    memberId: 'm-gravel',
    memberName: 'Brett Hughes',
    memberEmail: 'brett@example.com',
    kind: 'bug',
    body: 'The ride map went blank after I turned the phone sideways. Came back when I reopened the ride.',
    whereInApp: 'Rides, the map',
    screenshotPath: null,
    appVersion: '0.1.0',
    build: 'embedded',
    device: 'Android 15 · SM-S938B',
    status: 'new',
    reply: null,
    repliedAt: null,
    createdAt: '2026-10-31T08:40:00Z',
  },
  {
    id: 'demo-feedback-2',
    memberId: 'm-torque',
    memberName: 'Tania Walsh',
    memberEmail: 'tania@example.com',
    kind: 'idea',
    body: 'Could the ride list show how far each ride is from home?',
    whereInApp: 'Rides',
    screenshotPath: null,
    appVersion: '0.1.0',
    build: 'embedded',
    device: 'iOS 19.1 · iPhone 17',
    status: 'done',
    reply: 'Good one. It’s on the list for the next update.',
    repliedAt: '2026-10-29T03:15:00Z',
    createdAt: '2026-10-28T22:10:00Z',
  },
];

export function demoSendFeedback(
  list: Feedback[],
  me: { id: string; name: string },
  draft: FeedbackDraft,
  details: AppDetails,
  now: string,
): Feedback[] {
  const where = draft.whereInApp.trim();
  return [
    {
      id: `demo-feedback-${Date.now()}`,
      memberId: me.id,
      memberName: me.name,
      memberEmail: null,
      kind: draft.kind as Feedback['kind'],
      body: draft.body.trim(),
      whereInApp: where ? where : null,
      screenshotPath: draft.screenshotPath,
      appVersion: details.appVersion,
      build: details.build,
      device: details.device,
      status: 'new',
      reply: null,
      repliedAt: null,
      createdAt: now,
    },
    ...list,
  ];
}

export function demoAnswerFeedback(list: Feedback[], id: string, status: string, reply: string, now: string): Feedback[] {
  const words = reply.trim();
  return list.map((f) =>
    f.id === id
      ? { ...f, status: status as Feedback['status'], reply: words ? words : f.reply, repliedAt: words ? now : f.repliedAt }
      : f,
  );
}
