import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCH, MAX_ROUNDS, TAKE, byBucket, chunk, purgeAll, type FailedFile, type QueuedFile } from '../../supabase/functions/_shared/purgeFiles';

const file = (id: number, bucket = 'chat-media'): QueuedFile => ({ id, bucket, path: `${bucket}/${id}.jpg` });

function harness(queue: QueuedFile[][], failBuckets: string[] = []) {
  const removed: [string, string[]][] = [];
  const reported: [number[], FailedFile[]][] = [];
  let takes = 0;
  const deps = {
    take: async (limit: number) => {
      assert.equal(limit, TAKE);
      takes++;
      return queue.shift() ?? [];
    },
    remove: async (bucket: string, paths: string[]) => {
      if (failBuckets.includes(bucket)) throw new Error(`Storage answered 503 for ${bucket}`);
      removed.push([bucket, paths]);
    },
    done: async (done: number[], failed: FailedFile[]) => {
      reported.push([done, failed]);
    },
  };
  return { deps, removed, reported, takes: () => takes };
}

test('files are deleted a bucket at a time, up to 100 paths per call, and every id is reported done', async () => {
  const files = [file(1), file(2, 'swap-media'), file(3), ...Array.from({ length: 150 }, (_, i) => file(10 + i, 'build-media'))];
  const h = harness([files]);
  const result = await purgeAll(h.deps);
  assert.deepEqual(result, { rounds: 1, removed: 153, failed: 0 });
  assert.deepEqual(h.removed.map(([b, p]) => [b, p.length]), [['chat-media', 2], ['swap-media', 1], ['build-media', 100], ['build-media', 50]]);
  assert.deepEqual(h.removed[0][1], ['chat-media/1.jpg', 'chat-media/3.jpg']);
  assert.equal(h.reported.length, 1);
  assert.deepEqual(h.reported[0][0].slice(0, 3), [1, 3, 2]);
  assert.equal(h.reported[0][0].length, 153);
  assert.deepEqual(h.reported[0][1], []);
  assert.equal(h.takes(), 2, 'a second take finds the queue empty and the run stops');
});

test('a failed Storage call sends that batch back with its error and the rest still goes', async () => {
  const h = harness([[file(1), file(2, 'swap-media'), file(3, 'swap-media')]], ['swap-media']);
  const result = await purgeAll(h.deps);
  assert.deepEqual(result, { rounds: 1, removed: 1, failed: 2 });
  assert.deepEqual(h.reported[0], [[1], [
    { id: 2, error: 'Storage answered 503 for swap-media' },
    { id: 3, error: 'Storage answered 503 for swap-media' },
  ]]);
});

test('when nothing at all could be deleted the run stops instead of burning every attempt', async () => {
  const h = harness([[file(1)], [file(2)], [file(3)]], ['chat-media']);
  const result = await purgeAll(h.deps);
  assert.deepEqual(result, { rounds: 1, removed: 0, failed: 1 });
  assert.equal(h.takes(), 1);
});

test('a long queue drains over several rounds, at most MAX_ROUNDS in one run', async () => {
  const rounds = Array.from({ length: MAX_ROUNDS + 3 }, (_, r) => [file(r + 1)]);
  const h = harness(rounds);
  const result = await purgeAll(h.deps);
  assert.deepEqual(result, { rounds: MAX_ROUNDS, removed: MAX_ROUNDS, failed: 0 });
  assert.equal(h.takes(), MAX_ROUNDS);
});

test('an empty queue is a no-op', async () => {
  const h = harness([]);
  assert.deepEqual(await purgeAll(h.deps), { rounds: 0, removed: 0, failed: 0 });
  assert.deepEqual(h.reported, []);
});

test('helpers: chunking keeps order, grouping keeps first-seen bucket order', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.equal(BATCH, 100);
  const grouped = byBucket([file(1, 'b'), file(2, 'a'), file(3, 'b')]);
  assert.deepEqual([...grouped.keys()], ['b', 'a']);
  assert.deepEqual(grouped.get('b')!.map((f) => f.id), [1, 3]);
});
