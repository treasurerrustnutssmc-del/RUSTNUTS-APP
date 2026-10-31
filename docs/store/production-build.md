# Store (production) builds

- **Version:** `app.json` `version` is what the stores show (1.0.0 for launch). The build number
  goes up by itself on every production build (`autoIncrement`, stored on EAS). The runtime
  fingerprint ignores the version, so bumping it doesn't cut phones off from updates.
- **Making a build:** GitHub › Actions › **Store build** › Run workflow, then pick the platform.
  It builds from a clean Linux checkout, so its fingerprint matches what CI publishes. Don't make
  store builds on Windows (CRLF changes the fingerprint; see `.gitattributes`).
  - **Android** gives an app bundle (`.aab`) for Google Play.
  - **iOS** needs the club's Apple developer account first.
- **Updates:** every merge to `main` publishes to the `preview` channel (the test crew). The
  `production` channel (store installs) is published by hand: GitHub › Actions › **Preview update** ›
  Run workflow, tick **Also publish to production** (`scripts/preview-update.sh` with
  `CHANNEL=production`). Treat that run as a release: it reaches every member's phone within minutes.
- **Environment:** the build and its updates read the EAS "production" environment
  (GOOGLE_MAPS_ANDROID_KEY). GIF search's GIPHY key reaches store phones with the first update.
- **Submitting:** `eas submit --profile production --platform android` uploads to Play's internal
  track as a draft. It needs a Google Play service-account key on EAS, which can only be made once
  the club's Play Console exists. The first upload is often done by hand in Play Console instead.
- **After the first Play upload:** add Play's app-signing SHA-1 (Play Console › Setup › App
  signing) to the "Rustnuts Android app maps" key in Google Cloud, or maps go blank in store
  installs.
