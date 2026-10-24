import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchableUrl, fetchPreview, isPrivateAddress, parsePreview } from '../../supabase/functions/_shared/linkPreview';

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
    get: (_u: URL, signal?: AbortSignal) =>
      new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('timed out')))),
  };
  await assert.rejects(fetchPreview('https://slow.example/', slowHops, soon()), /time/i);
});
