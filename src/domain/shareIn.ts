// Things shared into the app from another app's Share button: what comes across into a chat
// message, and what's left out. See the phone superpowers spec, section 4.

import type { AccessLevel } from './access';
import { MAX_BODY, MAX_MEDIA } from './chat';
import type { MemberStatus } from './types';

/** One shared thing, as the phone hands it over (expo-sharing's resolved payload, trimmed down). */
export interface SharedItem {
  kind: 'text' | 'website' | 'image' | 'video' | 'audio' | 'file' | null;
  value: string;
  uri: string | null;
  mimeType: string | null;
  size: number | null;
}

/** A photo or video waiting to be measured and attached. */
export interface SharedMedia {
  uri: string;
  kind: 'photo' | 'video';
  mimeType: string | null;
  fileSize: number | null;
}

export interface SharedDraft {
  text: string;
  media: SharedMedia[];
  /** What didn't come across, in words. */
  notes: string[];
}

export const NOTHING_TO_SHARE = 'Nothing here can go in a chat. Share photos, videos, links or words.';

export function sharedDraft(items: SharedItem[]): SharedDraft {
  const lines: string[] = [];
  const media: SharedMedia[] = [];
  let tooMany = false;
  let leftOut = false;
  let sameName = false;
  for (const item of items) {
    if (item.kind === 'image' || item.kind === 'video') {
      const uri = item.uri || item.value;
      if (!uri) continue;
      // The share sheet saves files by name, so two with one name are the same file by now.
      if (media.some((m) => m.uri === uri)) { sameName = true; continue; }
      if (media.length >= MAX_MEDIA) { tooMany = true; continue; }
      media.push({ uri, kind: item.kind === 'image' ? 'photo' : 'video', mimeType: item.mimeType, fileSize: item.size });
    } else if (item.kind === 'audio' || item.kind === 'file') {
      leftOut = true;
    } else {
      const line = item.value.trim();
      if (line && !lines.includes(line)) lines.push(line);
    }
  }
  const notes: string[] = [];
  if (tooMany) notes.push(`Only the first ${MAX_MEDIA} photos and videos came across.`);
  if (sameName) notes.push('Two of those had the same name, so only one came across. Share the other on its own.');
  if (leftOut) notes.push('Files and voice notes can’t go in a chat, so they were left out.');
  let text = lines.join('\n');
  if ([...text].length > MAX_BODY) {
    text = [...text].slice(0, MAX_BODY).join('');
    notes.push(`That was too long for one message, so it was cut to ${MAX_BODY.toLocaleString('en-AU')} characters.`);
  }
  return { text, media, notes };
}

/** The parts of expo-sharing's resolved payload the club uses (kept here so the rules don't load the library). */
export interface IncomingPayload {
  value: string;
  shareType: 'text' | 'url' | 'audio' | 'image' | 'video' | 'file';
  mimeType?: string;
  contentUri: string | null;
  contentType?: 'text' | 'audio' | 'image' | 'video' | 'file' | 'website' | null;
  contentMimeType: string | null;
  contentSize: number | null;
}

export function itemFromPayload(p: IncomingPayload): SharedItem {
  // A link is the link the member shared, even when the page is a picture, a PDF or a redirect.
  if (p.shareType === 'url') return { kind: 'website', value: p.value, uri: null, mimeType: null, size: null };
  return {
    kind: p.contentType ?? p.shareType,
    value: p.value,
    uri: p.contentUri,
    mimeType: p.contentMimeType ?? p.mimeType ?? null,
    size: p.contentSize,
  };
}

/**
 * Where someone is when a share arrives that the app can't take: only approved members (not family)
 * have "Share to the club". signedOut: the share is kept and opens after sign-in. notMember (asking
 * to join, waiting for approval, declined) and family: it can't open, so it's let go.
 */
export type ShareWaitStage = 'signedOut' | 'notMember' | 'family';

export function shareWaitStage(s: {
  level: AccessLevel;
  needsApplication: boolean;
  loadError: boolean;
  status: MemberStatus | null;
}): ShareWaitStage | null {
  if (s.loadError) return null;
  if (s.needsApplication) return 'notMember';
  switch (s.level) {
    case 'public':
      return 'signedOut';
    case 'family':
      return 'family';
    case 'pending':
      return s.status === 'family' ? 'family' : 'notMember';
    default:
      return null; // members: "Share to the club" takes it
  }
}

/**
 * When a waiting share is let go. Signed out, only when they say so, since it opens once they sign
 * in. Anyone else's can never open, so it also goes when they leave the app (an iPhone would keep
 * it for good, and it would open by itself on approval). It isn't let go the moment it's seen: the
 * club data on screen can be a little old, and a share made just after approval should still open.
 */
export const letsGoOfShare = (stage: ShareWaitStage, event: 'dismiss' | 'background') =>
  event === 'dismiss' || stage !== 'signedOut';

/** The strip shown while a share waits, and its button. */
export function waitingShareNote(stage: ShareWaitStage): { title: string; text: string; action: string } {
  switch (stage) {
    case 'signedOut':
      return {
        title: 'Sign in first',
        text: 'It opens once you sign in as a member. If it doesn’t, share it again.',
        action: 'Don’t keep it',
      };
    case 'notMember':
      return { title: 'Members only', text: 'Only approved members can share into the club chats.', action: 'Got it' };
    case 'family':
      return { title: 'Members only', text: 'Family accounts don’t have the club chats.', action: 'Got it' };
  }
}
