// The club's website videos, served from Cloudflare R2 (bound as MEDIA). Free to watch: R2 charges
// nothing for downloads, and Workers are free to 100,000 requests a day. Read-only: only the
// site-video-copy function (with R2 keys) puts and deletes files. Paste into a Worker in the club's
// Cloudflare account and bind the R2 bucket as MEDIA. Spec: docs/superpowers/specs/2026-11-23-club-gallery-design.md
export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not allowed', { status: 405 });
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (!/^v\/[0-9a-f-]{36}\.(mp4|mov|jpg)$/.test(key)) return new Response('Not found', { status: 404 });
    // Videos play from any point: the browser asks for byte ranges.
    const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
    if (object === null) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'public, max-age=86400');
    if (url.searchParams.get('download') === '1') {
      headers.set('content-disposition', `attachment; filename="rustnuts-${key.slice(2, 10)}.${key.split('.').pop()}"`);
    }
    if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
    let status = 200;
    if (object.range && request.headers.has('range')) {
      const { offset = 0, length = object.size - offset } = object.range;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('content-length', String(length));
      status = 206;
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
  },
};
