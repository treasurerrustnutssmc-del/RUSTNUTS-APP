import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectOrder, fetchableUrl, tlsName, fetchPreview, httpRequest, isPrivateAddress, parsePreview, readHttpResponse } from '../../supabase/functions/_shared/linkPreview';

test('private, local and reserved addresses are never fetched', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'nonsense']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['142.250.70.206', '1.1.1.1', '2606:4700::1111', '172.32.0.1']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('only public http(s) pages on the usual ports', () => {
  assert.equal(fetchableUrl('https://www.vicroads.vic.gov.au/registration#top')?.toString(), 'https://www.vicroads.vic.gov.au/registration');
  for (const bad of ['ftp://example.com/x', 'file:///etc/passwd', 'http://localhost/', 'http://printer.local/', 'https://user:pw@example.com/',
    'https://example.com:8443/', 'http://10.0.0.1/', 'http://[::1]/', 'javascript:alert(1)', 'not a url', 'http://intranet/']) {
    assert.equal(fetchableUrl(bad), null, bad);
  }
});

test('a preview from the Open Graph tags, falling back to the title and description', () => {
  const og = parsePreview(
    `<html><head><title>Ignored</title>
      <meta property="og:title" content="Christmas ride &amp; lunch">
      <meta property='og:description' content='Both chapters, Williams Landing.'>
      <meta property="og:image" content="/img/xmas.jpg">
      <meta property="og:site_name" content="Rustnuts SMC"></head></html>`,
    'https://example.com/rides/xmas',
  );
  assert.deepEqual(og, {
    url: 'https://example.com/rides/xmas', site: 'Rustnuts SMC', title: 'Christmas ride & lunch',
    description: 'Both chapters, Williams Landing.', image: 'https://example.com/img/xmas.jpg',
  });
  const plain = parsePreview('<title> Rego  check </title><meta name="description" content="Check a rego">', 'https://www.vicroads.vic.gov.au/x');
  assert.deepEqual(plain, { url: 'https://www.vicroads.vic.gov.au/x', site: 'vicroads.vic.gov.au', title: 'Rego check', description: 'Check a rego', image: null });
  assert.equal(parsePreview('<p>nothing here</p>', 'https://example.com/'), null);
  assert.equal(parsePreview('<meta property="og:image" content="http://example.com/a.jpg"><title>t</title>', 'https://example.com/')?.image, null, 'https pictures only');
  assert.equal(parsePreview(`<title>${'x'.repeat(500)}</title>`, 'https://example.com/')?.title?.length, 200);
});

const page = (body: string, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }, status = 200) =>
  new Response(body, { status, headers });

test('every hop is checked, redirects included, and only HTML is read', async () => {
  const fetched: string[] = [];
  const deps = (map: Record<string, Response>, dns: Record<string, string[]>) => ({
    resolve: async (host: string) => dns[host] ?? [],
    get: async (url: URL) => {
      fetched.push(url.toString());
      return map[url.toString()];
    },
  });
  const ok = await fetchPreview('https://a.example/', deps(
    { 'https://a.example/': page('', { location: '/b' }, 301), 'https://a.example/b': page('<title>B</title>') },
    { 'a.example': ['93.184.216.34'] },
  ));
  assert.equal(ok?.title, 'B');
  assert.equal(ok?.url, 'https://a.example/b');

  assert.equal(await fetchPreview('https://a.example/', deps(
    { 'https://a.example/': page('', { location: 'http://169.254.169.254/latest' }, 302) },
    { 'a.example': ['93.184.216.34'] },
  )), null, 'a redirect into the cloud’s own network');
  assert.equal(await fetchPreview('https://sneaky.example/', deps({}, { 'sneaky.example': ['93.184.216.34', '10.0.0.5'] })), null, 'a name that points inside');
  assert.equal(await fetchPreview('https://a.example/pic.jpg', deps(
    { 'https://a.example/pic.jpg': page('xx', { 'content-type': 'image/jpeg' }) }, { 'a.example': ['93.184.216.34'] },
  )), null, 'not a page');
  let hops = 0;
  const loop = { resolve: async () => ['93.184.216.34'], get: async () => { hops++; return page('', { location: '/again' }, 302); } };
  assert.equal(await fetchPreview('https://loop.example/', loop), null);
  assert.equal(hops, 4, 'gives up after three redirects');
});

test('one time limit covers the name lookups and every hop, and running out is not an answer', async () => {
  // Node's AbortSignal.timeout doesn't keep a test alive, so a plain timer stands in for it.
  const soon = () => {
    const c = new AbortController();
    setTimeout(() => c.abort(), 20);
    return c.signal;
  };
  const stuck = { resolve: () => new Promise<string[]>(() => undefined), get: async () => page('<title>A</title>') };
  await assert.rejects(fetchPreview('https://slow-dns.example/', stuck, soon()), /time/i);
  const slowHops = {
    resolve: async () => ['93.184.216.34'],
    get: (_u: URL, _a: string[], signal?: AbortSignal) =>
      new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('timed out')))),
  };
  await assert.rejects(fetchPreview('https://slow.example/', slowHops, soon()), /time/i);
});

// ChatGPT audit F09: the address that was checked is the one connected to.
test('the connection is made to the addresses that were checked, IPv4 first', async () => {
  const seen: string[][] = [];
  const deps = {
    resolve: async () => ['2606:4700::1111', '93.184.216.34'],
    get: async (_u: URL, addresses: string[]) => {
      seen.push(addresses);
      return page('<title>Pinned</title>');
    },
  };
  assert.equal((await fetchPreview('https://pinned.example/', deps))?.title, 'Pinned');
  assert.deepEqual(seen, [['93.184.216.34', '2606:4700::1111']]);
  assert.deepEqual(connectOrder(['2606:4700::1111', '1.1.1.1', '93.184.216.34']), ['1.1.1.1', '93.184.216.34', '2606:4700::1111']);
});

test('one plain HTTP/1.1 GET, with the real host name', () => {
  assert.equal(
    httpRequest(new URL('https://www.vicroads.vic.gov.au/registration?x=1')),
    'GET /registration?x=1 HTTP/1.1\r\nHost: www.vicroads.vic.gov.au\r\nUser-Agent: RustnutsLinkPreview/1.0\r\n' +
      'Accept: text/html,application/xhtml+xml\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n',
  );
  assert.match(httpRequest(new URL('http://example.com')), /^GET \/ HTTP\/1\.1\r\nHost: example\.com\r\n/);
});

const stream = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(new TextEncoder().encode(p));
      c.close();
    },
  });

test('the answer is read by length, in chunks, or until the site hangs up', async () => {
  const byLength = await readHttpResponse(stream('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhel', 'lo-extra'));
  assert.equal(byLength.status, 200);
  assert.equal(byLength.headers.get('content-type'), 'text/html');
  assert.equal(await byLength.text(), 'hello');

  const chunked = await readHttpResponse(stream('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n<tit\r\n', 'b;ext=1\r\nle>Chunked<\r\n0\r\n\r\n'));
  assert.equal(await chunked.text(), '<title>Chunked<');

  const toClose = await readHttpResponse(stream('HTTP/1.0 200 OK\r\n', 'Content-Type: text/html\r\n\r\n<title>A</title>', '<p>more'));
  assert.equal(await toClose.text(), '<title>A</title><p>more');

  const moved = await readHttpResponse(stream('HTTP/1.1 301 Moved Permanently\r\nLocation: /b\r\nContent-Length: 0\r\n\r\n'));
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), '/b');
});

test('a broken answer is an error, not a page', async () => {
  await assert.rejects(readHttpResponse(stream('SSH-2.0-OpenSSH\r\n\r\n')), /not an http answer/i);
  await assert.rejects(readHttpResponse(stream('HTTP/1.1 200 OK\r\nX: ' + 'y'.repeat(40_000))), /headers too long/i);
  await assert.rejects(readHttpResponse(stream('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n')), /ended early/i);
});

test('chunk sizes and line ends split across reads still parse, and a bad chunk is an error', async () => {
  const split = await readHttpResponse(stream('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n', '3', '\r', '\nabc', '\r', '\n2\r\nde\r\n0\r\n\r\n'));
  assert.equal(await split.text(), 'abcde');
  const negative = await readHttpResponse(stream('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n-5\r\nabc\r\n'));
  await assert.rejects(negative.text(), /bad chunk/i);
  const noCrlf = await readHttpResponse(stream('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabcXY4\r\n'));
  await assert.rejects(noCrlf.text(), /bad chunk/i);
});

test('a huge chunk is handed on a piece at a time, so the 512 KB cap still holds', async () => {
  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\nffffffffffff\r\n'));
    },
    pull(c) {
      sent += 16 * 1024;
      if (sent > 4 * 1024 * 1024) throw new Error('read far past the cap');
      c.enqueue(new Uint8Array(16 * 1024).fill(120));
    },
  });
  const res = await readHttpResponse(endless);
  const deps = { resolve: async () => ['93.184.216.34'], get: async () => res };
  assert.equal(await fetchPreview('https://big.example/', deps), null);
  assert.ok(sent < 1024 * 1024, `read ${sent} bytes`);
});

test('an early hint is skipped, and a compressed answer is refused rather than read as a page', async () => {
  const hinted = await readHttpResponse(stream('HTTP/1.1 103 Early Hints\r\nLink: </a.css>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'));
  assert.equal(hinted.status, 200);
  assert.equal(await hinted.text(), 'ok');
  await assert.rejects(readHttpResponse(stream('HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 2\r\n\r\nxx')), /compressed/i);
});

test('the TLS name for an IPv6 address has no brackets', () => {
  assert.equal(tlsName(new URL('https://[2606:4700::1111]/')), '2606:4700::1111');
  assert.equal(tlsName(new URL('https://www.example.com/')), 'www.example.com');
});
