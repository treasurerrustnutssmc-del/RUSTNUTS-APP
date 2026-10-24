# Claimable roster (auto-link by email)

**Type:** architectural (new table, new database action, sign-in flow change). Jeff picked
"auto-link by email" on 24 Oct 2026 and has given blanket approval for build and design calls.

## Goal
The 28 people on the FY26–27 roster sign in with their own email and land straight on their
own record (name, road name, chapter, patched/FNG/Nomad, hiatus, positions), already approved.
Nobody fills in the join form or waits for the board.

## Design
- `private.roster` holds one row per expected member: email (stored lower-case, unique), chapter,
  full name, road name, status, joined/patched/FNG dates, on-hiatus flag, and the positions they
  hold. It lives in the `private` schema, so the app's API can't read it. Only an admin loads it.
- `public.claim_roster()` is run by the app right after sign-in when the person has no member
  record yet. It looks up their **confirmed** sign-in email. On a match it creates their approved
  member record, their contact record (email only), and their positions, then marks the roster
  row as claimed. It returns true when it linked someone, otherwise false.
  - A seat someone already holds is skipped, never doubled.
  - It never touches anyone who already has a member record.
  - Each roster row can be claimed once.
- Anyone not on the roster still sees Ask to join, as now.
- Real data is loaded later from the sheet, with Jeff's explicit yes, by an admin SQL script
  that `scripts/roster-sql.mts` builds from a CSV. Contacts other than the email aren't loaded.

## Tests
`supabase/tests/roster_claim_test.sql`:
- A match creates the member, the contact record and the positions.
- A second call does nothing.
- An unconfirmed email can't claim.
- Someone not on the roster gets false.
- A taken seat is skipped.
- Someone who already applied isn't overwritten.
- The roster can't be read through the API.

## Before launch: password sign-ups
Claiming trusts a confirmed email. The app only uses email codes, but Supabase's email provider
also accepts password sign-ups with the public key. Before members get the app:
- Keep **Confirm email** on (Authentication → Sign In / Providers → Email).
- Block password sign-ups with a before-user-created hook, so nobody can register a member's
  address with a password ahead of them.

Supabase gives email-code accounts a random password as well, so `claim_roster` can't tell the
two kinds of account apart by password. Anonymous accounts are refused.

## Notes
- Positions from the roster go in through `private.add_roster_position`. Clashes with the
  one-holder rules are skipped, never fatal, so a claim can't fail halfway and leave a member
  stuck on Ask to join.
- Founder and national roles can come from the roster, unlike `appoint_position`, because only
  an admin loads it. `appointed_by` is left empty for these.
