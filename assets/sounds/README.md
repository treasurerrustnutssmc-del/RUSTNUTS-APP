# Notification sounds

`v_twin_rev_2.wav` is the Harley rev: Jeff's own bike starting up, the starter catching and the first
revs (2.6 s, 44.1 kHz 16-bit mono). It's made from his recording
(`scripts/sound-sources/jeffs-bike-2026-11-01.m4a`, the club's own) by `bash scripts/make-rev-sound.sh`,
which trims it, cuts the deep rumble a phone speaker can't play, evens it out and levels it.

It replaced `v_twin_rev.wav` (31 Oct 2026), a synthesised rev that was mostly bass a phone speaker can't
play, so phones only gave out its hiss and crackle.

Changing the sound needs new Android channel ids, because Android fixes a channel's sound once it exists:
bump `REV` in `src/domain/notifications.ts` and the matching ids in `supabase/functions/_shared/sendPush.ts`,
add the old ids to `RETIRED_ANDROID_CHANNELS`, use a new file name, and make a new phone build. Phones
on an older build still get pushes, with the plain sound, until they update.

To use a different recording, record a few seconds, trim it to under 30 seconds (iPhone's limit), save it as
a 16-bit WAV under a new name, and follow the steps above. Live ride alerts never use it; they keep the
phone's urgent alarm.

# Demo ride comms

`demo_ride_comms.wav` is what the ride comms demo plays on a phone: 8 s of engine rumble with radio
squelch (22.05 kHz 16-bit mono, loops cleanly), so a store reviewer can hear the call carry on with the
screen locked. It's synthesised by `node scripts/make-demo-ride-comms-sound.mjs`, no recording or speech,
and rebuilds byte for byte.
