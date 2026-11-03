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
  /** One request to one of `addresses` (the ones just checked, in connectOrder), redirects not
   *  followed, given up when `signal` fires. It must connect to those addresses, never look the
   *  name up again (ChatGPT audit F09). */
  get: (url: URL, addresses: string[], signal?: AbortSignal) => Promise<Response>;
}

/** IPv4 first (the Edge Functions' network reaches it most reliably), each family in the order given. */
export function connectOrder(addresses: string[]): string[] {
  const v4 = addresses.filter((a) => !a.includes(':'));
  return [...v4, ...addresses.filter((a) => a.includes(':'))];
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
 *  `get` connects to the addresses checked here, so a name can't answer public for the check and
 *  private for the fetch (ChatGPT audit F09). */
export async function fetchPreview(
  raw: string,
  deps: FetchDeps,
  signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS),
): Promise<LinkPreview | null> {
  let url = fetchableUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const addresses = IP_HOST.test(url.hostname) ? [url.hostname] : await beforeDeadline(deps.resolve(url.hostname), signal);
    if (!addresses.length || addresses.some(isPrivateAddress)) return null;
    const res = await beforeDeadline(deps.get(url, connectOrder(addresses), signal), signal);
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

// ---------------------------------------------------------------------------
// A small HTTP/1.1 client: the Edge Function opens the connection to a checked address itself, so it
// writes the request and reads the answer here. Only what a page preview needs: one GET, no
// compression, the connection closed after.

const USER_AGENT = 'RustnutsLinkPreview/1.0';
/** The status line and headers together may be this long at most. */
export const MAX_HEADER_BYTES = 32 * 1024;

/** The name the certificate must match: the host, without an IPv6 address's brackets. */
export function tlsName(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/** The request to send, with the real host name (the connection itself goes to a checked address). */
export function httpRequest(url: URL): string {
  return [
    `GET ${url.pathname || '/'}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    `User-Agent: ${USER_AGENT}`,
    'Accept: text/html,application/xhtml+xml',
    'Accept-Encoding: identity',
    'Connection: close',
    '',
    '',
  ].join('\r\n');
}

/** Bytes from a stream, read as asked: up to a marker, a set number, or whatever comes next. */
class Bytes {
  private buf = new Uint8Array(0);
  private done = false;
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async more(): Promise<boolean> {
    if (this.done) return false;
    const { done, value } = await this.reader.read();
    if (done || !value) {
      this.done = true;
      return false;
    }
    const next = new Uint8Array(this.buf.length + value.length);
    next.set(this.buf);
    next.set(value, this.buf.length);
    this.buf = next;
    return true;
  }

  private take(n: number): Uint8Array {
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  /** Everything up to `marker` (which is dropped), or null when the stream ends or `max` is passed first. */
  async until(marker: string, max: number): Promise<Uint8Array | null> {
    const m = new TextEncoder().encode(marker);
    for (let from = 0; ; ) {
      for (let i = from; i + m.length <= this.buf.length; i++) {
        let hit = true;
        for (let j = 0; j < m.length && hit; j++) hit = this.buf[i + j] === m[j];
        if (hit) {
          const out = this.take(i);
          this.take(m.length);
          return out;
        }
      }
      from = Math.max(0, this.buf.length - m.length + 1);
      if (this.buf.length > max) throw new Error('Headers too long');
      if (!(await this.more())) return null;
    }
  }

  /** Exactly `n` bytes, or fewer if the stream ends. */
  async exactly(n: number): Promise<Uint8Array> {
    while (this.buf.length < n && (await this.more()));
    return this.take(Math.min(n, this.buf.length));
  }

  /** Whatever is next (what's buffered, else the next read), empty at the end. */
  async next(): Promise<Uint8Array> {
    if (!this.buf.length) await this.more();
    return this.take(this.buf.length);
  }

  cancel() {
    return this.reader.cancel().catch(() => undefined);
  }
}

/** Reads one HTTP/1.x answer off a connection into a Response (body by length, chunked, or until close). */
export async function readHttpResponse(source: ReadableStream<Uint8Array>): Promise<Response> {
  const bytes = new Bytes(source.getReader());
  let status = 0;
  let lines: string[] = [];
  // 1xx answers (103 Early Hints and the like) come before the real one: skip them.
  for (let heads = 0; heads < 5 && (status === 0 || (status >= 100 && status < 200)); heads++) {
    const head = await bytes.until('\r\n\r\n', MAX_HEADER_BYTES);
    if (!head) {
      await bytes.cancel();
      throw new Error('The answer ended early');
    }
    const [statusLine, ...rest] = new TextDecoder().decode(head).split('\r\n');
    const m = statusLine.match(/^HTTP\/1\.[01] (\d{3})(?: .*)?$/);
    status = m ? Number(m[1]) : -1;
    lines = rest;
  }
  if (status < 200 || status > 599) {
    await bytes.cancel();
    throw new Error('Not an HTTP answer');
  }
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const encoding = (headers.get('content-encoding') ?? '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') {
    // Asked for none; a compressed page would read as nonsense and be kept as "no preview".
    await bytes.cancel();
    throw new Error('A compressed answer');
  }
  if (status === 204 || status === 304) {
    await bytes.cancel();
    return new Response(null, { status, headers });
  }

  const chunked = /\bchunked\b/i.test(headers.get('transfer-encoding') ?? '');
  const lengthHeader = headers.get('content-length');
  let left = !chunked && lengthHeader !== null && /^\d+$/.test(lengthHeader.trim()) ? Number(lengthHeader) : Infinity;
  let chunkLeft = 0;
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        if (finished) return c.close();
        if (chunked) {
          if (chunkLeft === 0) {
            const sizeLine = await bytes.until('\r\n', 1024);
            const sizeText = sizeLine ? new TextDecoder().decode(sizeLine).split(';')[0].trim() : '';
            if (!/^[0-9a-f]{1,12}$/i.test(sizeText)) throw new Error('A bad chunk');
            const size = parseInt(sizeText, 16);
            if (size === 0) {
              finished = true;
              await bytes.cancel();
              return c.close();
            }
            chunkLeft = size;
          }
          // A piece at a time, however big the chunk says it is, so the reader's cap holds.
          const part = await bytes.exactly(Math.min(chunkLeft, 64 * 1024));
          if (!part.length) {
            finished = true;
            return c.close();
          }
          chunkLeft -= part.length;
          if (chunkLeft === 0) {
            const end = await bytes.exactly(2);
            if (end.length !== 2 || end[0] !== 13 || end[1] !== 10) throw new Error('A bad chunk');
          }
          return c.enqueue(part);
        }
        if (left <= 0) {
          finished = true;
          await bytes.cancel();
          return c.close();
        }
        const part = left === Infinity ? await bytes.next() : await bytes.exactly(Math.min(left, 64 * 1024));
        if (!part.length) {
          finished = true;
          return c.close();
        }
        left -= part.length;
        c.enqueue(part);
      } catch (e) {
        c.error(e);
      }
    },
    cancel() {
      return bytes.cancel();
    },
  });
  return new Response(body, { status, headers });
}
