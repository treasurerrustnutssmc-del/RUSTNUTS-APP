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

1. **App group and App IDs, by hand.** `group.au.com.rustnutssmc.app` (used by the share extension)
   was registered in Certificates, Identifiers & Profiles on 20/11/2026, and both App IDs below
   were registered by hand the same day with it assigned. EAS can't *assign* an app
   group to an App ID when it signs in with an API key (eas-cli skips "capability identifier
   syncing" without a password session), and a profile without the group fails code signing. So
   register both App IDs by hand first, each with **App Groups** on and that group assigned:
   `au.com.rustnutssmc.app` (also Push Notifications, Associated Domains, Time Sensitive
   Notifications) and `au.com.rustnutssmc.app.expo-sharing-extension`. EAS then finds them and
   makes profiles that include the group. If the group is ever missing from a profile, assign it,
   then run `ios`: Apple marks the old profiles invalid and EAS makes new ones.
2. **The App Store Connect app**, by hand (the API key can't create apps): App Store Connect ›
   Apps › **New App**. Platform **iOS**, name **Rustnuts SMC**, primary language **English
   (Australia)**, bundle id **au.com.rustnutssmc.app**, SKU **rustnutssmc-app**. Put its Apple ID
   (the number on App Information) in `eas.json` `submit.production.ios.ascAppId`. Done 20/11/2026:
   Apple ID **6837151025**.
3. **First build: Store build › `ios-setup`.** eas-cli refuses to *create* a missing distribution
   certificate in `--non-interactive` mode, so this runs `eas build` interactively under `expect`
   (`.github/scripts/eas-ios-setup.exp`) with `CI=false`. EAS finds both App IDs from step 1, makes
   the certificate and both profiles, and keeps them, so later runs use plain `ios`. The script
   answers only the certificate and profile questions; any other question, a pick-list or an Apple
   password prompt stops the job red, and the log shows what EAS asked. The job ends once the
   build is queued; watch the build itself on expo.dev.
4. **Push key.** `eas.json` turns off eas build's push question, because only an Apple *password*
   login can make a push key. Make an Apple Push Notifications key by hand (Certificates, Identifiers
   & Profiles › Keys), then add it to the app on expo.dev (project › Credentials › iOS). Without it
   iPhones never get push.
5. **Privacy manifests** are checked by `ios-submit` itself (`.github/scripts/check-ipa-privacy.py`)
   before anything is uploaded: the app, every app extension (`PlugIns/*.appex`) and every embedded
   framework on Apple's list of commonly used SDKs (SDWebImage and the like) must carry a
   `PrivacyInfo.xcprivacy`, or App Store Connect rejects the upload with a privacy-manifest email (see
   `docs/superpowers/specs/2026-10-31-ios-readiness-design.md`, section 1). A red job names the
   bundle that's missing one.
6. **Upload: Store build › `ios-submit`.** It picks the newest *finished* `production` iPhone build
   (never an `ios-simulator` one, never one still building), downloads its `.ipa` for the check
   above, then runs `eas submit --id <that build>` with the same key. It stops early until
   `ascAppId` is set, or when no store build has finished yet. Submitting sends the key to Expo's
   submission service, which uses it to talk to Apple; that's expected.
