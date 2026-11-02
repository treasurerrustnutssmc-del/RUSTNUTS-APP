# Live Edge Functions (snapshot 2 Nov 2026)

Taken from the production Supabase project. Source for each function is in `supabase/functions/<name>/index.ts`
(shared code in `supabase/functions/_shared/`). "JWT check" means Supabase rejects calls without a valid signed-in
user token before the function runs; where it is off, the function must protect itself.

| Function | Live version | JWT check | What it is for | Source in repo |
|---|---|---|---|---|
| ask-club | 8 | on | Club AI assistant (Anthropic API) and meeting "Catch me up" | yes |
| link-preview | 6 | on | Fetches title/image for links pasted in chat | yes |
| purge-files | 4 | off | Deletes stored files queued for removal; called by a scheduled job | yes |
| ride-voice-token | 6 | on | Issues LiveKit tokens for ride voice comms | yes |
| send-push | 14 | off | Sends queued push notifications; called by a scheduled job | yes |
| shop-order | 3 | on | Member merch orders; forwards to a Make.com webhook | yes |
| site-api | 12 | off | Public API for the club website (rides, news, documents, sign-ups, visit counter) | yes |
| sync-rides | 14 | off | Pulls rides from the club Google calendar; called by a scheduled job | yes |
| seed-shop-pictures | 2 | on | One-off loader for shop photos | **no** (not in the repo) |

Scheduled jobs that call the JWT-off functions send an `x-cron-secret` header built by `private.cron_headers()`
(see `live-database/02-policies-grants-jobs.sql` and `04-functions-private-*.sql`).

## Secrets the functions read (names only, values are never in the repo)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`,
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MAKE_WEBHOOK_MEMBER_URL`.
