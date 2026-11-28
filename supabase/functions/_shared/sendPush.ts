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
   *  time-sensitive entitlement allows it). Only live ride alerts and chat tags earn it. */
  interruptionLevel?: 'time-sensitive';
  /** Android: a notification with the same tag replaces the one already showing. */
  tag?: string;
  /** iPhone: replaces the notification already showing with the same id (Android: only the latest of
   *  these is delivered if the phone was offline, which is fine, as the latest holds the whole stack). */
  collapseId?: string;
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
// The rev2 channels (the second rev sound) come with a new build. A phone on an older build doesn't
// have them, so expo-notifications shows the push on its fallback channel with the plain sound until
// the phone updates (an iPhone without the new file plays the default sound too).
const REV_SOUND = 'v_twin_rev_2.wav';
function soundFor(kind: unknown, rev: boolean): { channelId: string; sound: string } {
  if (kind === 'live-alert') return { channelId: 'ride-alerts', sound: 'default' };
  // A chat tag rings on its own loud channel with the phone's own sound (20271020000000_chat_tags.sql).
  if (kind === 'tag') return { channelId: 'tags', sound: 'default' };
  // Chat has its own channels, so members can quiet chat on the phone and keep ride news.
  const base = kind === 'chat' ? 'chat' : 'club';
  return rev ? { channelId: `${base}-rev2`, sound: REV_SOUND } : { channelId: base, sound: 'default' };
}

/** Chat stacks like Messenger: one notification per chat, each new message replacing the last one for
 *  that chat. The database writes the stack into the message (the unread lines and a count in the
 *  title; push_chat_message in 20270950000000_chat_push_stack.sql), so nothing is lost when it's
 *  replaced. Everything else keeps a notification of its own. */
function stackFor(data: Record<string, unknown>): { tag: string; collapseId: string } | null {
  if (data.kind !== 'chat' || typeof data.chatId !== 'string' || data.chatId === '') return null;
  const key = `chat-${data.chatId}`;
  return { tag: key, collapseId: key };
}

/** One message per phone. Live ride alerts keep the urgent sound and are time-sensitive on iPhone (tags
 *  are time-sensitive too, with their own channel and never stacked);
 *  the rest rev unless the member switched it off. All go high priority: Android holds normal ones
 *  while the phone sleeps, so a chat message could turn up many minutes late or not until the app
 *  is opened. */
export function toExpoMessages(rows: OutboxMessage[]): ExpoMessage[] {
  return rows.flatMap((r) => {
    const { channelId, sound } = soundFor(r.data.kind, r.rev ?? true);
    // A tag is someone calling you by name, so it gets through Focus like a live ride alert.
    const urgent = r.data.kind === 'live-alert' || r.data.kind === 'tag';
    const stack = stackFor(r.data);
    return r.tokens.map((to): ExpoMessage => ({
      to,
      title: r.title,
      body: r.body,
      sound,
      channelId,
      data: r.data,
      priority: 'high',
      ...(urgent ? { interruptionLevel: 'time-sensitive' as const } : {}),
      ...(stack ?? {}),
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

/** Several chat pushes in one round for the same chat and the same member's phones: only the newest
 *  goes. Each holds the whole stack, and the phone would only replace one with the next; sending them
 *  together, they could land out of order and leave an older, shorter stack showing. The older ones
 *  count as sent when the newest is. */
export function newestPerChat(rows: OutboxMessage[]): { keep: OutboxMessage[]; supersededBy: Map<number, number> } {
  const newest = new Map<string, number>();
  const key = (r: OutboxMessage) =>
    stackFor(r.data) ? `${String(r.data.chatId)}|${[...r.tokens].sort().join(',')}` : null;
  for (const r of rows) {
    const k = key(r);
    if (k !== null && r.id > (newest.get(k) ?? -Infinity)) newest.set(k, r.id);
  }
  const supersededBy = new Map<number, number>();
  const keep = rows.filter((r) => {
    const k = key(r);
    const top = k === null ? r.id : newest.get(k)!;
    if (top !== r.id) supersededBy.set(r.id, top);
    return top === r.id;
  });
  return { keep, supersededBy };
}

export async function sendAll(io: {
  take: () => Promise<{ enabled: boolean; messages: OutboxMessage[] }>;
  post: (batch: Omit<ExpoMessage, 'outboxId'>[]) => Promise<ExpoTicket[]>;
  done: (sent: number[], failed: number[], dead: string[]) => Promise<void>;
}): Promise<{ enabled: boolean; sent: number; failed: number }> {
  const { enabled, messages } = await io.take();
  if (!enabled || messages.length === 0) return { enabled, sent: 0, failed: 0 };
  const { keep, supersededBy } = newestPerChat(messages);
  const delivered = new Set<number>();
  const dead: string[] = [];
  for (const batch of chunk(toExpoMessages(keep), 100)) {
    try {
      const tickets = await io.post(batch.map(({ outboxId: _id, ...m }) => m));
      batch.forEach((m, i) => tickets[i]?.status === 'ok' && delivered.add(m.outboxId));
      dead.push(...deadTokens(batch, tickets));
    } catch {
      // The whole batch failed; its rows are recorded as failed below unless another phone got them.
    }
  }
  for (const [older, newer] of supersededBy) if (delivered.has(newer)) delivered.add(older);
  const sent = messages.filter((m) => delivered.has(m.id)).map((m) => m.id);
  const failed = messages.filter((m) => !delivered.has(m.id)).map((m) => m.id);
  await io.done(sent, failed, dead);
  return { enabled, sent: sent.length, failed: failed.length };
}
