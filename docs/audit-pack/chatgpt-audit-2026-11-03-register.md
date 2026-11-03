# ChatGPT audit, 3 Nov 2026: findings register

ChatGPT audited the app and website blind from GitHub (app commit d8563d1, website 8d68bde) using this
audit pack. Each finding below was checked against the current code and the live database export
before anything was changed. Fixes are in migration `20270790000000_chatgpt_audit_fixes.sql`, the
shared Edge Function code, the privacy policy, and the website.

| ID | ChatGPT's rating | Verdict | What was done |
|---|---|---|---|
| F01 | High | **Confirmed** | `claim_roster` only takes a roster place never claimed (`claimed_at is null`), and `forget_member` stamps it. A deleted account (suspended or not) signs up again as a plain applicant for the board to approve. Test: account_deletion_test. |
| F02 | Medium | **Confirmed in code, not exposed live** | The live project has `CRON_SECRET` set (proven 31 Oct: a call without the header got 401). `cronCallAllowed` now refuses every call when the secret is missing. Test: cronAuth.test.ts. Needs a redeploy of send-push, sync-rides and purge-files. |
| F03 | Medium | **Confirmed, deferred** | Someone already in a ride's voice room stays until their token runs out (at most the ride's live window) if their app ignores the hang-up. Fixing it needs LiveKit's server API to remove a participant when access ends. Deferred until ride comms is used on real rides; logged here. |
| F04 | Medium | **Confirmed** | `website_signup` no longer overwrites an existing sign-up for the same email; it says "That email is already on the list for this ride. To change it, email the club." Website wording changed to match. Tests: website_signups_test, siteApi.test.ts. |
| F05 | Medium | **Confirmed (narrow race)** | `place_shop_order` reads garments and designs `for share`, so a price changed mid-checkout waits until the order is written. Test: shop_test. |
| F06 | Medium | **Partly confirmed** | The Make payload now carries `appOrderId`, the same on every post of one order, so the Make scenario can skip a repeat. A failed "sent" write is retried once and logged, and never makes the member post again. Make-side dedupe on `appOrderId` is Chris's to add if wanted. Tests: shopOrder.test.ts. Needs a redeploy of shop-order. |
| F07 | Medium | **Confirmed (small overshoot)** | `assistant_start` now counts the question before checking the daily limit, as `catchup_start` already did. The monthly budget can still be overshot by questions already in flight (cents each); the Anthropic console's own US$20 cap is the hard stop. Test: club_assistant_test. |
| F08 | Medium | **Confirmed** | Every change to a fund's opening balance is kept in `fund_opening_changes` (old, new, who, when), readable through `fund_opening_history()` by whoever can see that fund's books. Existing openings were recorded as their first entry. Test: treasurer_test. |
| F09 | Medium | **Partly confirmed, deferred** | The DNS check isn't pinned to the connection, so a rebinding host could in theory reach a blocked address. The function needs a signed-in member, runs on Supabase's network outside the database, checks every redirect hop again (3 at most), reads 512 KB at most and hands back only a title and picture, never the page. Pinning needs a raw connection Deno's fetch doesn't offer; logged here. |
| F10 | Medium | **Confirmed** | Anyone can step down from their own seat even while suspended, then delete their account. The National Chairman (whose seat changes by vote) is told to email apps@rustnutssmc.com.au instead of a dead end. App rules mirror it. Tests: account_deletion_test, access.test.ts, account.test.ts. |
| F11 | Low | **Confirmed** | The privacy policy now says financial records are kept at least 7 years, and that the roster keeps name, email, level and dates after an account is deleted. Updated in the app and on the website. |
| F12 | Info | **Resolved** | The live `seed-shop-pictures` function is a retired stub that answers 410. Its source is now in the repo. |

Deferred items (F03, F09) are tracked here so the next audit can check them.
