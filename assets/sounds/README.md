# Notification sounds

`v_twin_rev.wav` is the Harley rev: a V-twin idling, blipped and settling (2.4 s, 44.1 kHz mono).
It's synthesised from scratch by `scripts/make-rev-sound.py` (no recording or sample was used), so
the club owns it outright and there's no licence to track. Run the script again to rebuild it
byte for byte.

To use a real bike instead, record a few seconds, trim it to under 30 seconds (iPhone's limit),
save it as a 16-bit WAV with this same name, and make a new phone build. Live ride alerts never use
it; they keep the phone's urgent alarm.
