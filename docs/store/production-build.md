# Store (production) builds

- **Version:** `app.json` `version` is what the stores show (1.0.0 for launch). The build number
  goes up by itself on every production build (`autoIncrement`, stored on EAS). The runtime
  fingerprint ignores the version, so bumping it doesn't cut phones off from updates.
- **Making a build:** GitHub › Actions › **Store build** › Run workflow, then pick the platform.
  It builds from a clean Linux checkout, so its fingerprint matches what CI publishes. Don't make
  store builds on Windows (CRLF changes the fingerprint; see `.gitattributes`).
  - **Android** gives an app bundle (`.aab`) for Google Play.
  - **iOS** (`ios`) gives an `.ipa` for App Store Connect; `ios-submit` uploads the latest one to
    TestFlight. The very first iPhone build is `ios-setup` (below).
- **Updates:** every merge to `main` publishes to the `preview` channel (the test crew). The
  `production` channel (store installs) is published by hand: GitHub › Actions › **Preview update** ›
  Run workflow, tick **Also publish to production** (`scripts/preview-update.sh` with
  `CHANNEL=production`). Treat that run as a release: it reaches every member's phone within minutes.
- **Environment:** the build and its updates read the EAS "production" environment
  (GOOGLE_MAPS_ANDROID_KEY). GIF search's GIPHY key reaches store phones with the first update.
- **Submitting:** `eas submit --profile production --platform android` uploads to Play's internal
  track as a draft. It needs a Google Play service-account key on EAS, which can only be made once
  the club's Play Console exists. It exists now (since 02/11/2026), but the key has not been made
  yet. The first upload was done by hand in Play Console on 03/11/2026.
- **Before the first Play upload (any track):** check the bundle's merged manifest, e.g.
  `bundletool dump manifest --bundle=Rustnuts.aab`. The only `foregroundServiceType` values should be
  `location` and `microphone`, and there should be no `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
  `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `MediaProjectionService` or `SYSTEM_ALERT_WINDOW` (they are
  kept out on purpose; see the ride comms spec, "Foreground services Google Play sees"). Anything
  else means another Play declaration and video.
- **After the first Play upload:** add Play's app-signing SHA-1 (Play Console › Setup › App
  signing) to the "Rustnuts Android app maps" key in Google Cloud, or maps go blank in store
  installs. Done on 03/11/2026: Play's signing keys and the EAS upload key are all on that key.
- **Any `app.json` change moves the Android runtime fingerprint,** which cuts the test phones off
  from over-the-air updates until a new Android build is installed. After such a merge, make a new
  Android preview build (Store build workflow › android-preview, or `eas build --profile preview --platform android`)
  and install it on the test phones before expecting updates to land. JS-only changes don't move it.
- **A red "ios-simulator" Store build job means the iPhone app doesn't compile.** Fix that before
  anything below; a production iOS build will fail the same way.

## iOS, first time

The Apple developer account is active since 20/11/2026: an **individual** membership in Jeff's name
(seller "Jeffrey Ostler") on the Apple ID `apps@rustnutssmc.com.au`, team id `M873J4CTU6`. The club's
own organisation enrolment was blocked by its D&B record; the account can be moved to the club later.

Nobody types an Apple password anywhere. EAS signs in to Apple with the App Store Connect **team**
API key "EAS build" (Admin role; an individual key can't make certificates). Its `.p8` text is the
`ASC_API_KEY_P8` repository secret; the Store build workflow writes it to `.asc/AuthKey.p8`
(git-ignored) and sets the `EXPO_ASC_*` and `EXPO_APPLE_TEAM_*` variables. If the key is ever
revoked, make a new team key (Users and Access › Integrations › App Store Connect API), put its
text in the secret, and change the key id in the workflow and in `eas.json`.

1. **App group.** `group.au.com.rustnutssmc.app` (used by the share extension) was registered by hand
   in Certificates, Identifiers & Profiles on 20/11/2026.
2. **The App Store Connect app**, by hand (the API key can't create apps): App Store Connect ›
   Apps › **New App**. Platform **iOS**, name **Rustnuts SMC**, primary language **English
   (Australia)**, bundle id **au.com.rustnutssmc.app**, SKU **rustnutssmc-app**. Put its Apple ID
   (the number on App Information) in `eas.json` `submit.production.ios.ascAppId`.
3. **First build: Store build › `ios-setup`.** eas-cli refuses to *create* a missing distribution
   certificate in `--non-interactive` mode, so this runs `eas build` interactively under `expect`
   (`.github/scripts/eas-ios-setup.exp`) with `CI=false`. EAS registers both bundle ids (the app and
   `au.com.rustnutssmc.app.expo-sharing-extension`), makes the certificate and both profiles, and
   keeps them, so later runs use plain `ios`.
4. **Push key.** `eas.json` turns off eas build's push question, because only an Apple *password*
   login can make a push key. Make an Apple Push Notifications key by hand (Certificates, Identifiers
   & Profiles › Keys), then add it to the app on expo.dev (project › Credentials › iOS). Without it
   iPhones never get push.
5. **Check the first ipa** before uploading it (download it from the build page):
   `unzip -l Rustnuts.ipa | grep -E 'SDWebImage.framework/PrivacyInfo|appex/PrivacyInfo'`
   should list both `Frameworks/SDWebImage.framework/PrivacyInfo.xcprivacy` and
   `PlugIns/expo-sharing-extension.appex/PrivacyInfo.xcprivacy`. If either is missing, App Store
   Connect rejects the upload with a privacy-manifest email (see
   `docs/superpowers/specs/2026-10-31-ios-readiness-design.md`, section 1).
6. **Upload: Store build › `ios-submit`** (`eas submit --latest` with the same key). Make sure the
   latest finished iOS build is the production one, not an `ios-simulator` build.
