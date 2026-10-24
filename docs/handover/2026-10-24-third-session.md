# Handover: third session, 24 Oct 2026

No passwords, tokens or keys are in this file, and none should ever be added.

## Done (all merged to main, live database updated)
- **Founder seed** made safe to re-run. It also creates the founder's `member_private` row; that
  row was missing and broke profile save, and it was backfilled live. Jeff is signed in as
  El Jefe: approved Full, West, Founder, National Chairman, Treasurer of West and North. The
  SMTP email codes work.
- **Logo** with the Australian flag (`assets/logo.png`), per AGENTS.md.
- **Rustnuts Stencil** built from Stardos Stencil Bold by `scripts/build-font.py`. It lives in
  `assets/fonts/` with its OFL licence, is used app-wide (names, chips, tabs, values), and is
  inlined in the web preview. Saira has been removed.
- **Keyboard:** the focused box scrolls clear of the keyboard and the tab bar hides while
  typing. Date boxes add the slashes themselves (`typeDate`). This hasn't been confirmed on
  Jeff's phone yet.
- **Claimable roster:** Jeff chose auto-link by email.
  - `private.roster` and `claim_roster()` are live, and the app calls the claim before loading.
  - `scripts/roster-sql.mts` turns the sheet (CSV) into the loading SQL.
  - Spec: `docs/superpowers/specs/2026-10-24-claimable-roster.md`.

## Next
1. **Load the real roster.** It needs the sheet with an email column from Jeff, and his explicit
   go-ahead to load real member data.
   - Columns: email, chapter, full_name, road_name, status, joined_on, patched_on,
     fng_started_on, on_hiatus, roles.
   - Run the generated SQL as admin.
   - Jeff: send NO emails or invites to members until the app is finished. Loading is silent.
2. **Before launch:** keep "Confirm email" on, and add the Password Verification Attempt hook
   that rejects all password sign-ins (see the spec).
3. **Stage 2:** ride calendar, RSVPs, locked GPX routes, and booking the Rusty Bus.
4. **Still open:** the questions in the second-session handover (Kilroy's name, Tractor's role,
   nicknames, Hacker/Jack P/Treesburger, Jeff's home chapter), the Impeccable install
   (needs his yes), and the spare Supabase project.
5. **PRODUCT.md and DESIGN.md**, which AGENTS.md names as the design authority, don't exist yet.
