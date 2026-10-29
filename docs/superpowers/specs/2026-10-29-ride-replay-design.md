# Ride replay

**Type:** bounded. New screen, pure-JS libraries only (no new native code, so it ships in an over-the-air update), no database change. Claude approved this design on 29 Oct 2026 under Jeff's standing rule; Jeff can veto any line.

## Goal
"Ride replay video of the day's route for socials" (the ambition list, Stage 7). A member opens a ride, plays an animated replay of its locked route, and shares it as a short video file.

## Decisions
- **Only what's already stored.** The replay draws the ride's locked route (its line and named stops), and the ride's title, date, chapter, distance and climb. It never uses anyone's GPS: live location stays ride-day only with nothing kept, so there's no track to replay and the app doesn't start keeping one.
- **One drawing for the screen and the file.** The replay is a 9:16 card drawn with `react-native-svg`, so what the member watches is exactly what they share:
  - the real club logo (with the flag) on top, the ride title, date (DD/MM/YYYY) and chapter in the stencil
  - the route line growing in club red behind a moving bone-ringed marker, over the full route in faint steel
  - each stop's pin appearing as the marker reaches it, with the stop's name in a banner and a short hold
  - a distance counter in the stencil
  - an end card: the whole route, its kilometres, stops and climb, and the ride's start and finish flags.
- **Why not the phone's map in the video.** Apple and Google map tiles can't be captured into a file from the app, and their terms limit it. The replay keeps the ride map's language instead: the same start flag colour, finish square and stop pins. The real map stays on the ride screen above.
- **The file is an animated GIF.** Making an MP4 on the phone needs new native code (a new app build for both phones). A GIF is made with pure JavaScript and plays in Messenger, WhatsApp and Facebook. Each frame comes from the drawing's own `toDataURL`, is decoded (`fast-png`), mapped to one shared 255-colour palette and written with `gifenc`. Pixels that didn't change since the last frame are written as transparent, which keeps the file small. 450×800, 10 frames a second, about 12 seconds.
- **Making it shows progress** ("Making the video… 40%") and can be stopped. When it's done the share sheet opens with `<ride title> replay.gif`.
- **Web preview:** the replay plays, and making the file says it's done in the phone app (the web drawing can't be captured with the club font).
- **Who sees it:** anyone who sees the ride's route (members; the family view has no routes). The Replay button sits under the route's Navigate on the ride screen, when the route has a line.

## Tests
- `src/domain/rideReplay.test.ts`: distance along the route, the point and part-line at a fraction, where each stop falls, the timeline (intro, ride with holds at stops, end card), the frame at a time, captions and the file name.
- `src/domain/gif.test.ts`: the encoder writes a valid GIF89a with the right frame count and size, loops forever, and unchanged pixels become transparent (decoded back with `omggif` in the test only).
- `npm test`, `npm run test:db`, typecheck, lint, and the screen at 390×844 in the web build.

## Not in this
- MP4 video (needs a native build; a follow-up if Instagram is wanted).
- Members' GPS tracks, speeds or times.
- Music or voice-over.
