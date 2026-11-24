# Ride comms bubbles: a floating bubble per live ride, with its own Emergency

Asked by Jeff, 22 Nov 2026: "when the comms link is live and active it pops up to the front like a
speech bubble with a connected members count and an associated floating call emergency which buzzes
every active member of that ride ... members at different rides, either run by us or attending as
supporters, could require multiple chat bubbles, and emergency should only link to the specific
ride." Jeff tapped "In-app bubbles first" on 23 Nov. Size: architectural (database + an overlay over
every screen), so this spec. Approved by Claude under the 24 Oct rule; Jeff can veto.

## What each phone can do (told to Jeff 22 Nov)

- In the app, on both phones: this piece. JavaScript and SQL only, so an over-the-air update.
- Over other apps: Android only (draw-over-apps permission, new native build). Later, batched.
- iPhone can't float over other apps; a Live Activity / Dynamic Island is the nearest. Later.

## Approaches for "how many are connected"

The phone only knows who is in the call it has joined. A bubble for a ride you're not in needs
the club to know.

1. **Presence rows written by the sweep and by the phone (chosen).** A small table
   `ride_voice_presence (ride_id, member_id, seen_at)`. The voice sweep already gets the full list
   of who is in each ride room from LiveKit every minute and hands it to `public.voice_sweep`; that
   function now also records it (so it is right even with screens off). The phone also says "here"
   the moment it joins and "gone" when it hangs up, so the count moves at once. A row counts while
   seen in the last 3 minutes. No Edge Function change: the sweep already sends the list.
2. **The phone heartbeats only.** Simpler, but a phone with the screen off may not run its timers,
   and riders mostly have their screens off.
3. **A LiveKit webhook.** Exact, but a new Edge Function, new secret and LiveKit dashboard setup.

## Goals

- **Which bubbles.** One per ride whose live window is open, not called off, that you're allowed on
  (`liveProblem` null), and either: you're connected to its comms, or someone is connected and it's
  yours (the same "mine" rule as Home's live ride: your colours and not Can't go, or you said Going
  or Maybe, which is how Supported rides count, or you're sharing your location on it). Most three.
  A ride you raised an emergency on from a bubble keeps its bubble (even hidden, empty, or on its
  own live ride screen) until you cancel it or the ride's over, so it can always be seen and cancelled.
  The one you're on air with comes first, then latest start first.
- **The bubble.** A round 56 bubble on the right edge, over every screen, with a headset, the ride's
  short name in the stencil under it and the connected count on it. Red ring when you're on air on
  that ride, steel ring otherwise. Drag it up and down; it stays on the edge. It isn't shown on the
  live ride screen for that same ride (it's already there), on the photo viewer, or to anyone who
  isn't an approved member.
- **Tap the bubble**: a small panel beside it: ride name, leg if any, "5 connected" (or "On air ·
  5 riders"), Connect (or Switch to this ride when on another ride's comms; a phone holds one call),
  Mute / Disconnect when on it, Open live ride, and Hide (hides that bubble until you connect from it
  or restart the app; while you're on air with that ride it shows anyway). The bubbles step aside
  while the keyboard is up.
- **The Emergency button.** A round red-outlined button joined to each bubble. One tap arms it ("Send
  emergency" pill); a second tap sends it. Disarms itself after 6 seconds. It raises the same
  `emergency` ride alert as the live ride screen, for that ride only, with where you are if the
  phone already knows (no new location prompt; none at all on the web), held and sent later with no
  signal. It shows "Sending…" while it goes (taps ignored), then "Sent" with "I'm OK, cancel" in the
  panel. A held one keeps trying every 15 s; once through it learns its alert id (asking again with
  the same press time returns the same alert), so it can be cancelled too. One the club refuses for
  good says "Emergency not sent: reason. Call 000" and the button can be pressed again. A cancel
  that finds it already cleared by a leader just clears it.
- **Who it buzzes.** Today: everyone sharing location on that ride. Now: everyone sharing location on
  that ride **or** connected to its comms in the last 3 minutes, still approved for the ride, not the
  sender. Fuel, out and regroup stay as they are (they are about location). Someone only on comms
  isn't on the map, so their push says which ride and to share their location to see where.
- **Known limit.** `ride_comms_here` trusts the phone: an approved member could mark themselves on an
  open ride's comms without joining the call. Members may join any open ride's comms anyway, so
  this only inflates a count and subscribes them to that ride's emergencies. The sweep corrects it
  within a minute when the room is listed.

## Non-goals

- Over other apps (Android) and Live Activities (iPhone): later native batch.
- Showing names of who's connected for rides you're not in (count only).
- Changing the live ride screen, ride comms card or the call itself.

## Database

- `public.ride_voice_presence`, RLS on, no policies (functions only). Cascades with ride and member.
- `public.voice_sweep(p_rooms)`: now volatile; for each open ride room, replaces that ride's
  presence with the members it keeps (not the ones it removes); for a room it closes, clears it.
  The presence writes can never make the sweep itself fail (closing rooms and removing people is
  the security job it exists for).
- `public.ride_comms_here(p_ride uuid, p_here boolean)`: the caller (must pass `live_problem`) is
  recorded or cleared.
- `public.ride_comms_counts()`: `[{ride_id, connected}]` for every ride whose window is open, which
  the caller may join, with at least one seen in the last 3 minutes. Counts only.
- `private.push_ride_alert()`: emergencies also go to presence on that ride.

## The app

- `src/domain/commsBubbles.ts`: `commsBubbles(input)` (pure, tested) picks and orders the bubbles;
  `isMyRide` is lifted out of `homeLiveRide` so both use one rule.
- `src/data/commsBubblesData.ts`: `useCommsCounts()` polls `ride_comms_counts` every 30 s, only
  while a ride's live window is open (the demo makes counts up); `sayOnComms` (in order, one at a
  time), which `RideVoiceProvider` calls on join, each minute while on, and on leaving; and the
  bubble's raise, cancel and held-send.
- `src/ui/CommsBubbles.tsx`: the overlay, mounted beside `IncomingBanner` in `RootNavigator`.
- Demo: a second made-up ride on now (a whole-club ride), so two bubbles can be seen.

## Design notes

DESIGN.md's Flat Clubhouse Rule says nothing floats. Jeff asked for a floating bubble, so this is
the one thing that floats, and it still has no shadow: a hairline-steel or red ring on raised ink
stands it off the screen. Stencil for the count and names. The only red is the on-air ring and the
Emergency button. 56 bubble and 48 Emergency button (Android's 48 floor). Reduce Motion: no
spring, it just appears.

## Tests

- `npm test`: bubble picking (window, mine, supported only when going, connected first, cap 3,
  hidden, called off, on its own live ride screen), the counts merge, emergency arm/disarm timing.
- `npm run test:db`: sweep writes and clears presence; `ride_comms_here` refuses outside the window;
  counts are counts only and only for rides the caller may join; an emergency pushes to a comms-only
  rider but fuel doesn't; the sender isn't pushed.
