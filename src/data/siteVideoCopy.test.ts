import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyVideos, R2_CAP_BYTES, type VideoJob } from '../../supabase/functions/_shared/siteVideoCopy';

function deps(jobs: VideoJob[], used = 0) {
  const log: string[] = [];
  const stored = new Map<string, number>();
  return {
    log,
    stored,
    d: {
      jobs: async () => jobs,
      download: async (path: string) => {
        log.push(`get ${path}`);
        if (path.includes('missing')) throw new Error('not found');
        return new Uint8Array(path.endsWith('.mp4') ? 1000 : 10);
      },
      used: async () => used,
      put: async (key: string, bytes: Uint8Array, type: string) => {
        log.push(`put ${key} ${type}`);
        stored.set(key, bytes.length);
      },
      remove: async (key: string) => {
        log.push(`del ${key}`);
      },
      done: async (id: string, video: string, poster: string | null) => {
        log.push(`done ${id} ${video} ${poster}`);
      },
      cleared: async (id: string) => {
        log.push(`cleared ${id}`);
      },
      base: 'https://media.example.workers.dev',
    },
  };
}

test('copies a live video and its still, then records the addresses', async () => {
  const { d, log } = deps([{ id: 'a1', action: 'copy', path: 'gallery/m/v.mp4', poster_path: 'gallery/m/v.jpg', video_url: null }]);
  const r = await copyVideos(d);
  assert.deepEqual(r, { copied: 1, cleared: 0, skipped: 0, failed: 0 });
  assert.deepEqual(log, [
    'get gallery/m/v.mp4', 'put v/a1.mp4 video/mp4', 'get gallery/m/v.jpg', 'put v/a1.jpg image/jpeg',
    'done a1 https://media.example.workers.dev/v/a1.mp4 https://media.example.workers.dev/v/a1.jpg',
  ]);
});

test('a .mov keeps its type; a video with no still is copied without one', async () => {
  const { d, log } = deps([{ id: 'b', action: 'copy', path: 'gallery/m/v.mov', poster_path: null, video_url: null }]);
  await copyVideos(d);
  assert.ok(log.includes('put v/b.mov video/quicktime'));
  assert.ok(log.includes('done b https://media.example.workers.dev/v/b.mov null'));
});

test('a taken-down video is deleted from Cloudflare and its addresses cleared', async () => {
  const { d, log } = deps([{ id: 'c', action: 'clear', path: 'gallery/m/v.mp4', poster_path: null, video_url: 'https://media.example.workers.dev/v/c.mp4' }]);
  const r = await copyVideos(d);
  assert.equal(r.cleared, 1);
  assert.deepEqual(log, ['del v/c.mp4', 'del v/c.jpg', 'cleared c']);
});

test('never goes over the cap: a copy that would cross it waits', async () => {
  const { d, log } = deps([{ id: 'd', action: 'copy', path: 'gallery/m/v.mp4', poster_path: null, video_url: null }], R2_CAP_BYTES - 500);
  const r = await copyVideos(d);
  assert.deepEqual(r, { copied: 0, cleared: 0, skipped: 1, failed: 0 });
  assert.ok(!log.some((l) => l.startsWith('put')));
});

test('one that fails doesn’t stop the rest', async () => {
  const { d } = deps([
    { id: 'e', action: 'copy', path: 'gallery/m/missing.mp4', poster_path: null, video_url: null },
    { id: 'f', action: 'copy', path: 'gallery/m/ok.mp4', poster_path: null, video_url: null },
  ]);
  const r = await copyVideos(d);
  assert.deepEqual(r, { copied: 1, cleared: 0, skipped: 0, failed: 1 });
});
