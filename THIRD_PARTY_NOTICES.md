# Third-party notices and dependency evidence

This is an initial repository index for licensing review, not a complete release notice bundle or a licence for the original application. Third-party components retain their applicable terms. This index grants no additional rights in original application code, club content, names, logos or other assets.

Evidence was read from [`treasurerrustnutssmc-del/RUSTNUTS-APP` at commit `f78812da1da82f763379e4db01b057c4383d3771`](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/tree/f78812da1da82f763379e4db01b057c4383d3771). The complete repository tree, `package.json`, every `packages` entry in `package-lock.json`, and the notice files identified below were inspected. Package licence fields are publisher metadata, not independent verification of every file's terms.

## Licence document index

| Material | Location | Status and evidence |
| --- | --- | --- |
| Original application licence | [LICENSE](LICENSE) | Scoped notice of Jeff-owned original software and permanent, fee-free club grant. Preserves valid earlier permissions; it does not settle the historical scope of the former root MIT notice. |
| Preserved former root Expo MIT text | [licenses/Expo-MIT.txt](licenses/Expo-MIT.txt) | Byte-identical former root notice for 650 Industries, Inc. (aka Expo), 2015–present. Moving it does not retrospectively narrow its scope or revoke earlier grants. |
| Proposed club software agreement | [docs/licensing/CLUB-SOFTWARE-LICENCE.md](docs/licensing/CLUB-SOFTWARE-LICENCE.md) | Draft agreement; not evidence of an executed agreement. |
| JavaScript dependency declarations and resolved metadata | [package.json](package.json), [package-lock.json](package-lock.json) | Runtime and development dependencies; see counts and limitations below. |
| Rustnuts Stencil font in the app | [assets/fonts/RustnutsStencil-Regular.ttf](assets/fonts/RustnutsStencil-Regular.ttf), [assets/fonts/OFL.txt](assets/fonts/OFL.txt) | The notice identifies a heavier, renamed derivative of Stardos Stencil Bold, copyright 2011 Vernon Adams, under SIL OFL 1.1. |
| Rustnuts Stencil font on the site | [site/RustnutsStencil-Regular.ttf](site/RustnutsStencil-Regular.ttf), [site/OFL.txt](site/OFL.txt) | Both the font and OFL notice have the same respective Git blob hashes as their app copies at the reviewed commit. |
| Impeccable development tooling | [.claude/skills/impeccable/LICENSE](.claude/skills/impeccable/LICENSE) | Apache License 2.0, with copyright 2025 Paul Bakaus. Preserve the existing licence and applicable notices when distributing this material. |

The former root MIT text is preserved verbatim in `licenses/Expo-MIT.txt`; both OFL files and the Impeccable licence remain unchanged.

## Lockfile inventory

The reviewed lockfile uses format version 3. It contains **942 package-path entries: one application root and 941 dependency entries**. The root had no `license` field at that pinned commit; this change adds only a pointer to the root LICENSE in application metadata. All 941 dependency entries have a `license` value. The manifest declares 45 direct dependencies and eight direct development dependencies.

These are counts of dependency paths, including repeated versions and platform variants, not counts of distinct projects or components shipped in a release. Of the 941 entries, 201 are marked `dev: true` and 77 are marked `optional: true`; the categories can overlap and do not establish what a build includes.

| Exact lockfile `license` value | Dependency-path count |
| --- | ---: |
| `MIT` | 808 |
| `ISC` | 46 |
| `Apache-2.0` | 28 |
| `BSD-2-Clause` | 17 |
| `MPL-2.0` | 12 |
| `BSD-3-Clause` | 11 |
| `BlueOak-1.0.0` | 6 |
| `(MIT OR CC0-1.0)` | 3 |
| `0BSD` | 2 |
| `Unlicense` | 2 |
| `(Apache-2.0 AND BSD-3-Clause)` | 1 |
| `(BSD-3-Clause OR GPL-2.0)` | 1 |
| `(MIT OR Apache-2.0)` | 1 |
| `CC-BY-4.0` | 1 |
| `CC0-1.0` | 1 |
| `Python-2.0` | 1 |
| **Total** | **941** |

Examples of resolved dependencies are `expo@58.0.19`, `react@19.3.0`, `react-native@0.88.0` and `@supabase/supabase-js@2.118.0`, each labelled `MIT` in the lockfile. Those labels do not establish the terms of every bundled font, image, native library or other subcomponent.

## Selected non-MIT evidence and redistribution points

These examples explain why a single MIT notice cannot substitute for reviewing the dependency materials. They summarise selected conditions, not every obligation.

| Lockfile path and resolved version | Recorded licence | Review point |
| --- | --- | --- |
| `node_modules/@livekit/react-native` — `3.0.0`; `node_modules/livekit-client` — `2.22.4`; `node_modules/typescript` — `6.0.3` | `Apache-2.0` | When redistributing covered material, include the licence, mark modified files, retain relevant source notices and carry applicable upstream NOTICE attributions. See [Apache 2.0, section 4](https://www.apache.org/licenses/LICENSE-2.0). Package-specific NOTICE files have not been collected here. |
| `node_modules/@bufbuild/protobuf` — `1.10.1` | `(Apache-2.0 AND BSD-3-Clause)` | Preserve the combined expression and inspect the package's file-level notices; do not reduce `AND` to a choice of one licence. |
| `node_modules/lightningcss` and 11 platform packages — `1.33.0` | `MPL-2.0` | If covered executable material is distributed, make its corresponding covered source available and tell recipients how to obtain it. Preserve notices and applicable source rights. Larger works can have separate terms subject to these conditions. See [MPL 2.0, sections 3.1–3.4](https://www.mozilla.org/en-US/MPL/2.0/). Actual release inclusion has not been established. |
| `node_modules/caniuse-lite` — `1.0.30001819` | `CC-BY-4.0` | If covered material is shared, retain supplied attribution and notices, identify modifications and provide the licence text or link. See [CC BY 4.0, section 3](https://creativecommons.org/licenses/by/4.0/legalcode.en). Release inclusion and the supplied attribution still need checking. |
| `node_modules/node-forge` — `1.4.0` | `(BSD-3-Clause OR GPL-2.0)` | Alternative licence metadata is recorded as supplied. Inspect the package terms and record the applicable route before redistribution; no route is selected by this index. |

For the checked-in font, the existing OFL notices and [font build script](scripts/build-font.py) identify the modification and rename. Keep the copyright and OFL licence with redistributed font copies. The font must remain under OFL 1.1, cannot be sold on its own, and derivatives cannot use the reserved primary font names “Stardos” or “Stardos Stencil” without permission. The OFL does not require documents created using the font to use that licence. See the complete conditions in the existing [app OFL notice](assets/fonts/OFL.txt) and [site OFL notice](site/OFL.txt).

## Evidence limits and release completion

This review did not install packages, unpack npm archives, build the app or inspect a distributed app/site bundle. Full dependency copyright notices, licence texts and NOTICE files have not been collected. Native iOS/Android dependencies, CocoaPods/Maven resolutions, prebuilt binaries, WebRTC/WASM subcomponents, icon fonts, other media and service terms require checking against the actual release. Python tools referenced by `scripts/build-font.py` are outside the npm inventory and were not audited.

Before using this as a release notice bundle, reconcile the exact shipped components with their source packages and native build resolutions; collect and preserve their applicable licences, copyright and NOTICE texts; and satisfy any source-availability or attribution requirements. Keep the existing notices in their current locations. This index is evidence for that work, not a finding that the release is complete or compliant.

### Pinned source references

- [Dependency lockfile](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/blob/f78812da1da82f763379e4db01b057c4383d3771/package-lock.json) — Git blob `8bd781196bd0f2c60066df0e1f941e33d0182d53`.
- [Dependency manifest](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/blob/f78812da1da82f763379e4db01b057c4383d3771/package.json) — Git blob `160f114b16883f1bee5cb026e1d0355dd0f2afec`.
- [Existing root licence](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/blob/f78812da1da82f763379e4db01b057c4383d3771/LICENSE) — Git blob `30b20e3b5f0f470947ba9480d90587ba07c137b4`.
- [App OFL notice](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/blob/f78812da1da82f763379e4db01b057c4383d3771/assets/fonts/OFL.txt) and [site OFL notice](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/blob/f78812da1da82f763379e4db01b057c4383d3771/site/OFL.txt) — both Git blob `735e96ebe6dc9eb20d871692c2837d0c96f380aa`.
- [Impeccable licence](https://github.com/treasurerrustnutssmc-del/RUSTNUTS-APP/blob/f78812da1da82f763379e4db01b057c4383d3771/.claude/skills/impeccable/LICENSE) — Git blob `bb3f6d23b1f8025514a62a12b51b47d73e3c9aa9`.
