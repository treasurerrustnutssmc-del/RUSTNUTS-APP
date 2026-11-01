#!/usr/bin/env bash
# Builds the web version of the app (live club database) into site/<slug>/ so the Pages workflow can
# publish it at https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/<slug>/.
# It is for helpers who want to look at the app on a PC (Chris), not for members: nothing links to it,
# and it is behind the same roster sign-in as the phone app.
# Expo's web export writes root paths (/_expo, /assets, /favicon.ico); this rewrites them to sit under
# the Pages sub-path, so app.json (and the phone builds' update fingerprint) stays untouched.
set -euo pipefail
SLUG="${1:?usage: scripts/web-preview.sh <slug>}"
BASE="/RUSTNUTS-APP/$SLUG"
OUT="site/$SLUG"
rm -rf "$OUT"
EXPO_PUBLIC_SUPABASE_URL=https://mfhbvsybudneimgbfjpy.supabase.co \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SQmN9OqIfZoyxopWB_wpNA_WjzUfHkK \
  npx expo export --platform web --output-dir "$OUT"
# Point every root path at the sub-path.
find "$OUT" -name '*.html' -o -name '*.js' | while read -r f; do
  sed -i -e "s#\"/_expo/#\"$BASE/_expo/#g" -e "s#\"/assets/#\"$BASE/assets/#g" \
         -e "s#href=\"/favicon.ico\"#href=\"$BASE/favicon.ico\"#g" "$f"
done
# Keep search engines out.
sed -i 's#<head>#<head><meta name="robots" content="noindex,nofollow">#' "$OUT/index.html"
echo "Built $OUT for $BASE/"
