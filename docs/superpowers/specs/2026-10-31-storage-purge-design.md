# Storage purge on account deletion: design

31/10/2026. Architectural (a new queue table, a new Edge Function, a cron job). From the deep audit's finding F1. Claude approves its own specs since 24 Oct; Jeff can veto.

## Why

The privacy policy says that deleting your account "clears your photo files". `private.forget_member` deletes the rows (messages and their media rows, listings, build updates, nominations) but nothing removes the files themselves from Storage. They become unreachable, because no row points at them and every read policy goes through a row, but they still exist in the buckets. Supabase blocks a plain `delete from storage.objects` (its `protect_objects_delete` trigger), and that wouldn't remove the stored bytes anyway: files go through the Storage API, which the database can't call. So the database queues the paths and a small Edge Function with the service key deletes them.

## What the member sees

Nothing new. Delete my account works as before. Their files are gone within about ten minutes, usually sooner. The privacy policy's sentence becomes true as written.

## What is purged

Every file the member uploaded (`storage.objects.owner_id`, which Storage sets to the uploader's sign-in) in the four personal buckets: `chat-media` (photos, videos, posters, voice notes), `swap-media`, `build-media` and `brag-media`. Not `sponsor-logos`: those are club assets a board member happened to upload.

One exception, matching what `forget_member` already does with messages: a file still attached to a message someone has reported stays, with the message, for the board to deal with. The report's resolution removes the message, and the file stays unreachable but kept until then. (`forget_member` deletes the member's listings, build updates and nominations outright, so no other row survives to hold a file.) The queue is filled after the row deletions, from the files no surviving row still names.

## How it works

Database (migration `20270620000000_storage_purge.sql`):

- `private.storage_purge`: `id`, `bucket`, `path`, `member_id`, `queued_at`, `taken_at`, `done_at`, `attempts`, `error`. RLS on, every grant revoked; only the two functions below touch it.
- `private.forget_member` gains one insert at the end: the member's objects in the four buckets that no `message_media`, `listings.photos`, `build_updates.photos` or `brag_nominations.photo` row still names.
- `public.purge_take(p_limit int) returns jsonb`, service role only: rows taken more than ten minutes ago and not finished go back to the queue; then up to `p_limit` rows not yet taken and under five attempts are marked taken (`for update skip locked`, so two runs can't collide) and returned as `[{id, bucket, path}]`.
- `public.purge_done(p_done bigint[], p_failed jsonb)`, service role only: marks the finished rows done and puts the failed ones back with their error. A file Storage no longer has counts as done.
- `private.purge_url()` reads `private.app_settings` `purge_url`; a pg_cron job `purge-files` posts to it every ten minutes where pg_cron and pg_net exist. Until an admin sets `purge_url` nothing runs. A daily job `storage-purge-cleanup` deletes done rows after 90 days.

Edge Function `purge-files` (verify JWT off, like send-push: a call can only delete what the database has queued):

- `_shared/purgeFiles.ts` holds the logic, free of Deno so `src/data/purgeFiles.test.ts` tests it with node:test: take a batch, group by bucket, remove up to 100 paths per call, report done and failed, repeat until the queue is empty or twenty rounds have run. A "not found" answer from Storage counts as done.
- `purge-files/index.ts` wires it to the service-role client and `storage.from(bucket).remove(paths)`.
- If the function's `CRON_SECRET` secret is set, a call must carry it in an `x-cron-secret` header; unset, any call is accepted (the audit's F6, which can be switched on later for all three cron-called functions without a redeploy here).

Going live (Jeff's Run and Deploy buttons, queued in `build/paste-queue.md`): the migration; then the function from a one-file paste; then `purge_url` in `private.app_settings`.

## Testing

- `supabase/tests/storage_purge_test.sql` (run by `npm run test:db`): a member with six files of their own (one on a message the Secretary reported, one never used by any row) plus a sponsor logo they uploaded, and another member's photo, deletes their account; the queue holds five (not the reported message's photo, the logo or the other member's file); `purge_take` hands them out once and marks them taken; `purge_done` marks four done and sends one back with its error, which is retried, goes back after a stale take and stops after five attempts; a signed-in member can't call either function.
- `src/data/purgeFiles.test.ts`: batching by bucket, not-found as done, a failed call reported with the error, the loop stopping on an empty take.

## Not in this change

- Files uploaded before this goes live by members who have already deleted their accounts: none exist (the live buckets hold only the four sponsor logos today).
- Removing the files of a message a board removes after a report: those paths stay unreachable, as now.
