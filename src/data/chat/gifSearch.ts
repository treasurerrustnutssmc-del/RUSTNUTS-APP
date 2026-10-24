// GIF search through GIPHY. GIPHY asks that searches come from the app itself, not a server, so the
// app holds its key (EXPO_PUBLIC_GIPHY_KEY, a key made for apps to carry). No key, no GIF button.

import { GIF_URL } from '../../domain/chat';
import type { GifPick } from './chatContext';

export const GIF_PAGE = 24;

export interface GifResult {
  id: string;
  title: string;
  preview: { url: string; width: number; height: number };
  send: GifPick;
}

/** Trending when there are no words, otherwise a search. Rated up to R: it's a club of adults. */
export function gifRequestUrl(key: string, query: string, offset: number): string {
  const words = query.trim();
  const url = new URL(`https://api.giphy.com/v1/gifs/${words ? 'search' : 'trending'}`);
  url.searchParams.set('api_key', key);
  if (words) url.searchParams.set('q', words);
  url.searchParams.set('limit', String(GIF_PAGE));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('rating', 'r');
  url.searchParams.set('bundle', 'messaging_non_clips');
  return url.toString();
}

interface Rendition {
  url?: string;
  width?: string | number;
  height?: string | number;
}

const size = (r: Rendition | undefined) =>
  r?.url && GIF_URL.test(r.url) ? { url: r.url, width: Number(r.width) || 0, height: Number(r.height) || 0 } : null;

export function parseGifs(json: unknown): GifResult[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((g: { id?: string; title?: string; images?: Record<string, Rendition> }) => {
    const images = g.images ?? {};
    const send = size(images.downsized) ?? size(images.original) ?? size(images.fixed_width);
    const preview = size(images.fixed_width_small) ?? size(images.fixed_width) ?? send;
    if (!g.id || !send || !preview) return [];
    return [{ id: g.id, title: g.title ?? '', preview, send: { kind: 'gif' as const, ...send } }];
  });
}

/** One page of GIFs. */
export async function searchGifs(key: string, query: string, offset = 0): Promise<GifResult[]> {
  const res = await fetch(gifRequestUrl(key, query, offset));
  if (res.status === 429) throw new Error('Too many GIF searches this hour. Try again soon.');
  if (!res.ok) throw new Error('GIFs aren’t answering. Try again.');
  return parseGifs(await res.json());
}
