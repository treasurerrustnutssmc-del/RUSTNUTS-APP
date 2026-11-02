/**
 * Asking before anything goes to the club's AI (App Store Guideline 5.1.2(i)): Ask the club and
 * Catch me up send a member's data to Anthropic (Claude), so each shows a one-time card first
 * that says what goes and asks Agree / Not now. Until they agree, the feature sends nothing.
 *
 * The agreement is kept on the phone, per member (no database change): a second member signing
 * in on the same phone is asked again. Each feature is agreed to on its own, because each sends
 * different things.
 */

export type AiFeature = 'askClub' | 'catchUp';

export const AI_FEATURES: readonly AiFeature[] = ['askClub', 'catchUp'];

/** Feature → ISO date (YYYY-MM-DD) the member agreed. */
export type AiConsentRecord = Partial<Record<AiFeature, string>>;

/** The bit of AsyncStorage this needs (and a test can fake). */
export interface ConsentStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AiConsentCopy {
  heading: string;
  intro: string;
  /** What goes to Anthropic, one point each. */
  sends: string[];
  promise: string;
  agree: 'Agree';
  notNow: 'Not now';
}

const PROMISE = 'Anthropic doesn’t use it to train AI, and the answers aren’t kept beyond the app’s own use.';

export const AI_CONSENT: Record<AiFeature, AiConsentCopy> = {
  askClub: {
    heading: 'Before you ask',
    intro: 'Ask the club is answered by Anthropic (Claude), the club’s AI provider. Each time you ask, the app sends Anthropic:',
    sends: [
      'Your question and the conversation so far.',
      'A summary of what you can see in the app: the calendar, the Rusty Bus, your own fees, members’ names and roles, and the chats you can post in.',
    ],
    promise: PROMISE,
    agree: 'Agree',
    notNow: 'Not now',
  },
  catchUp: {
    heading: 'Before you catch up',
    intro: 'Catch me up is written by Anthropic (Claude), the club’s AI provider. Each time you tap it, the app sends Anthropic:',
    sends: ['The newest messages in this chat, with who wrote them and when.'],
    promise: PROMISE,
    agree: 'Agree',
    notNow: 'Not now',
  },
};

/** The short line that stays on screen after agreeing. */
export const AI_PROVIDER_LINE: Record<AiFeature, string> = {
  askClub: 'Your questions go to Anthropic (Claude), the club’s AI provider, to write the answers, and aren’t used to train AI.',
  catchUp: 'Catch me up sends the newest messages to Anthropic (Claude), the club’s AI provider, to write this. They aren’t kept or used to train AI.',
};

export const aiConsentKey = (memberId: string) => `rustnuts.aiConsent.v1.${memberId}`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** What's saved, read safely: anything that isn't a date counts as not agreed. */
export function parseAiConsent(raw: string | null | undefined): AiConsentRecord {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: AiConsentRecord = {};
  for (const feature of AI_FEATURES) {
    const on = (value as Record<string, unknown>)[feature];
    if (typeof on === 'string' && ISO.test(on)) out[feature] = on;
  }
  return out;
}

export const hasAiConsent = (record: AiConsentRecord, feature: AiFeature): boolean => !!record[feature];

export const withAiConsent = (record: AiConsentRecord, feature: AiFeature, today: string): AiConsentRecord => ({
  ...record,
  [feature]: record[feature] ?? today,
});

export async function readAiConsent(store: ConsentStore, memberId: string): Promise<AiConsentRecord> {
  try {
    return parseAiConsent(await store.getItem(aiConsentKey(memberId)));
  } catch {
    return {};
  }
}

/** Saves the agreement and returns the new record (a failed write still counts for this session). */
export async function saveAiConsent(store: ConsentStore, memberId: string, feature: AiFeature, today: string): Promise<AiConsentRecord> {
  const next = withAiConsent(await readAiConsent(store, memberId), feature, today);
  await store.setItem(aiConsentKey(memberId), JSON.stringify(next)).catch(() => undefined);
  return next;
}
