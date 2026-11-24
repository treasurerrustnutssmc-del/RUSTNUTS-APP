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
  done: (id: string, videoUrl: string, posterUrl: string | null) => Promise<void>;
  cleared: (id: string) => Promise<void>;
  /** Where the Worker serves R2 from, no trailing slash. */
  base: string;
}

const isMov = (path: string) => /\.mov$/i.test(path);
const videoKey = (job: VideoJob) => `v/${job.id}.${isMov(job.path) ? 'mov' : 'mp4'}`;
const stillKey = (job: VideoJob) => `v/${job.id}.jpg`;

export async function copyVideos(deps: VideoCopyDeps) {
  const result = { copied: 0, cleared: 0, skipped: 0, failed: 0 };
  let used = await deps.used();
  for (const job of await deps.jobs()) {
    try {
      if (job.action === 'clear') {
        await deps.remove(videoKey(job));
        await deps.remove(stillKey(job));
        await deps.cleared(job.id);
        result.cleared++;
        continue;
      }
      const video = await deps.download(job.path);
      if (used + video.length > R2_CAP_BYTES) {
        result.skipped++;
        continue;
      }
      await deps.put(videoKey(job), video, isMov(job.path) ? 'video/quicktime' : 'video/mp4');
      used += video.length;
      let posterUrl: string | null = null;
      if (job.poster_path) {
        const still = await deps.download(job.poster_path);
        await deps.put(stillKey(job), still, 'image/jpeg');
        used += still.length;
        posterUrl = `${deps.base}/${stillKey(job)}`;
      }
      await deps.done(job.id, `${deps.base}/${videoKey(job)}`, posterUrl);
      result.copied++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
