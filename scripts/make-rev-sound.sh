#!/usr/bin/env bash
# Makes assets/sounds/v_twin_rev_2.wav, the notification sound, from Jeff's recording of his own bike
# starting up (scripts/sound-sources/jeffs-bike-2026-11-01.m4a, recorded 1 Nov 2026, the club's own).
# Takes 2.6 s from the starter catching to the first revs, cuts the rumble a phone speaker can't play,
# evens it out a little, fades it, and sets the peak at -1.5 dBFS. Needs ffmpeg.
# Run: bash scripts/make-rev-sound.sh
set -euo pipefail
cd "$(dirname "$0")/.."
src=scripts/sound-sources/jeffs-bike-2026-11-01.m4a
out=assets/sounds/v_twin_rev_2.wav
tmp=$(mktemp --suffix=.wav)
trap 'rm -f "$tmp"' EXIT
ffmpeg -y -hide_banner -loglevel error -ss 3.95 -t 2.6 -i "$src" -ac 1 -ar 44100 \
  -af "highpass=f=90:poles=2,lowpass=f=9000,acompressor=threshold=-22dB:ratio=3:attack=5:release=120:makeup=2,afade=t=in:d=0.02,afade=t=out:st=2.15:d=0.45" \
  -c:a pcm_s16le "$tmp"
peak=$(ffmpeg -hide_banner -i "$tmp" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')
gain=$(awk -v p="$peak" 'BEGIN { printf "%.1f", -1.5 - p }')
ffmpeg -y -hide_banner -loglevel error -i "$tmp" -af "volume=${gain}dB" -c:a pcm_s16le -fflags +bitexact -flags:a +bitexact "$out"
echo "wrote $out"
