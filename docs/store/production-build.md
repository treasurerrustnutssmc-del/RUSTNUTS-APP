# Store (production) builds

- **Version:** `app.json` `version` is what the stores show (1.0.0 for launch). The build number
  goes up by itself on every production build (`autoIncrement`, stored on EAS). The runtime
  fingerprint ignores the version, so bumping it doesn't cut phones off from updates.
- **Making a build:** GitHub › Actions › **Store build** › Run workflow, then pick the platform.
  It builds from a clean Linux checkout, so its fingerprint matches what CI publishes. Don't make
  store builds on Windows (CRLF changes the fingerprint; see `.gitattributes`).
  - **Android** gives an app bundle (`.aab`) for Google Play.
  - **iOS** needs the club's Apple developer account first.
- **Updates:** every merge to `main` publishes to both channels: `preview` for the test crew and
  `production` for store installs (`scripts/preview-update.sh` with `CHANNEL=production`). A merge
  reaches store users as well as testers, so treat main as live.
- **Environment:** the build and its updates read the EAS "production" environment
  (GOOGLE_MAPS_ANDROID_KEY). GIF search's GIPHY key reaches store phones with the first update.
- **Submitting:** `eas submit --profile production --platform android` uploads to Play's internal
  track as a draft. It needs a Google Play service-account key on EAS, which can only be made once
  the club's Play Console exists. The first upload is often done by hand in Play Console instead.
- **After the first Play upload:** add Play's app-signing SHA-1 (Play Console › Setup › App
  signing) to the "Rustnuts Android app maps" key in Google Cloud, or maps go blank in store
  installs.
- **Any `app.json` change moves the Android runtime fingerprint,** which cuts the test phones off
  from over-the-air updates until a new Android build is installed. After such a merge, make a new
  Android preview build (Store build workflow, or `eas build --profile preview --platform android`)
  and install it on the test phones before expecting updates to land. JS-only changes don't move it.
- **A red "ios-simulator" Store build job means the iPhone app doesn't compile.** Fix that before
  anything below; a production iOS build will fail the same way.

## iOS, first time

The club's Apple developer account has to exist first (Account Holder or Admin Apple ID:
`apps@rustnutssmc.com.au`). EAS can't make iOS credentials from CI the first time, so these steps run
by hand, once, from a computer where you can sign in to Apple.

1. **Credentials.** Run `npx eas-cli@latest credentials -p ios`, sign in with the Account Holder/Admin
   Apple ID and pick the **production** profile. Then:
   - **Build Credentials: Manage everything needed to build your project** › **All: Set up all the
     required credentials**. EAS makes the distribution certificate, the provisioning profiles for
     both bundle ids (the app, `au.com.rustnutssmc.app`, and the share extension,
     `au.com.rustnutssmc.app.expo-sharing-extension`) and registers the app group
     (`group.au.com.rustnutssmc.app`).
   - **Push Notifications: Manage your Apple Push Notifications Key** › set up a new key. Without it
     iPhones never get push.
   Both are stored on EAS, so CI builds can use them from then on.
2. **The App Store Connect app**, by hand (the submit profile can't create it): App Store Connect ›
   My Apps › **New App**. Platform **iOS**, name **Rustnuts SMC**, primary language **English
   (Australia)**, bundle id **au.com.rustnutssmc.app**, SKU **rustnutssmc-app**.
3. **Scripted submits.** Once the app exists, copy its Apple ID (the number on the App Information
   page) and the team id (developer.apple.com › Membership) into `eas.json` `submit.production.ios`
   as `ascAppId` and `appleTeamId`. Then `eas submit --profile production --platform ios` works without
   prompts from the command line, the same as the Android submit above.
4. **Check the first ipa** before uploading it (download it from the build page):
   `unzip -l Rustnuts.ipa | grep -E 'SDWebImage.framework/PrivacyInfo|appex/PrivacyInfo'`
   should list both `Frameworks/SDWebImage.framework/PrivacyInfo.xcprivacy` and
   `PlugIns/expo-sharing-extension.appex/PrivacyInfo.xcprivacy`. If either is missing, App Store
   Connect rejects the upload with a privacy-manifest email (see
   `docs/superpowers/specs/2026-10-31-ios-readiness-design.md`, section 1).
