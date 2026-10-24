// Things shared into the app from another app's Share button: what comes across into a chat
// message, and what's left out. See the phone superpowers spec, section 4.

import { MAX_BODY, MAX_MEDIA } from './chat';

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
  for (const item of items) {
    if (item.kind === 'image' || item.kind === 'video') {
      const uri = item.uri || item.value;
      if (!uri) continue;
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
