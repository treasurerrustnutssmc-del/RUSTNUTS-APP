// Gives the iOS share extension (the "expo-sharing-extension" target that expo-sharing generates)
// its own privacy manifest. Apple checks every bundle in an upload, including .appex plug-ins, and
// the extension writes the shared item into App Group UserDefaults and reads file dates, both
// "required reason" APIs. Without this file the upload is accepted but App Store Connect emails an
// ITMS-91053 warning, and from Apple's announced deadline it becomes a rejection.
//
// expo-sharing's plugin doesn't write one, and the main app's `ios.privacyManifests` only reaches the
// app target. So this plugin runs in two steps, like expo-sharing itself:
//  1. a dangerous mod writes ios/expo-sharing-extension/PrivacyInfo.xcprivacy;
//  2. an Xcode project mod adds the file to the extension group and to the extension target's own
//     Resources phase. The xcode package's addResourceFile / pbxResourcesBuildPhaseObj find the main
//     app's phase by its "Resources" comment, so they'd bundle the manifest in the wrong place. We find
//     the extension target by name and walk its buildPhases to the PBXResourcesBuildPhase instead.
//
// List it in app.json BEFORE "expo-sharing": Xcode project mods run in reverse list order, so being
// listed first means running after expo-sharing has created the target.

const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'expo-sharing-extension';
const FILE_NAME = 'PrivacyInfo.xcprivacy';

/** The manifest contents: no tracking, nothing collected, and a reason for each API the extension touches. */
function shareExtensionPrivacyManifest() {
  return {
    NSPrivacyTracking: false,
    NSPrivacyTrackingDomains: [],
    NSPrivacyCollectedDataTypes: [],
    NSPrivacyAccessedAPITypes: [
      {
        // The extension hands the shared item to the app through App Group UserDefaults.
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
        NSPrivacyAccessedAPITypeReasons: ['1C8F.1'],
      },
      {
        // Foundation reads file dates when it copies the shared files into the group container.
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
        NSPrivacyAccessedAPITypeReasons: ['C617.1'],
      },
    ],
  };
}

const withManifestFile = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      // expo-sharing's own dangerous mod creates this directory; create it ourselves in case it runs later.
      const dir = path.join(config.modRequest.platformProjectRoot, TARGET_NAME);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, FILE_NAME), plist.build(shareExtensionPrivacyManifest()));
      return config;
    },
  ]);

const unquote = (s) => (typeof s === 'string' ? s.replace(/^"(.*)"$/, '$1') : s);
const isComment = (key) => key.endsWith('_comment');

/** The object entries of a pbxproj section, skipping the "<uuid>_comment" string entries. */
function entries(section) {
  return Object.entries(section ?? {}).filter(([key]) => !isComment(key));
}

const withManifestInXcodeProject = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    const objects = project.hash.project.objects;

    const target = entries(objects.PBXNativeTarget).find(([, t]) => unquote(t.name) === TARGET_NAME)?.[1];
    if (!target) {
      throw new Error(
        `withShareExtensionPrivacy: no "${TARGET_NAME}" target in the Xcode project. List this plugin before "expo-sharing" in app.json.`,
      );
    }
    const resourcesPhase = target.buildPhases
      .map((phase) => objects.PBXResourcesBuildPhase?.[phase.value])
      .find(Boolean);
    if (!resourcesPhase) {
      throw new Error(`withShareExtensionPrivacy: the "${TARGET_NAME}" target has no Resources build phase.`);
    }
    const group = entries(objects.PBXGroup).find(([, g]) => unquote(g.name) === TARGET_NAME)?.[1];
    if (!group) {
      throw new Error(`withShareExtensionPrivacy: the "${TARGET_NAME}" group is missing from the Xcode project.`);
    }

    // Re-running prebuild without --clean reuses the project, so reuse the entries we added last time.
    let fileRef = entries(objects.PBXFileReference).find(
      ([key, ref]) => unquote(ref.path) === FILE_NAME && group.children.some((child) => child.value === key),
    )?.[0];
    if (!fileRef) {
      fileRef = project.generateUuid();
      objects.PBXFileReference[fileRef] = {
        isa: 'PBXFileReference',
        lastKnownFileType: 'text.plist.xml',
        path: FILE_NAME,
        sourceTree: '"<group>"',
      };
      objects.PBXFileReference[`${fileRef}_comment`] = FILE_NAME;
      group.children.push({ value: fileRef, comment: FILE_NAME });
    }

    let buildFile = entries(objects.PBXBuildFile).find(([, f]) => f.fileRef === fileRef)?.[0];
    if (!buildFile) {
      buildFile = project.generateUuid();
      objects.PBXBuildFile[buildFile] = { isa: 'PBXBuildFile', fileRef, fileRef_comment: FILE_NAME };
      objects.PBXBuildFile[`${buildFile}_comment`] = `${FILE_NAME} in Resources`;
    }
    if (!resourcesPhase.files.some((f) => f.value === buildFile)) {
      resourcesPhase.files.push({ value: buildFile, comment: `${FILE_NAME} in Resources` });
    }
    return config;
  });

const withShareExtensionPrivacy = (config) => withManifestInXcodeProject(withManifestFile(config));

module.exports = withShareExtensionPrivacy;
module.exports.shareExtensionPrivacyManifest = shareExtensionPrivacyManifest;
