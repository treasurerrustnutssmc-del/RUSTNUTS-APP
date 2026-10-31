// The send-push function's logic, kept free of Deno and Supabase so it can be tested with node:test
// (src/data/sendPush.test.ts). One round: take what's queued (the database holds everything while the
// master switch is off), post it to Expo 100 at a time, then record what went and any dead phones.

export interface OutboxMessage {
  id: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  tokens: string[];
  /** The member wants the Harley rev. Missing (before rev-sound.sql is live) means yes. */
  rev?: boolean;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: string;
  data: Record<string, unknown>;
  priority?: 'high';
  channelId?: string;
  /** iPhone only: a time-sensitive push breaks through Focus and the notification summary (the app's
   *  time-sensitive entitlement allows it). Only live ride alerts earn it. */
  interruptionLevel?: 'time-sensitive';
  /** Ours, to match tickets to outbox rows; removed before posting. */
  outboxId: number;
}

export interface ExpoTicket {
  status: 'ok' | 'error' | string;
  details?: { error?: string };
}

// The same channels and sound as soundFor in src/domain/notifications.ts, which the phone sets up
// (this file can't import the app's code; a test checks they agree). Android plays the channel's sound,
// iPhone the message's.
// Android builds from before the rev don't have the club and chat channels, and Android drops a push naming a
// channel it doesn't have. That's safe only because no Android build can register for pushes until
// the app has its Firebase project, and any build that adds it already has the channels.
// The rev2 channels (the second rev sound) come with a new build: deploy this only once testers'
// Android phones have it, or their rev pushes are dropped until they update.
const REV_SOUND = 'v_twin_rev_2.wav';
function soundFor(kind: unknown, rev: boolean): { channelId: string; sound: string } {
  if (kind === 'live-alert') return { channelId: 'ride-alerts', sound: 'default' };
  // Chat has its own channels, so members can quiet chat on the phone and keep ride news.
  const base = kind === 'chat' ? 'chat' : 'club';
  return rev ? { channelId: `${base}-rev2`, sound: REV_SOUND } : { channelId: base, sound: 'default' };
}

/** One message per phone. Live ride alerts keep the urgent sound and are time-sensitive on iPhone;
 *  the rest rev unless the member switched it off. All go high priority: Android holds normal ones
 *  while the phone sleeps, so a chat message could turn up many minutes late or not until the app
 *  is opened. */
export function toExpoMessages(rows: OutboxMessage[]): ExpoMessage[] {
  return rows.flatMap((r) => {
    const { channelId, sound } = soundFor(r.data.kind, r.rev ?? true);
    const urgent = r.data.kind === 'live-alert';
    return r.tokens.map((to): ExpoMessage => ({
      to,
      title: r.title,
      body: r.body,
      sound,
      channelId,
      data: r.data,
      priority: 'high',
      ...(urgent ? { interruptionLevel: 'time-sensitive' as const } : {}),
      outboxId: r.id,
    }));
  });
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Phones Expo says no longer exist (the app was removed, or the token replaced). Tickets come back in order. */
export function deadTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  return messages.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map((m) => m.to);
}

export async function sendAll(io: {
  take: () => Promise<{ enabled: boolean; messages: OutboxMessage[] }>;
  post: (batch: Omit<ExpoMessage, 'outboxId'>[]) => Promise<ExpoTicket[]>;
  done: (sent: number[], failed: number[], dead: string[]) => Promise<void>;
}): Promise<{ enabled: boolean; sent: number; failed: number }> {
  const { enabled, messages } = await io.take();
  if (!enabled || messages.length === 0) return { enabled, sent: 0, failed: 0 };
  const delivered = new Set<number>();
  const dead: string[] = [];
  for (const batch of chunk(toExpoMessages(messages), 100)) {
    try {
      const tickets = await io.post(batch.map(({ outboxId: _id, ...m }) => m));
      batch.forEach((m, i) => tickets[i]?.status === 'ok' && delivered.add(m.outboxId));
      dead.push(...deadTokens(batch, tickets));
    } catch {
      // The whole batch failed; its rows are recorded as failed below unless another phone got them.
    }
  }
  const sent = messages.filter((m) => delivered.has(m.id)).map((m) => m.id);
  const failed = messages.filter((m) => !delivered.has(m.id)).map((m) => m.id);
  await io.done(sent, failed, dead);
  return { enabled, sent: sent.length, failed: failed.length };
}
