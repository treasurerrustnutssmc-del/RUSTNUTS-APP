#!/usr/bin/env bash
# Publishes the checked-out commit to an EAS channel ("preview" unless CHANNEL says otherwise).
# Run by .github/workflows/preview-update.yml: for preview on every push to main, and for production
# only on a manual run with 'Also publish to production' ticked.
#
# Phones only take an update whose runtime fingerprint matches their build. The fingerprint hashes
# some text files, so a build made from a Windows (CRLF) checkout has a different fingerprint from
# CI's LF checkout. .gitattributes now gives every checkout LF, but Android builds made from CRLF
# checkouts before that are still installed, so on the preview channel this also publishes from a
# CRLF copy whenever a preview build exists with that fingerprint. Store builds come from CI only.
#
#   MESSAGE   update message (required)
#   CHANNEL   channel and EAS environment to publish to (default preview; production for store builds)
#   DRY_RUN=1 work out the fingerprints and which builds they reach, publish nothing
set -euo pipefail
shopt -s inherit_errexit

: "${MESSAGE:?MESSAGE is required}"
CHANNEL=${CHANNEL:-preview}
ENVIRONMENT=$CHANNEL

# Kept outside the checkout: a new file in it (or a .gitignore line for one) would change the fingerprint.
work=$(mktemp -d)

runtime() { # platform, label
  local out="$work/runtime-$1-$2.json"
  eas env:exec "$ENVIRONMENT" "npx expo-updates runtimeversion:resolve --platform $1 > $out" --non-interactive >/dev/null || return 1
  node -p "require('$out').runtimeVersion"
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

checkout_with() { # attributes line, or empty for the repo's own .gitattributes
  if [ -n "$1" ]; then printf '%s\n*.cmd -text\n' "$1" > .git/info/attributes; else rm -f .git/info/attributes; fi
  git rm -q -r --cached .
  git reset -q --hard
}
trap 'checkout_with ""' EXIT

android_lf=$(runtime android lf)
echo "Android runtime (LF checkout): $android_lf"

# Windows-made builds first, while the checkout is still clean: same commit, CRLF line endings.
if [ "$CHANNEL" = preview ]; then
  checkout_with '* text=auto eol=crlf'
  android_crlf=$(runtime android crlf)
  echo "Android runtime (CRLF checkout): $android_crlf"
  if [ "$android_crlf" != "$android_lf" ] && has_build android "$android_crlf"; then
    publish "$MESSAGE (for builds made on Windows)" --platform android
  else
    echo "No $CHANNEL Android build made from a CRLF checkout, skipping."
  fi
  checkout_with ''
fi

has_build android "$android_lf" || echo "::warning::No finished $CHANNEL Android build has runtime $android_lf yet, so no Android phone gets this update until a new build is installed."
publish "$MESSAGE"
