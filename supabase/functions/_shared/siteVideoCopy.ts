// site-video-copy: puts website videos on the club's Cloudflare R2 storage, which costs nothing to
// watch (Jeff's tap, 22 Nov 2026: "Yes, kept on Cloudflare"). The database lists the jobs: a live
// website video with no Cloudflare address yet is copied (file and still), and a taken-down one that
// still has one is deleted there. R2 is free up to 10 GB; this never fills past R2_CAP_BYTES, so it
// can't bill. Spec: docs/superpowers/specs/2026-11-23-club-gallery-design.md. Tested in
// src/data/siteVideoCopy.test.ts.

/** 9 GB: a gigabyte short of R2's free 10 GB. */
export const R2_CAP_BYTES = 9 * 1024 ** 3;

export interface VideoJob {
  /** The site_photos row. */
  id: string;
  action: 'copy' | 'clear';
  /** In the chat-media bucket. */
  path: string;
  poster_path: string | null;
  video_url: string | null;
}

export interface VideoCopyDeps {
  jobs: () => Promise<VideoJob[]>;
  /** A file from the app's chat-media bucket. */
  download: (path: string) => Promise<Uint8Array>;
  /** Bytes already on R2. */
  used: () => Promise<number>;
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  /** False when the video came down mid-copy (then what was put is deleted again). */
  done: (id: string, videoUrl: string, posterUrl: string | null) => Promise<boolean>;
  cleared: (id: string) => Promise<void>;
  /** Counts a failed copy; after three the database stops offering it. */
  failed: (id: string) => Promise<void>;
  /** Where the Worker serves R2 from, no trailing slash. */
  base: string;
}

const isMov = (path: string) => /\.mov$/i.test(path);
const videoKey = (job: VideoJob) => `v/${job.id}.${isMov(job.path) ? 'mov' : 'mp4'}`;
const stillKey = (job: VideoJob) => `v/${job.id}.jpg`;

async function removeBoth(deps: VideoCopyDeps, job: VideoJob) {
  await deps.remove(videoKey(job));
  await deps.remove(stillKey(job));
}

export async function copyVideos(deps: VideoCopyDeps) {
  const result = { copied: 0, cleared: 0, skipped: 0, failed: 0 };
  const jobs = await deps.jobs();
  // Clears first: a taken-down video comes off even if the copies can't run.
  for (const job of jobs.filter((j) => j.action === 'clear')) {
    try {
      await removeBoth(deps, job);
      await deps.cleared(job.id);
      result.cleared++;
    } catch {
      result.failed++;
    }
  }
  const copies = jobs.filter((j) => j.action === 'copy');
  let used: number;
  try {
    used = await deps.used();
  } catch {
    // Without knowing the space, copy nothing (never risk the bill); they're offered again next time.
    result.skipped += copies.length;
    return result;
  }
  for (const job of copies) {
    try {
      const video = await deps.download(job.path);
      const still = job.poster_path ? await deps.download(job.poster_path) : null;
      if (used + video.length + (still?.length ?? 0) > R2_CAP_BYTES) {
        result.skipped++;
        continue;
      }
      await deps.put(videoKey(job), video, isMov(job.path) ? 'video/quicktime' : 'video/mp4');
      used += video.length;
      if (still) {
        await deps.put(stillKey(job), still, 'image/jpeg');
        used += still.length;
      }
      const took = await deps.done(job.id, `${deps.base}/${videoKey(job)}`, still ? `${deps.base}/${stillKey(job)}` : null);
      if (took) {
        result.copied++;
      } else {
        await removeBoth(deps, job);
        used -= video.length + (still?.length ?? 0);
        result.cleared++;
      }
    } catch {
      result.failed++;
      await deps.failed(job.id).catch(() => undefined);
    }
  }
  return result;
}
