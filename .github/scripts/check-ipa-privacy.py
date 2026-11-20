"""Checks an iPhone build (.ipa) has the privacy manifests App Store Connect asks for, before upload.

Run by the Store build workflow's ios-submit step. App Store Connect rejects an upload by email
(ITMS-91053 / ITMS-91061) when the app, an app extension, or an embedded framework from Apple's list
of commonly used SDKs has no PrivacyInfo.xcprivacy. This finds that before the upload instead
(docs/superpowers/specs/2026-10-31-ios-readiness-design.md, section 1).
"""

import re
import sys
import zipfile

# Apple's "commonly used third-party SDKs" (developer.apple.com/support/third-party-SDK-requirements).
# An embedded framework with one of these names needs its own privacy manifest.
LISTED_SDKS = {
    name.lower()
    for name in """
    Abseil AFNetworking Alamofire AppAuth BoringSSL openssl_grpc Capacitor Charts connectivity_plus
    Cordova device_info_plus DKImagePickerController DKPhotoGallery FBAEMKit FBLPromises FBSDKCoreKit
    FBSDKCoreKit_Basics FBSDKLoginKit FBSDKShareKit file_picker FirebaseABTesting FirebaseAuth
    FirebaseCore FirebaseCoreDiagnostics FirebaseCoreExtension FirebaseCoreInternal FirebaseCrashlytics
    FirebaseDynamicLinks FirebaseFirestore FirebaseInstallations FirebaseMessaging FirebaseRemoteConfig
    Flutter fluttertoast FMDB geolocator_apple GoogleDataTransport GoogleSignIn GoogleToolboxForMac
    GoogleUtilities grpcpp GTMAppAuth GTMSessionFetcher hermes image_picker_ios IQKeyboardManager
    IQKeyboardManagerSwift Kingfisher leveldb Lottie MBProgressHUD nanopb OneSignal OneSignalCore
    OneSignalExtension OneSignalOutcomes OpenSSL OrderedSet package_info package_info_plus path_provider
    path_provider_ios Promises Protobuf Reachability RealmSwift RxCocoa RxRelay RxSwift SDWebImage
    share_plus shared_preferences_ios SnapKit sqflite Starscream SVProgressHUD SwiftyGif SwiftyJSON
    Toast UnityFramework url_launcher url_launcher_ios video_player_avfoundation wakelock
    webview_flutter_wkwebview
    """.split()
}

MANIFEST = "PrivacyInfo.xcprivacy"


def fail(message: str) -> None:
    print(f"::error::{message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: check-ipa-privacy.py <build.ipa>")
    try:
        with zipfile.ZipFile(sys.argv[1]) as z:
            names = set(z.namelist())
    except (OSError, zipfile.BadZipFile):
        fail("The iPhone build couldn't be opened as an .ipa; check the build page on expo.dev")

    apps = sorted({m.group(0) for n in names if (m := re.match(r"Payload/[^/]+\.app/", n))})
    if len(apps) != 1:
        fail(f"Expected one app in the .ipa's Payload folder, found {len(apps)}")
    app = apps[0]

    # Each bundle that needs a manifest, as its folder inside the ipa.
    needs = [app]
    bundles = {m.group(0) for n in names if (m := re.match(re.escape(app) + r"(PlugIns/[^/]+\.appex|Frameworks/[^/]+\.framework)/", n))}
    for bundle in sorted(bundles):
        if bundle.startswith(app + "PlugIns/"):
            needs.append(bundle)
        elif bundle[len(app) + len("Frameworks/") : -len(".framework/")].lower() in LISTED_SDKS:
            needs.append(bundle)

    missing = [b for b in needs if b + MANIFEST not in names]
    if missing:
        where = ", ".join(b[len("Payload/") :].rstrip("/") for b in missing)
        fail(f"No {MANIFEST} in {where}; App Store Connect would reject this upload")
    print(f"Privacy manifests present in {len(needs)} bundle(s): " + ", ".join(b[len('Payload/'):].rstrip('/') for b in needs))


if __name__ == "__main__":
    main()
