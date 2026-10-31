// The purge-files function's logic, kept free of Deno and Supabase so it can be tested with node:test
// (src/data/purgeFiles.test.ts). One run: take what the database queued when members deleted their
// accounts, delete it from Storage a bucket and up to 100 paths at a time, then tell the database
// what went and what didn't, until the queue is empty or the run has done enough.

export interface QueuedFile {
  id: number;
  bucket: string;
  path: string;
}

export interface FailedFile {
  id: number;
  error: string;
}

export interface PurgeDeps {
  /** Up to `limit` queued files, marked taken by the database. */
  take: (limit: number) => Promise<QueuedFile[]>;
  /** Deletes the paths from the bucket. A path Storage no longer has is not an error. Throws when the call fails. */
  remove: (bucket: string, paths: string[]) => Promise<void>;
  /** What's gone, and what to try again with why. */
  done: (done: number[], failed: FailedFile[]) => Promise<void>;
}

export interface PurgeResult {
  rounds: number;
  removed: number;
  failed: number;
}

/** Storage deletes at most this many paths in one call. */
export const BATCH = 100;
/** Files taken from the queue per round. */
export const TAKE = 500;
/** Rounds per run, so a huge queue drains over a few runs instead of one long one. */
export const MAX_ROUNDS = 20;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function byBucket(files: QueuedFile[]): Map<string, QueuedFile[]> {
  const out = new Map<string, QueuedFile[]>();
  for (const f of files) {
    const list = out.get(f.bucket) ?? [];
    list.push(f);
    out.set(f.bucket, list);
  }
  return out;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function purgeAll(deps: PurgeDeps): Promise<PurgeResult> {
  const result: PurgeResult = { rounds: 0, removed: 0, failed: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const files = await deps.take(TAKE);
    if (files.length === 0) break;
    result.rounds++;
    const done: number[] = [];
    const failed: FailedFile[] = [];
    for (const [bucket, list] of byBucket(files)) {
      for (const batch of chunk(list, BATCH)) {
        try {
          await deps.remove(bucket, batch.map((f) => f.path));
          done.push(...batch.map((f) => f.id));
        } catch (e) {
          const error = errorText(e);
          failed.push(...batch.map((f) => ({ id: f.id, error })));
        }
      }
    }
    await deps.done(done, failed);
    result.removed += done.length;
    result.failed += failed.length;
    // Everything taken failed: Storage is down, so stop rather than burn the attempts in one run.
    if (done.length === 0) break;
  }
  return result;
}
