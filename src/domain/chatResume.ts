// Open a chat where I left off (Jeff, 28 Nov 2026: "I have to keep scrolling back to find where I've
// left off"). The unread count is taken when the chat opens; the first new message is the oldest of
// that many other people's messages still there, counting back from the newest.

type MessageLike = { id: string; authorId: string; createdAt: string; removedAt: string | null };

export interface FirstNew {
  messageId: string;
  /** False when more were new than are loaded: older pages should load before this is final. */
  complete: boolean;
}

export function firstNewMessage<M extends MessageLike>(messages: M[], meId: string, unread: number): FirstNew | null {
  if (unread <= 0) return null;
  const theirs = messages
    .filter((m) => m.authorId !== meId && !m.removedAt)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (!theirs.length) return null;
  if (theirs.length >= unread) return { messageId: theirs[unread - 1].id, complete: true };
  return { messageId: theirs[theirs.length - 1].id, complete: false };
}
