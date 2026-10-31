# Storage purge on account deletion: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a member deletes their account, the files they uploaded leave Storage too, so the privacy
policy's "clears your photo files" is true as written (deep audit finding F1).

**Architecture:** The database can't delete Storage bytes (the Storage API does, and Supabase blocks a
plain delete on `storage.objects`), so `private.forget_member` queues the member's paths in
`private.storage_purge` and a small `purge-files` Edge Function with the service key takes the queue
every ten minutes, deletes the files and reports back. Files on a reported message stay with the
message; `sponsor-logos` are club assets and are never queued.

**Tech Stack:** Supabase Postgres (pg_cron, pg_net) and Edge Functions (Deno); the function's logic in a
Deno-free `_shared` module tested with node:test; SQL tests via `npm run test:db`.

**Spec:** `docs/superpowers/specs/2026-10-31-storage-purge-design.md`

Written alongside the build on 31/10/2026 (the deep audit's repair lane), ticked as each task passed.

## Global Constraints

- Buckets purged: `chat-media`, `swap-media`, `build-media`, `brag-media`. Never `sponsor-logos`.
- A file still named by `message_media` (a reported message survives `forget_member`), `listings.photos`,
  `build_updates.photos` or `brag_nominations.photo` is not queued.
- `purge_take` and `purge_done` run for `service_role` only. A row taken more than ten minutes ago and not
  finished goes back; five attempts and a row is left alone (its error kept).
- Up to 100 paths per Storage call, up to 20 rounds per run; a path Storage no longer has counts as done.
- Nothing runs until `private.app_settings` `purge_url` is set. With the `CRON_SECRET` secret set, a call
  must carry it in `x-cron-secret`; unset, any call is accepted (F6 builds on this).
- The migration contains deletes inside functions and a cleanup job, so the live paste shows Supabase's
  "Potential issue detected" warning; it deletes no rows when pasted.

## Review Focus

- A file on a reported message is kept while the plain message's files go (`storage_purge_test.sql`,
  `keep.jpg` vs `gone.jpg`).
- Another member's file and a sponsor logo the leaver uploaded are not queued (same test).
- A taken row isn't handed out again (`taken rows are not handed out twice`). The row lock itself
  (`for update skip locked`, two runs at once) isn't exercised by a single-session test.
- A failed Storage call sends only that batch back with its error, the rest still goes
  (`purgeFiles.test.ts`).
- Members can't call `purge_take` or `purge_done` (same SQL test, `authenticated` role).

---

### Task 1: Queue table, forget_member change and the two service calls

**Files:**
- Create: `supabase/migrations/20270620000000_storage_purge.sql`
- Create: `supabase/tests/storage_purge_test.sql`
- Modify: `scripts/test-db.sh` (a fresh-database run of the new test, before the final echo)

- [x] **Step 1: Write the failing SQL test**: a West member with five files of their own in `chat-media`
  and `swap-media` (one on a message the Secretary reported, one never used by any row), a sponsor logo
  they uploaded and another member's photo; deleting their `auth.users` row queues exactly the four
  reachable-no-more files plus the orphan; `purge_take(10)` hands out five rows once; `purge_done`
  marks four done and one failed with its error; the failed row is retried, a stale take goes back,
  five attempts stop it; `authenticated` can't call either function; `private.purge_url()` is null.
- [x] **Step 2: Run** the test on a fresh copy of the schema — Expected: FAIL (relation does not exist).
- [x] **Step 3: Write the migration**: `private.storage_purge` (RLS on, all grants revoked, partial index
  on the untaken rows); `private.forget_member` recreated from `20270580000000` with the insert from
  `storage.objects` by `owner_id` after the row deletions; `public.purge_take(int) returns jsonb` and
  `public.purge_done(bigint[], jsonb)` (security definer, `search_path = ''`, service_role only);
  `private.purge_url()`; cron jobs `purge-files` (`*/10 * * * *`) and `storage-purge-cleanup`
  (`23 3 * * *`, done rows older than 90 days) guarded by pg_cron and pg_net being available.
- [x] **Step 4: Run** the test — Expected: `STORAGE PURGE CHECKS PASSED`.
- [x] **Step 5: Add the block to `scripts/test-db.sh`** and run `npm run test:db` — Expected: every block
  passes and `ALL DATABASE CHECKS PASSED` prints last.

### Task 2: The purge-files function

**Files:**
- Create: `supabase/functions/_shared/purgeFiles.ts`, `supabase/functions/_shared/cronAuth.ts`
- Create: `supabase/functions/purge-files/index.ts`
- Create: `src/data/purgeFiles.test.ts`, `src/data/cronAuth.test.ts`
- Modify: `tsconfig.json` (exclude the Deno entry, like the other functions)

**Interfaces:**
- `purgeAll(deps: { take(limit): Promise<QueuedFile[]>; remove(bucket, paths): Promise<void>; done(done: number[], failed: FailedFile[]): Promise<void> }) → { rounds, removed, failed }`
- `cronCallAllowed(header, secret): boolean` (no secret → true; else constant-time equality)

- [x] **Step 1: Write the failing tests**: batching by bucket and by 100; an empty take ends the run; a
  failed Storage call reports that batch with its error and the rest is done; the loop stops after 20
  rounds; `cronCallAllowed` accepts everything with no secret and only the exact header with one.
- [x] **Step 2: Run** `npm test` — Expected: FAIL (module not found).
- [x] **Step 3: Write the two shared modules and the Deno entry** (service-role client; 401 when the
  secret check fails; `storage.from(bucket).remove(paths)`).
- [x] **Step 4: Run** `npm test`, `npm run typecheck`, `npx expo lint` — Expected: all green.

### Task 3: One-file paste and going live

**Files:**
- Create: `scripts/bundle-function.mjs` (inlines `_shared` imports, nested ones too, for the dashboard editor)
- Modify: `docs/BRIEF-for-collaborators.md` (the deploy list names `purge-files`)
- Project files: `build/storage-purge.sql`, `build/purge-files-index.ts`, queue items in `build/paste-queue.md`

- [x] **Step 1: Bundle** `node scripts/bundle-function.mjs purge-files` and check only the `npm:` import is left.
- [x] **Step 2: Queue** the migration (Jeff presses Run), the function (Jeff presses Deploy, Verify JWT off)
  and the `purge_url` setting, with sha256s and verify steps.
- [ ] **Step 3: After they are live**: queue a path Storage doesn't have (`insert into private.storage_purge
  (bucket, path) values ('chat-media', 'club/verify/not-there.jpg')`) and confirm it ends with `done_at`
  set within ten minutes (a missing file counts as done, which only the live Storage API can show); then
  delete a test account on the live app and confirm the queue drains.
