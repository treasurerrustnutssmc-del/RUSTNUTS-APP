#!/usr/bin/env bash
# Publishes the checked-out commit to the EAS "preview" channel. Run by .github/workflows/preview-update.yml.
#
# Phones only take an update whose runtime fingerprint matches their build. The fingerprint hashes
# some text files, so a build made from a Windows (CRLF) checkout has a different fingerprint from
# CI's LF checkout. .gitattributes now gives every checkout LF, but builds made from CRLF checkouts
# before that are still installed, so this also publishes from a CRLF copy whenever a preview build
# exists with that fingerprint.
#
#   MESSAGE   update message (required)
#   DRY_RUN=1 work out the fingerprints and which builds they reach, publish nothing
set -euo pipefail

: "${MESSAGE:?MESSAGE is required}"
ENVIRONMENT=preview
CHANNEL=preview

# Kept outside the checkout: a new file in it (or a .gitignore line for one) would change the fingerprint.
work=$(mktemp -d)

runtime() { # platform
  eas env:exec "$ENVIRONMENT" "npx expo-updates runtimeversion:resolve --platform $1 > $work/runtime-$1.json" --non-interactive >/dev/null
  node -p "require('$work/runtime-$1.json').runtimeVersion"
}

has_build() { # platform runtime
  local builds
  if ! builds=$(eas build:list --platform "$1" --channel "$CHANNEL" --runtime-version "$2" --status finished --limit 1 --json --non-interactive); then
    echo "::warning::Couldn't list $CHANNEL builds for runtime $2."
    return 1
  fi
  [ "$(node -p "JSON.parse(process.argv[1]).length" "$builds")" -gt 0 ]
}

publish() { # message, extra eas update args...
  local message=$1; shift
  if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY_RUN: would publish \"$message\" $*"; return; fi
  eas update --channel "$CHANNEL" --environment "$ENVIRONMENT" --message "$message" --non-interactive "$@"
}

android_lf=$(runtime android)
echo "Android runtime (LF checkout): $android_lf"
has_build android "$android_lf" || echo "::warning::No finished $CHANNEL Android build has runtime $android_lf yet, so no phone gets this update until a new build is installed."
publish "$MESSAGE"

# Windows-made builds: same commit, CRLF line endings.
printf '* text=auto eol=crlf\n*.cmd text eol=crlf\n' > .git/info/attributes
git rm -q -r --cached . && git reset -q --hard
android_crlf=$(runtime android)
echo "Android runtime (CRLF checkout): $android_crlf"
if [ "$android_crlf" != "$android_lf" ] && has_build android "$android_crlf"; then
  publish "$MESSAGE (for builds made on Windows)" --platform android
else
  echo "No $CHANNEL Android build made from a CRLF checkout, skipping."
fi
rm .git/info/attributes
git rm -q -r --cached . && git reset -q --hard
