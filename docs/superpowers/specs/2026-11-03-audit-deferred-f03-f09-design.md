# Closing the two deferred ChatGPT audit findings (F03, F09)

Date: 3 Nov 2026. Bounded work (two small server changes, one migration). Claude approves; Jeff can veto.

## F03: someone stays in a ride's voice room after their access ends

Today the token is cut to the ride's live window, and the app hangs up when access ends. An app that
ignores the hang-up keeps talking until the token runs out (up to 3 hours, never past the window).

**Fix: a voice sweep, every minute while a ride is live.**

- New Edge Function `voice-sweep` (verify_jwt off, `x-cron-secret` required, fails closed like the
  other scheduled functions). Without the LiveKit secrets it does nothing and says so.
- It lists LiveKit's active rooms named `ride-<uuid>`, lists each room's participants, and asks the
  database (service role only) `public.voice_sweep(p_rooms jsonb)` what to do:
  - the ride is gone, cancelled or past its live window: close the room (everyone leaves);
  - otherwise: remove each participant who isn't an approved, non-family member any more
    (suspended, declined, deleted or turned into a family account).
- The rule is `private.live_problem_for(p_ride, p_member)`, the live ride rule for a named member.
  `private.live_problem` (which the token and every live ride step use) now asks it for the signed-in
  member, so who may join and who may stay can't drift apart. Its answers are unchanged.
- Schedule: `cron.schedule('voice-sweep', '* * * * *', ...)` posting only when
  `private.voice_sweep_url()` is set **and** some ride's live window is open or closed in the last 6 hours (or a ride was called off in the
  last 6 hours), so
  the function is not woken on days with no ride. The URL is stored in `private.app_settings`
  (`voice_sweep_url`), like the others; until it is set nothing runs.
- Logic (`_shared/voiceSweep.ts`) is plain TypeScript with LiveKit and the database passed in, tested
  with `node:test`. The database rule is tested in `ride_voice_test.sql`.

## F09: link-preview's DNS check isn't pinned to the connection

Today the function looks the host up, checks every address is public, then `fetch` looks it up again.
A host that answers public then private could, in theory, be fetched on a private address.

**Fix: connect to the checked address ourselves.**

- `FetchDeps.get` gets the address that was checked: `get(url, address, signal)`.
- The Edge Function opens a TCP connection to that address (`Deno.connect`), and for https upgrades it
  with `Deno.startTls(conn, { hostname: url.hostname })`, so the certificate is still checked against
  the real name. It sends one small HTTP/1.1 GET (`Host`, `Connection: close`,
  `Accept-Encoding: identity`) and reads the answer with a small parser in `_shared/linkPreview.ts`
  (status, headers, body by content-length, chunked or until close). Nothing else changes: the same
  redirect checks (each hop looked up and checked again), 512 KB cap and 5 second limit.
- IPv4 addresses are tried first; if one won't connect the next checked address is tried.
- Parser and request builder are tested with in-memory streams in `linkPreview.test.ts`.

## Not doing

- No change to the app screens; members see nothing new.
- No Make, website or account changes.

## Going live

Migration (one SQL run), deploy `voice-sweep` and `link-preview`, then set
`voice_sweep_url` in `private.app_settings`. The CRON_SECRET secret is project-wide, so voice-sweep
already has it.
