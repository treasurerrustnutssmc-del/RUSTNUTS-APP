# Independent audit pack

This folder lets an outside reviewer (for example ChatGPT with the GitHub connector) audit the Rustnuts app
without access to the live systems. Everything here is read-only reference material.

## What the app is

A members' app for the Rustnuts Social Motorcycle Club (Australia): rides, chat, meetings and votes, club money
and books, merch shop, push notifications, a club AI assistant, and a public website fed from the same database.
Read `PRODUCT.md` at the repo root for who uses it and why.

## Where things are

| Path | What it holds |
|---|---|
| `src/` | The Expo / React Native app (screens, navigation, rules in `src/domain/`, data access in `src/data/`) |
| `supabase/migrations/` | Database changes in the order they were written |
| `supabase/functions/` | Server-side Edge Functions (Deno / TypeScript) |
| `supabase/tests/` | Database tests (pgTAP-style SQL) |
| `docs/audit-pack/live-database/` | **What is actually live** in the production database on 2 Nov 2026: tables, row-level security policies, grants, functions, scheduled jobs, storage buckets |
| `docs/audit-pack/edge-functions.md` | Live Edge Functions, their versions and JWT settings |
| `site/` and the separate website repo `treasurerrustnutssmc-del/rustnutssmc` | The public club website |

## What is deliberately left out

- No member personal data and no row contents of any table.
- No secret values (API keys, webhook addresses, cron secret). Names of the secrets are listed in `edge-functions.md`.
- No earlier audit results, so the review stays independent.

## Notes for the reviewer

- The live export is the source of truth for what is running. If it differs from `supabase/migrations/`, that
  drift is itself worth reporting.
- Access rules are written twice: in the app (`src/domain/access.ts`) and in the database (row-level security
  and `SECURITY DEFINER` functions). The database is what actually protects data.
- Members sign in by emailed one-time code. Roles include member grades (prospect, full, nomad, legacy, family),
  chapter boards (president, treasurer and so on) and a national committee (NEC chair, secretary, auditor).
