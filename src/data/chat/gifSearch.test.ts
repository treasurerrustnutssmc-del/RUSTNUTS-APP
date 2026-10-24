import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gifRequestUrl, parseGifs } from './gifSearch';

test('an empty search shows what’s trending; a search asks for those words', () => {
  const trending = new URL(gifRequestUrl('KEY', '  ', 0));
  assert.equal(trending.origin + trending.pathname, 'https://api.giphy.com/v1/gifs/trending');
  assert.equal(trending.searchParams.get('api_key'), 'KEY');
  const search = new URL(gifRequestUrl('KEY', 'send it', 24));
  assert.equal(search.pathname, '/v1/gifs/search');
  assert.equal(search.searchParams.get('q'), 'send it');
  assert.equal(search.searchParams.get('offset'), '24');
  assert.equal(search.searchParams.get('limit'), '24');
  assert.equal(search.searchParams.get('rating'), 'r');
});

test('results become a small preview and the GIF that gets sent', () => {
  const gifs = parseGifs({
    data: [
      {
        id: 'abc', title: 'Burnout GIF',
        images: {
          fixed_width_small: { url: 'https://media1.giphy.com/media/abc/100w.gif?cid=x&rid=100w.gif&ct=g', width: '100', height: '75' },
          downsized: { url: 'https://media1.giphy.com/media/abc/giphy-downsized.gif?cid=x&rid=giphy-downsized.gif&ct=g', width: '400', height: '300' },
          original: { url: 'https://media1.giphy.com/media/abc/giphy.gif?cid=x&rid=giphy.gif&ct=g', width: '480', height: '360' },
        },
      },
      { id: 'odd', title: 'Somewhere else', images: { downsized: { url: 'https://evil.example/x.gif', width: '1', height: '1' } } },
      { id: 'bare', title: 'No sizes', images: { original: { url: 'https://i.giphy.com/bare.gif', width: '200', height: '100' } } },
    ],
  });
  assert.deepEqual(gifs.map((g) => g.id), ['abc', 'bare'], 'only GIPHY’s own addresses');
  assert.deepEqual(gifs[0].send, { kind: 'gif', url: 'https://media1.giphy.com/media/abc/giphy-downsized.gif?cid=x&rid=giphy-downsized.gif&ct=g', width: 400, height: 300 });
  assert.equal(gifs[0].preview.width, 100);
  assert.equal(gifs[1].preview.url, 'https://i.giphy.com/bare.gif', 'falls back to what there is');
  assert.deepEqual(parseGifs({}), []);
  assert.deepEqual(parseGifs(null), []);
});
