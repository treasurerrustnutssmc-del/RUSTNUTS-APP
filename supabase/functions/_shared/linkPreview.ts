// Link previews, without the network (it's passed in), so `npm test` runs exactly what the
// link-preview Edge Function runs. Only public web pages are fetched: never the server's own
// network, never anything but http(s) on the usual ports, never more than a small HTML page.

export interface LinkPreview {
  url: string;
  site: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

export const MAX_BYTES = 512 * 1024;
export const TIMEOUT_MS = 5_000;
export const MAX_REDIRECTS = 3;

/** True for addresses inside a private, local or reserved range (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!v6.includes(':')) return true; // not an address we understand: refuse
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return (
    v6 === '::' || v6 === '::1' ||
    /^f[cd]/.test(v6) || // unique local
    /^fe[89ab]/.test(v6) || // link local
    /^ff/.test(v6) || // multicast
    v6.startsWith('64:ff9b:') || v6.startsWith('2001:db8')
  );
}

const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/** The address to fetch, or null when it isn't a public http(s) page we're willing to try. */
export function fetchableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp)$/.test(host) || host === 'localhost') return null;
  if (IP_HOST.test(host) && isPrivateAddress(host)) return null;
  url.hash = '';
  return url;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string | null, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The page's Open Graph tags (or its title and description), as a preview. Null when there's nothing to show. */
export function parsePreview(html: string, pageUrl: string): LinkPreview | null {
  const head = html.slice(0, MAX_BYTES);
  const metas = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const key = attr('property') ?? attr('name');
    const content = attr('content');
    if (!key || !content) continue;
    const k = (key[2] ?? key[3] ?? key[4]).toLowerCase();
    if (!metas.has(k)) metas.set(k, decode(content[2] ?? content[3] ?? content[4]));
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = metas.get('og:title') ?? metas.get('twitter:title') ?? (titleTag ? decode(titleTag[1]) : null);
  const description = metas.get('og:description') ?? metas.get('twitter:description') ?? metas.get('description') ?? null;
  let image: string | null = null;
  const rawImage = metas.get('og:image') ?? metas.get('og:image:url') ?? metas.get('twitter:image');
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      image = resolved.protocol === 'https:' ? resolved.toString() : null;
    } catch {
      image = null;
    }
  }
  if (!title && !description && !image) return null;
  const site = metas.get('og:site_name') ?? new URL(pageUrl).hostname.replace(/^www\./, '');
  return { url: pageUrl, site: clip(site, 80)!, title: clip(title || null, 200), description: clip(description || null, 300), image };
}

export interface FetchDeps {
  /** Every address the host name points to. */
  resolve: (host: string) => Promise<string[]>;
  /** One request, redirects not followed, given up when `signal` fires. */
  get: (url: URL, signal?: AbortSignal) => Promise<Response>;
}

/** Waits for `work`, or fails as soon as `signal` fires. */
function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Out of time'));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error('Out of time'));
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** Fetches a page's preview, checking every hop is a public address. Null when there's nothing to
 *  show; it throws when it couldn't find out (no connection, or `signal`'s one time limit for the
 *  name lookups, every hop and the reading ran out), so that isn't kept as an answer.
 *
 *  What's left: the lookup here and the one `get` makes can differ (a name that answers public, then
 *  private). The Edge Function runs outside the club's database network and reads only the start of
 *  HTML pages, so the most such a trick gets is a page's title on a member's chat card. */
export async function fetchPreview(
  raw: string,
  deps: FetchDeps,
  signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS),
): Promise<LinkPreview | null> {
  let url = fetchableUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const addresses = IP_HOST.test(url.hostname) ? [url.hostname] : await beforeDeadline(deps.resolve(url.hostname), signal);
    if (!addresses.length || addresses.some(isPrivateAddress)) return null;
    const res = await beforeDeadline(deps.get(url, signal), signal);
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      url = next ? fetchableUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel();
      return null;
    }
    return parsePreview(await beforeDeadline(readCapped(res), signal), url.toString());
  }
  return null;
}

/** The start of a page, at most MAX_BYTES of it. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel();
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, all.length - at);
    all.set(part, at);
    at += part.length;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}
