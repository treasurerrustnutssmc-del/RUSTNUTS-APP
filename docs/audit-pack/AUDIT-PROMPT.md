# Prompt for an independent audit

Paste everything below the line into ChatGPT (Deep research or Codex) with GitHub connected.

---

You are an independent senior security and software auditor. Audit the "Rustnuts" motorcycle club app in the GitHub repository **treasurerrustnutssmc-del/rustnuts-app** (branch `main`). Also review the website repository **treasurerrustnutssmc-del/rustnutssmc** where it talks to the app's database.

Start by reading `docs/audit-pack/README.md`. The folder `docs/audit-pack/live-database/` is an export of what is actually running in the production Supabase database (tables, row-level security policies, grants, functions, scheduled jobs, storage buckets). Treat it as the source of truth for the live system, and `supabase/migrations/` as the history. `docs/audit-pack/edge-functions.md` lists the live server functions and whether each checks the user's sign-in token.

Work blind: do not trust comments, specs or docs that say something is safe. Verify it in the code and the live export.

## What to check

1. **Database access control (highest priority).** For every table, check row-level security is on and the policies only let the right people read or change rows. For every `SECURITY DEFINER` function that `anon` or `authenticated` can execute, check it validates the caller, their role and chapter, and its inputs, and that `search_path` is fixed. Look for ways a prospect, family account, suspended or removed member, or someone from another chapter could read or change data they should not. Look for privilege escalation (a member giving themselves a board or national role).
2. **Server functions.** In `supabase/functions/`, check the ones with the sign-in check off (`site-api`, `send-push`, `sync-rides`, `purge-files`) cannot be abused by an outsider, check the cron secret comparison, input validation, CORS, rate limits, and where the service-role key is used. Check `ask-club` for prompt injection, data leaking between members, and cost abuse.
3. **Secrets.** Search both repositories and their history-visible files for API keys, tokens, webhook addresses, passwords or service-role keys that should not be public. Note which keys are meant to be public (Supabase anon key, Firebase config) and confirm nothing else is.
4. **Privacy.** What personal data is stored (names, phone, address, location during rides, medical or emergency details, photos, voice), who can see it, how long it is kept, and whether account deletion really removes it. Compare against the Australian Privacy Principles and the privacy policy in the repo.
5. **Money and books.** The ledger, fees, chapter funds and the treasurer report. Check amounts cannot be changed or deleted without trace, rounding and currency handling, that only the right roles can post entries, and that totals cannot drift.
6. **Merch shop.** Orders, prices, stock, shipping and the "mark paid" flow. Check a member cannot set their own price, see other members' orders or addresses, or mark their own order paid. Check the Make.com webhook call.
7. **Push notifications and chat.** Who can trigger a push to whom, spam or harassment paths, and push token handling. Content rules: report, block and suspend, and whether blocked or suspended users are really cut off.
8. **Website.** Forms that write into the app's database (sign-ups, enquiries, visit counter): spam, injection and data exposure.
9. **App Store and Google Play readiness.** Account deletion, user-generated content rules (report, block, terms acceptance), privacy policy, permissions requested with reasons, and anything likely to be rejected.
10. **Bugs and robustness.** Logic errors, unhandled errors, race conditions (double submits, two people changing the same thing), offline behaviour, date and time-zone handling (Melbourne time, dates stored as YYYY-MM-DD), and anything that would break at a few hundred members.

## How to report

- Rank every finding by severity: **Critical, High, Medium, Low, Info**.
- For each finding give: a short title, the file and line (for example `supabase/functions/site-api/index.ts:120` or the policy or function name in `docs/audit-pack/live-database/`), what is wrong, a concrete way it could go wrong (who does what, and what happens), and a suggested fix.
- Say how sure you are (confirmed in code, or likely but unverified).
- Do not pad the list. Leave out style nitpicks. If an area looks sound, say so in one line and say what you checked.
- Finish with a short summary: the top five things to fix first, and anything you could not check because you lacked access.
